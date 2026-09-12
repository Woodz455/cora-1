/**
 * Profils de dossier et premiers pas.
 *
 * Le profil choisi à la création d'un dossier règle des valeurs de départ et
 * l'ordre des premiers pas. Il ne retire aucun écran : un écran caché se lit
 * comme une absence, et le travailleur autonome qui embauche, ou l'acteur qui
 * décroche un contrat récurrent, doit trouver les rôles et les abonnements là
 * où ils sont. Le profil se change dans Paramètres, sans rien débloquer.
 *
 * `PROFILS` est dupliqué dans `client/src/profils.js`, faute de module partagé
 * entre le serveur et l'interface ; un test vérifie que les deux copies
 * restent alignées.
 */

const PROFILS = [
  { valeur: 'autonome', libelle: 'Travailleur autonome', conditions_defaut: 'reception' },
  { valeur: 'startup', libelle: 'Startup en démarrage', conditions_defaut: 'net30' },
  { valeur: 'pme', libelle: 'PME établie', conditions_defaut: 'net30' }
];

/** Année courante, pour savoir si un taux kilométrique est réglé. */
const anneeCourante = () => new Date().getFullYear();

/**
 * Les étapes possibles. Chacune sait se dire faite à partir de ce qui est déjà
 * dans le dossier : la liste se coche d'elle-même, personne n'a rien à déclarer.
 *
 * `vue` est l'écran où l'étape s'accomplit ; `ancre` la section de la page
 * Paramètres, quand c'est là que ça se passe.
 */
const ETAPES = {
  coordonnees: {
    titre: 'Renseigner les coordonnées de l\'entreprise',
    detail: 'L\'adresse et le courriel figurent sur chaque facture, avec vos numéros de taxes si vous êtes inscrit.',
    vue: 'parametres',
    ancre: 'section-entreprise',
    fait: (c) => Boolean(c.settings.entreprise_adresse)
  },
  client: {
    titre: 'Inscrire votre premier client',
    detail: 'Sa province fixe les taxes, ses conditions de paiement fixent l\'échéance.',
    vue: 'clients',
    fait: (c) => c.nb.clients > 0
  },
  facture: {
    titre: 'Émettre votre première facture',
    detail: 'Elle part par courriel en PDF, ou s\'imprime.',
    vue: 'factures',
    fait: (c) => c.nb.factures > 0
  },
  kilometrage: {
    titre: 'Régler le taux kilométrique de l\'année',
    detail: 'Les deux paliers de l\'ARC, une fois par année. Sans ce réglage, aucun déplacement ne peut être inscrit.',
    vue: 'parametres',
    ancre: 'section-kilometrage',
    fait: (c) => c.tauxKilometrique
  },
  abonnement: {
    titre: 'Créer votre premier abonnement',
    detail: 'La facture récurrente part d\'elle-même, chaque mois ou chaque année.',
    vue: 'abonnements',
    fait: (c) => c.nb.abonnements > 0
  },
  paiement_en_ligne: {
    titre: 'Activer le paiement en ligne',
    detail: 'Un lien de paiement par carte sur chaque facture, par Stripe.',
    vue: 'parametres',
    ancre: 'section-stripe',
    fait: (c) => Boolean(c.settings.stripe_cle_chiffree)
  },
  comptes: {
    titre: 'Créer les comptes de votre équipe',
    detail: 'Un employé facture sans voir les rapports ; un comptable voit tout sans toucher aux paramètres.',
    vue: 'parametres',
    ancre: 'section-comptes',
    fait: (c) => c.nb.comptes > 1
  },
  banque: {
    titre: 'Importer un premier relevé bancaire',
    detail: 'Les dépôts se rapprochent des factures, et ce qui reste se voit.',
    vue: 'banque',
    fait: (c) => c.nb.transactions > 0
  },
  sauvegarde: {
    titre: 'Choisir un dossier de sauvegarde synchronisé',
    detail: 'OneDrive, Google Drive ou Dropbox : la copie quotidienne quitte l\'ordinateur.',
    vue: 'parametres',
    ancre: 'section-sauvegardes',
    fait: (c) => Boolean(c.settings.sauvegarde_dossier)
  }
};

/** L'ordre des premiers pas, par profil. Tous mènent à la sauvegarde. */
const PARCOURS = {
  autonome: ['coordonnees', 'client', 'facture', 'kilometrage', 'sauvegarde'],
  startup: ['coordonnees', 'client', 'abonnement', 'paiement_en_ligne', 'sauvegarde'],
  pme: ['coordonnees', 'comptes', 'client', 'facture', 'banque', 'sauvegarde']
};

/** Dossier antérieur au choix d'un profil : l'essentiel, sans présumer du métier. */
const PARCOURS_SANS_PROFIL = ['coordonnees', 'client', 'facture', 'sauvegarde'];

function profilDe(valeur) {
  return PROFILS.find((p) => p.valeur === valeur) || null;
}

/**
 * Valide un profil transmis par l'API.
 *
 * @returns {string|null} le profil, ou null quand rien n'a été transmis : un
 *   dossier peut se créer sans profil, comme avant que le choix existe.
 */
function parseProfil(valeur) {
  if (valeur === undefined || valeur === null || valeur === '') return null;
  if (!profilDe(valeur)) {
    throw Object.assign(new Error(`Profil inconnu : ${valeur}.`), { status: 400 });
  }
  return valeur;
}

/**
 * Les premiers pas du dossier, cochés d'après son contenu.
 *
 * @param {import('sqlite').Database} db base du dossier
 * @param {import('sqlite').Database} comptesDb registre des comptes, où vivent les accès
 * @param {number} entrepriseId
 */
async function etatDemarrage(db, comptesDb, entrepriseId) {
  const settings = await db.get(
    `SELECT profil, demarrage_masque, entreprise_adresse, sauvegarde_dossier, stripe_cle_chiffree
     FROM settings LIMIT 1`
  ) || {};

  const compter = async (table) => (await db.get(`SELECT COUNT(*) AS n FROM ${table}`)).n;
  const [clients, factures, abonnements, transactions, acces, taux] = await Promise.all([
    compter('clients'),
    compter('factures'),
    compter('abonnements'),
    compter('transactions_bancaires'),
    comptesDb.get('SELECT COUNT(*) AS n FROM acces WHERE entreprise_id = ?', [entrepriseId]),
    db.get('SELECT 1 AS ok FROM taux_kilometriques WHERE annee = ?', [anneeCourante()])
  ]);

  const contexte = {
    settings,
    nb: { clients, factures, abonnements, transactions, comptes: acces.n },
    tauxKilometrique: Boolean(taux)
  };

  const profil = profilDe(settings.profil);
  const cles = profil ? PARCOURS[profil.valeur] : PARCOURS_SANS_PROFIL;

  return {
    profil: profil ? { valeur: profil.valeur, libelle: profil.libelle } : null,
    masque: Boolean(settings.demarrage_masque),
    etapes: cles.map((cle) => {
      const etape = ETAPES[cle];
      return {
        cle,
        titre: etape.titre,
        detail: etape.detail,
        vue: etape.vue,
        ancre: etape.ancre || null,
        fait: Boolean(etape.fait(contexte))
      };
    })
  };
}

module.exports = { PROFILS, PARCOURS, PARCOURS_SANS_PROFIL, ETAPES, profilDe, parseProfil, etatDemarrage };
