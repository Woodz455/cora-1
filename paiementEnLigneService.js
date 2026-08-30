/**
 * Paiement des factures en ligne.
 *
 * Le principe est de ne rien inventer : l'argent va **directement au compte
 * Stripe de l'entreprise**, jamais à un compte intermédiaire. Clora se contente
 * de fabriquer le lien qui accompagne la facture, puis de relever les
 * règlements pour les porter aux comptes. C'est ce qui distingue un logiciel de
 * facturation d'un service de paiement — lequel serait soumis à un tout autre
 * régime réglementaire.
 *
 * Deux propriétés comptent plus que le reste, et sont assurées par la base
 * plutôt que par la vigilance du code :
 *
 *  - **un règlement ne peut pas être inscrit deux fois.** `session_id` est
 *    unique dans `encaissements_stripe` : quel que soit le nombre de passages
 *    du planificateur, ou deux passages simultanés, la seconde inscription est
 *    refusée par SQLite.
 *  - **un règlement qui n'a pas pu être inscrit ne disparaît pas.** Une facture
 *    déjà soldée, annulée entre-temps : le cas est consigné avec son motif, et
 *    se voit. Un encaissement réel qui s'évapore serait le pire des défauts.
 *
 * Le relevé se fait lien par lien, et non par fenêtre de dates : un débit
 * préautorisé met plusieurs jours ouvrables à se dénouer, et ce sont justement
 * les règlements les plus lents qu'un relevé automatique doit rattraper.
 */

const { roundCents } = require('./money.js');
const { withTransaction } = require('./dbUtils.js');
const { dechiffrer } = require('./secretStorage.js');
const { journaliser, ACTIONS } = require('./auditService.js');
const { addPaiement, getSoldeFacture } = require('./invoiceService.js');
const {
  creerLien, sessionsDuLien, desactiverLien, cleValide, modeDeLaCle, estRestreinte
} = require('./stripeService.js');

/** Écart en deçà duquel deux montants sont le même montant. */
const EPSILON = 0.005;

/** Montant minimal accepté par Stripe, en dollars. */
const MONTANT_MINIMAL = 0.5;

/**
 * Auteur porté au journal d'audit pour les inscriptions automatiques.
 *
 * Le relevé tourne sur minuterie, sans requête ni session : `journaliser` ne lit
 * que `req.user`, et lui donner un nom explicite vaut mieux qu'une ligne de
 * journal sans auteur, qu'on prendrait pour une trace incomplète.
 */
const AUTEUR_AUTOMATIQUE = { user: { username: 'Stripe', role: 'automatique' } };

/**
 * Configuration du paiement en ligne pour le dossier ouvert.
 *
 * @returns {Promise<{actif: boolean, cle: string, mode: string, restreinte: boolean,
 *                    cleIllisible: boolean}>}
 */
async function configuration(db) {
  const absente = { actif: false, cle: '', mode: 'live', restreinte: false, cleIllisible: false };

  let ligne;
  try {
    ligne = await db.get('SELECT stripe_cle_chiffree, stripe_actif FROM settings LIMIT 1');
  } catch (e) {
    // Colonnes absentes sur une base qui n'a pas encore migré.
    return absente;
  }
  if (!ligne || !ligne.stripe_actif) return absente;

  // Vide lorsque la base a été restaurée sur une autre machine : le coffre du
  // système ne sait plus déchiffrer. Le dire permet à l'écran des paramètres
  // d'inviter à ressaisir la clé, plutôt que de laisser croire que le paiement
  // en ligne fonctionne alors qu'il ne part plus rien.
  const cle = dechiffrer(ligne.stripe_cle_chiffree);
  if (!cleValide(cle)) {
    return { ...absente, cleIllisible: Boolean(ligne.stripe_cle_chiffree) };
  }

  return {
    actif: true,
    cle,
    mode: modeDeLaCle(cle),
    restreinte: estRestreinte(cle),
    cleIllisible: false
  };
}

/** Note portée sur l'encaissement, telle qu'elle s'affichera dans la facture. */
function noteEncaissement(session, mode) {
  const marque = mode === 'test' ? ' — MODE TEST, argent fictif' : '';
  return `Paiement en ligne (Stripe${marque}) — ${session.id}`;
}

/**
 * Lien de paiement actif pour une facture, créé si nécessaire.
 *
 * Renvoie `null` — et non une erreur — dans tous les cas où il n'y a
 * légitimement rien à proposer : paiement en ligne désactivé, facture annulée
 * ou déjà soldée. L'appel est déclenché par le simple affichage d'une facture ;
 * il ne doit pas transformer une situation normale en message d'erreur.
 *
 * @param {import('sqlite').Database} db
 * @param {number} factureId
 * @returns {Promise<Object|null>} ligne de `liens_paiement`
 */
async function lienPourFacture(db, factureId) {
  const config = await configuration(db);
  if (!config.actif) return null;

  const facture = await getSoldeFacture(db, factureId);
  if (!facture) {
    throw Object.assign(new Error('Facture non trouvée.'), { status: 404, expose: true });
  }
  if (facture.statut === 'Annulée') return null;
  if (facture.solde_restant <= EPSILON) return null;

  const existant = await db.get(
    'SELECT * FROM liens_paiement WHERE facture_id = ? AND actif = 1 ORDER BY id DESC LIMIT 1',
    [factureId]
  );

  if (existant) {
    // Le lien porte un montant figé chez Stripe. Tant que le solde n'a pas
    // bougé, on réutilise le même : en fabriquer un second à chaque affichage
    // laisserait plusieurs liens vivants pour une seule facture, et un client
    // qui rouvre un vieux courriel paierait deux fois.
    const memeMontant = Math.abs(existant.montant - facture.solde_restant) < EPSILON;
    if (memeMontant && existant.devise === facture.devise && existant.mode === config.mode) {
      return existant;
    }
    await retirerLien(db, config, existant);
  }

  if (facture.solde_restant < MONTANT_MINIMAL) {
    throw Object.assign(
      new Error(`Stripe n'accepte pas les paiements inférieurs à ${MONTANT_MINIMAL.toFixed(2)} $.`),
      { status: 400, expose: true }
    );
  }

  const entreprise = await db.get('SELECT entreprise_nom FROM settings LIMIT 1');
  const { rang } = await db.get(
    'SELECT COUNT(*) AS rang FROM liens_paiement WHERE facture_id = ?', [factureId]
  );

  const cree = await creerLien(config.cle, {
    numero: facture.numero_facture,
    montant: facture.solde_restant,
    devise: facture.devise,
    metadata: {
      facture: facture.numero_facture,
      entreprise: (entreprise && entreprise.entreprise_nom) || '',
      logiciel: 'Clora'
    },
    // Deux affichages simultanés de la même facture ne doivent pas produire
    // deux liens : la clé décrit ce qui est demandé, et un rejeu rend le lien
    // déjà créé.
    //
    // Le rang y figure parce que Stripe rejoue une clé pendant vingt-quatre
    // heures : sans lui, un acompte encaissé puis annulé ramènerait au même
    // montant, donc à la même clé, et Stripe rendrait le lien qu'on venait de
    // désactiver — un lien mort envoyé au client.
    idempotence: `clora-${facture.numero_facture}-${Math.round(facture.solde_restant * 100)}-${rang}`
  });

  // `ON CONFLICT` plutôt qu'une insertion sèche : deux requêtes simultanées
  // reçoivent le même lien de Stripe, précisément parce que la clé
  // d'idempotence a fait son travail. La seconde ne doit pas échouer sur la
  // contrainte d'unicité.
  await db.run(
    `INSERT INTO liens_paiement (facture_id, lien_id, url, montant, devise, mode, cree_le, actif)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(lien_id) DO NOTHING`,
    [
      factureId, cree.id, cree.url, roundCents(facture.solde_restant),
      facture.devise, config.mode, new Date().toISOString()
    ]
  );

  return db.get('SELECT * FROM liens_paiement WHERE lien_id = ?', [cree.id]);
}

/**
 * Retire un lien de la circulation.
 *
 * L'échec côté Stripe n'est pas propagé : le lien est marqué inactif localement
 * dans tous les cas. Continuer de proposer un lien qu'on croit mort serait pire
 * que de laisser un lien orphelin dans le tableau de bord de Stripe — et le
 * relevé, lui, cesse de s'y intéresser.
 */
async function retirerLien(db, config, lien) {
  try {
    await desactiverLien(config.cle, lien.lien_id);
  } catch (erreur) {
    console.error(`Lien de paiement ${lien.lien_id} non désactivé chez Stripe :`, erreur.message);
  }
  await db.run('UPDATE liens_paiement SET actif = 0 WHERE id = ?', [lien.id]);
}

/**
 * Inscrit un règlement relevé chez Stripe.
 *
 * @returns {Promise<'inscrit'|'refuse'|'connu'|'reporte'>}
 */
async function inscrire(db, lien, session) {
  const deja = await db.get('SELECT id FROM encaissements_stripe WHERE session_id = ?', [session.id]);
  if (deja) return 'connu';

  const montant = roundCents((Number(session.amount_total) || 0) / 100);
  const devise = String(session.currency || lien.devise || 'CAD').toUpperCase();

  // La date retenue est celle du relevé, non celle de la session : pour un
  // débit préautorisé, la session est ouverte plusieurs jours avant que
  // l'argent n'arrive, et c'est la réception qui fait foi aux comptes.
  const date = new Date().toISOString().split('T')[0];

  try {
    const inscription = await withTransaction(db, async () => {
      // Écrite avant l'encaissement : l'unicité de `session_id` est le verrou
      // qui empêche deux passages concurrents d'inscrire le même règlement.
      const trace = await db.run(
        `INSERT INTO encaissements_stripe
           (session_id, lien_id, facture_id, montant, devise, mode, recu_le, etat)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'inscrit')`,
        [session.id, lien.lien_id, lien.facture_id, montant, devise, lien.mode, date]
      );

      const facture = await addPaiement(
        db, lien.facture_id, montant, noteEncaissement(session, lien.mode), date
      );

      // La connexion est unique et la transaction sérialisée : la dernière
      // ligne de `paiements` sur cette facture est bien celle qu'on vient
      // d'écrire.
      const paiement = await db.get(
        'SELECT id FROM paiements WHERE facture_id = ? ORDER BY id DESC LIMIT 1',
        [lien.facture_id]
      );
      await db.run(
        'UPDATE encaissements_stripe SET paiement_id = ? WHERE id = ?',
        [paiement ? paiement.id : null, trace.lastID]
      );

      return facture;
    });

    await journaliser(db, AUTEUR_AUTOMATIQUE, {
      action: ACTIONS.PAIEMENT_EN_LIGNE,
      entite: 'facture',
      entite_id: lien.facture_id,
      details: {
        facture: inscription ? inscription.numero_facture : null,
        montant,
        devise,
        mode: lien.mode,
        session: session.id
      }
    });

    return 'inscrit';
  } catch (erreur) {
    // Un refus définitif porte un code métier : facture soldée, annulée,
    // disparue. Tout le reste — base verrouillée, disque plein — est passager,
    // et le consigner comme un échec définitif priverait le passage suivant de
    // sa chance de rattraper un encaissement parfaitement valable.
    const definitif = Number.isInteger(erreur.status) && erreur.status >= 400 && erreur.status < 500;
    if (!definitif) {
      console.error(
        `Encaissement Stripe ${session.id} non inscrit, nouvelle tentative au prochain passage :`,
        erreur.message
      );
      return 'reporte';
    }

    // Le règlement existe chez Stripe : l'argent est réellement entré. Ne pas
    // pouvoir l'imputer est un problème à porter à la connaissance de
    // l'utilisateur, pas une ligne à passer sous silence.
    await db.run(
      `INSERT OR IGNORE INTO encaissements_stripe
         (session_id, lien_id, facture_id, montant, devise, mode, recu_le, etat, message)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'refuse', ?)`,
      [session.id, lien.lien_id, lien.facture_id, montant, devise, lien.mode, date, erreur.message]
    );

    await journaliser(db, AUTEUR_AUTOMATIQUE, {
      action: ACTIONS.PAIEMENT_EN_LIGNE_REFUSE,
      entite: 'facture',
      entite_id: lien.facture_id,
      details: { montant, devise, session: session.id, motif: erreur.message }
    });

    console.error(
      `Encaissement Stripe ${session.id} non imputé à la facture ${lien.facture_id} :`,
      erreur.message
    );
    return 'refuse';
  }
}

/**
 * Relève les règlements reçus et les porte aux comptes.
 *
 * Ne lève jamais : appelée par le planificateur, elle ne doit pas empêcher les
 * relances ni la sauvegarde de s'exécuter parce que Stripe est indisponible.
 *
 * @param {import('sqlite').Database} db
 * @returns {Promise<{inscrits: number, refuses: number, erreurs: number, liens: number}>}
 */
async function relever(db) {
  const bilan = { inscrits: 0, refuses: 0, erreurs: 0, liens: 0 };

  const config = await configuration(db);
  if (!config.actif) return bilan;

  const liens = await db.all('SELECT * FROM liens_paiement WHERE actif = 1 ORDER BY id ASC');
  bilan.liens = liens.length;

  for (const lien of liens) {
    // Un lien en échec — supprimé chez Stripe, réseau coupé, base momentanément
    // verrouillée — n'interrompt pas le relevé des autres. Sans cette barrière,
    // une seule facture en difficulté priverait toutes les autres de leur
    // encaissement, et ferait échouer le passage entier du planificateur.
    try {
      const sessions = await sessionsDuLien(config.cle, lien.lien_id);

      for (const session of sessions) {
        // `paid` est le seul état qui signifie que l'argent est arrivé. Une
        // session ouverte par un débit préautorisé encore en cours reste
        // `unpaid` : l'inscrire serait porter aux comptes un règlement que la
        // banque peut encore refuser.
        if (session.payment_status !== 'paid') continue;

        const resultat = await inscrire(db, lien, session);
        if (resultat === 'inscrit') bilan.inscrits += 1;
        if (resultat === 'refuse') bilan.refuses += 1;
        if (resultat === 'reporte') bilan.erreurs += 1;
      }

      await retirerSiSolde(db, config, lien);
    } catch (erreur) {
      bilan.erreurs += 1;
      console.error(`Relevé du lien ${lien.lien_id} impossible :`, erreur.message);
    }
  }

  return bilan;
}

/** Retire le lien dès que la facture n'attend plus rien. */
async function retirerSiSolde(db, config, lien) {
  const facture = await getSoldeFacture(db, lien.facture_id);
  if (!facture) {
    await db.run('UPDATE liens_paiement SET actif = 0 WHERE id = ?', [lien.id]);
    return;
  }
  if (facture.statut === 'Annulée' || facture.solde_restant <= EPSILON) {
    await retirerLien(db, config, lien);
  }
}

/**
 * Règlements relevés qui n'ont pas pu être imputés.
 * L'écran des paramètres les affiche : c'est de l'argent reçu qui n'est nulle
 * part dans la comptabilité.
 */
async function encaissementsEnSouffrance(db) {
  return db.all(
    `SELECT e.id, e.session_id, e.facture_id, e.montant, e.devise, e.recu_le, e.message,
            f.numero_facture
     FROM encaissements_stripe e
     LEFT JOIN factures f ON f.id = e.facture_id
     WHERE e.etat = 'refuse'
     ORDER BY e.recu_le DESC, e.id DESC
     LIMIT 50`
  );
}

module.exports = {
  configuration,
  lienPourFacture,
  relever,
  retirerLien,
  encaissementsEnSouffrance,
  noteEncaissement,
  MONTANT_MINIMAL
};
