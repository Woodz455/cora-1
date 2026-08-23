/**
 * Journal des actions sensibles.
 *
 * La traçabilité se limitait à trois colonnes sur les paiements annulés : rien
 * ne disait qui avait modifié un client, changé un taux de taxe ou supprimé une
 * note de crédit. Ce service consigne ces gestes, dans une table que la base
 * elle-même refuse de laisser modifier ou vider (voir les déclencheurs de
 * `database.js`).
 */

/** Actions consignées. Un vocabulaire fermé, pour que le filtrage ait un sens. */
const ACTIONS = {
  PAIEMENT_ANNULATION: 'paiement.annulation',
  FACTURE_ANNULATION: 'facture.annulation',
  FACTURE_SUPPRESSION: 'facture.suppression',
  NOTE_CREDIT_SUPPRESSION: 'note_credit.suppression',
  CLIENT_MODIFICATION: 'client.modification',
  PARAMETRES_MODIFICATION: 'parametres.modification',
  UTILISATEUR_CREATION: 'utilisateur.creation',
  UTILISATEUR_MODIFICATION: 'utilisateur.modification',
  UTILISATEUR_SUPPRESSION: 'utilisateur.suppression',
  IDENTIFIANTS_MODIFICATION: 'identifiants.modification',
  SAUVEGARDE_RESTAURATION: 'sauvegarde.restauration',
  IMPORT: 'import.execution'
};

/** Libellés lisibles, partagés avec l'interface. */
const LIBELLES = {
  [ACTIONS.PAIEMENT_ANNULATION]: 'Encaissement annulé',
  [ACTIONS.FACTURE_ANNULATION]: 'Facture annulée',
  [ACTIONS.FACTURE_SUPPRESSION]: 'Facture supprimée',
  [ACTIONS.NOTE_CREDIT_SUPPRESSION]: 'Note de crédit supprimée',
  [ACTIONS.CLIENT_MODIFICATION]: 'Client modifié',
  [ACTIONS.PARAMETRES_MODIFICATION]: 'Paramètres modifiés',
  [ACTIONS.UTILISATEUR_CREATION]: 'Compte créé',
  [ACTIONS.UTILISATEUR_MODIFICATION]: 'Compte modifié',
  [ACTIONS.UTILISATEUR_SUPPRESSION]: 'Compte supprimé',
  [ACTIONS.IDENTIFIANTS_MODIFICATION]: 'Identifiants modifiés',
  [ACTIONS.SAUVEGARDE_RESTAURATION]: 'Sauvegarde restaurée',
  [ACTIONS.IMPORT]: 'Import depuis un tableur'
};

/** Longueur maximale du détail sérialisé, pour qu'une ligne reste une ligne. */
const MAX_DETAILS = 2000;

/**
 * Noms de champs dont la valeur ne doit jamais atteindre le journal.
 *
 * Les secrets, évidemment. Mais aussi le logo : c'est un data-URI de plusieurs
 * mégaoctets, et le consigner à chaque enregistrement des paramètres ferait
 * gonfler la base sans rien apprendre à personne.
 */
const CHAMPS_INTERDITS = /password|mot_de_passe|secret|token|jeton|logo/i;

/** Retire les valeurs sensibles ou volumineuses d'un objet de détails. */
function nettoyerDetails(details) {
  if (!details || typeof details !== 'object') return null;

  const propre = {};
  for (const [cle, valeur] of Object.entries(details)) {
    if (CHAMPS_INTERDITS.test(cle)) {
      // La mention du champ suffit : on sait qu'il a changé, sans le divulguer.
      propre[cle] = '[non journalisé]';
      continue;
    }
    propre[cle] = valeur;
  }
  return propre;
}

/**
 * Compare deux états et ne retient que les champs qui ont changé.
 *
 * Journaliser le corps de requête entier reviendrait à recopier le logo et les
 * champs inchangés à chaque fois ; ce qui intéresse un vérificateur, c'est
 * l'écart.
 *
 * @returns {Object|null} `{ champ: { avant, apres } }`, ou `null` si rien n'a bougé.
 */
function ecart(avant, apres, champs) {
  const diff = {};

  for (const champ of champs) {
    const ancien = avant ? avant[champ] : undefined;
    const nouveau = apres ? apres[champ] : undefined;
    if (ancien === undefined && nouveau === undefined) continue;

    // Comparaison souple : SQLite rend « 0.05 » là où le formulaire envoie 0.05.
    if (String(ancien ?? '') === String(nouveau ?? '')) continue;

    diff[champ] = { avant: ancien ?? null, apres: nouveau ?? null };
  }

  return Object.keys(diff).length === 0 ? null : diff;
}

/**
 * Consigne une action.
 *
 * **Ne lève jamais.** Un journal inaccessible ne doit pas empêcher d'annuler un
 * encaissement saisi à tort : refuser l'action serait plus dommageable que de
 * perdre une ligne de trace. Le cas réel — disque plein — ferait de toute façon
 * échouer l'écriture métier elle-même.
 *
 * @param {import('sqlite').Database} db
 * @param {Object} req requête Express, pour y lire `req.user`
 * @param {{action: string, entite?: string, entite_id?: number, details?: Object}} evenement
 */
async function journaliser(db, req, evenement) {
  try {
    const utilisateur = req && req.user ? req.user.username : null;
    const role = req && req.user ? req.user.role : null;

    const propres = nettoyerDetails(evenement.details);
    let details = propres ? JSON.stringify(propres) : null;
    if (details && details.length > MAX_DETAILS) {
      details = JSON.stringify({ tronque: true, apercu: details.slice(0, MAX_DETAILS) });
    }

    await db.run(
      `INSERT INTO logs_audit (date_heure, utilisateur, role, action, entite, entite_id, details)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        new Date().toISOString(),
        utilisateur,
        role,
        evenement.action,
        evenement.entite || null,
        evenement.entite_id || null,
        details
      ]
    );
  } catch (error) {
    console.error(`Journal d'audit : « ${evenement && evenement.action} » non consigné —`, error.message);
  }
}

/**
 * Lit le journal, du plus récent au plus ancien.
 *
 * La pagination est faite par la base, contrairement aux autres écrans de liste
 * qui chargent tout et paginent au navigateur : le journal est la seule table
 * qui ne fait que croître et n'est jamais purgée.
 */
async function lireJournal(db, filtres = {}) {
  const conditions = [];
  const params = [];

  if (filtres.action) {
    conditions.push('action = ?');
    params.push(filtres.action);
  }
  if (filtres.utilisateur) {
    conditions.push('utilisateur = ?');
    params.push(filtres.utilisateur);
  }
  if (filtres.entite) {
    conditions.push('entite = ?');
    params.push(filtres.entite);
  }
  if (filtres.depuis) {
    conditions.push('date_heure >= ?');
    params.push(filtres.depuis);
  }
  if (filtres.jusqu) {
    // Borne incluse : une date seule couvre la journée entière.
    conditions.push('date_heure <= ?');
    params.push(`${filtres.jusqu}T23:59:59.999Z`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const parPage = Math.min(Math.max(Number(filtres.parPage) || 50, 1), 200);
  const page = Math.max(Number(filtres.page) || 1, 1);

  const { total } = await db.get(`SELECT COUNT(*) AS total FROM logs_audit ${where}`, params);

  const lignes = await db.all(
    `SELECT id, date_heure, utilisateur, role, action, entite, entite_id, details
     FROM logs_audit ${where}
     ORDER BY date_heure DESC, id DESC
     LIMIT ? OFFSET ?`,
    [...params, parPage, (page - 1) * parPage]
  );

  return {
    total,
    page,
    parPage,
    nbPages: Math.max(Math.ceil(total / parPage), 1),
    lignes: lignes.map((l) => ({
      ...l,
      libelle: LIBELLES[l.action] || l.action,
      details: l.details ? JSON.parse(l.details) : null
    }))
  };
}

/** Auteurs distincts présents au journal, pour alimenter le filtre. */
async function auteursDuJournal(db) {
  const lignes = await db.all(
    'SELECT DISTINCT utilisateur FROM logs_audit WHERE utilisateur IS NOT NULL ORDER BY utilisateur'
  );
  return lignes.map((l) => l.utilisateur);
}

module.exports = { journaliser, lireJournal, auteursDuJournal, ecart, ACTIONS, LIBELLES };
