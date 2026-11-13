/**
 * Date de verrouillage des périodes.
 *
 * Une fois la déclaration de taxes produite, plus rien ne devrait bouger dans
 * la période qu'elle couvre : une facture modifiée, une dépense supprimée ou un
 * encaissement annulé après coup ferait mentir une déclaration déjà remise à
 * l'État, sans que rien ne le signale.
 *
 * L'administrateur pose donc une date. Jusqu'à elle, inclusivement, aucune
 * pièce ne se crée, ne se modifie ni ne se supprime : factures et leurs lignes,
 * encaissements, notes de crédit, dépenses. Corriger une facture d'une période
 * close passe par une note de crédit datée d'une période ouverte, ce qui est la
 * règle comptable de toute façon.
 *
 * Ce qui ne touche pas aux chiffres déclarés reste permis : encaisser
 * aujourd'hui une facture émise dans une période close, la relancer, l'envoyer
 * de nouveau, joindre un reçu à une dépense.
 *
 * Les routes vérifient la date pour donner un message utile. Mais c'est SQLite
 * qui fait respecter la règle, par des déclencheurs, comme pour le journal
 * d'audit : un chemin oublié (un recalcul d'indemnités, un outil de réparation,
 * une future route) ne peut pas la contourner.
 */

/**
 * `MARQUE_VERROU` est le message levé par les déclencheurs. Le gestionnaire
 * d'erreurs le reconnaît et le remplace par une phrase lisible.
 */
const { httpError, MARQUE_VERROU } = require('./httpUtils.js');

/** La date de verrouillage en vigueur, telle que les déclencheurs la lisent. */
const VERROU = '(SELECT date_verrouillage FROM settings ORDER BY id LIMIT 1)';

/**
 * Colonnes dont un changement modifie ce qui a été déclaré. Les autres (statut
 * de paiement, compteur de relances, date d'envoi) peuvent encore évoluer.
 */
const COLONNES_SUIVIES = {
  factures: [
    'numero_facture', 'client_id', 'date_emission', 'date_echeance', 'conditions_paiement',
    'taux_taxe_1', 'taux_taxe_2', 'taxe_1_nom', 'taxe_2_nom', 'devise', 'taux_change',
    'sous_total', 'montant_taxe_1', 'montant_taxe_2', 'montant_total'
  ],
  paiements: ['facture_id', 'date_paiement', 'montant', 'annule_le'],
  notes_credit: [
    'numero_note', 'facture_id', 'date_emission', 'taux_taxe_1', 'taux_taxe_2', 'taxe_1_nom', 'taxe_2_nom',
    'devise', 'taux_change', 'sous_total', 'montant_taxe_1', 'montant_taxe_2', 'montant_total'
  ],
  depenses: [
    'fournisseur', 'description', 'date_depense', 'montant_ht', 'tps', 'tvq', 'montant_ttc',
    'categorie', 'kilometres', 'vehicule'
  ]
};

/** Colonne de date de chaque pièce. */
const DATE_DE = {
  factures: 'date_emission',
  paiements: 'date_paiement',
  notes_credit: 'date_emission',
  depenses: 'date_depense'
};

/** Lignes rattachées à une pièce : elles suivent la date de leur parent. */
const LIGNES = {
  lignes_facture: { parent: 'factures', cle: 'facture_id' },
  lignes_note_credit: { parent: 'notes_credit', cle: 'note_id' }
};

const refus = `BEGIN SELECT RAISE(ABORT, '${MARQUE_VERROU}'); END;`;

/** Les déclencheurs, recréés à chaque ouverture pour suivre ce fichier. */
function declencheurs() {
  const instructions = [];

  for (const [table, date] of Object.entries(DATE_DE)) {
    const change = COLONNES_SUIVIES[table].map((c) => `NEW.${c} IS NOT OLD.${c}`);
    // Une facture annulée sort du rapport de taxes : l'annuler, ou la
    // rétablir, change donc la déclaration, contrairement à son passage de
    // « En attente » à « Payée ».
    if (table === 'factures') change.push("(NEW.statut = 'Annulée') IS NOT (OLD.statut = 'Annulée')");

    instructions.push(
      `CREATE TRIGGER verrou_${table}_ajout BEFORE INSERT ON ${table}
       WHEN NEW.${date} <= ${VERROU} ${refus}`,
      `CREATE TRIGGER verrou_${table}_modification BEFORE UPDATE ON ${table}
       WHEN (OLD.${date} <= ${VERROU} OR NEW.${date} <= ${VERROU})
         AND (${change.join(' OR ')}) ${refus}`,
      `CREATE TRIGGER verrou_${table}_suppression BEFORE DELETE ON ${table}
       WHEN OLD.${date} <= ${VERROU} ${refus}`
    );
  }

  for (const [table, { parent, cle }] of Object.entries(LIGNES)) {
    const dateParent = (ligne) => `(SELECT ${DATE_DE[parent]} FROM ${parent} WHERE id = ${ligne}.${cle})`;
    instructions.push(
      `CREATE TRIGGER verrou_${table}_ajout BEFORE INSERT ON ${table}
       WHEN ${dateParent('NEW')} <= ${VERROU} ${refus}`,
      `CREATE TRIGGER verrou_${table}_modification BEFORE UPDATE ON ${table}
       WHEN ${dateParent('OLD')} <= ${VERROU} OR ${dateParent('NEW')} <= ${VERROU} ${refus}`,
      `CREATE TRIGGER verrou_${table}_suppression BEFORE DELETE ON ${table}
       WHEN ${dateParent('OLD')} <= ${VERROU} ${refus}`
    );
  }

  // Joindre un reçu à une dépense close la justifie sans rien changer aux
  // chiffres : c'est permis. Le retirer, non.
  instructions.push(
    `CREATE TRIGGER verrou_pieces_jointes_suppression BEFORE DELETE ON pieces_jointes
     WHEN (SELECT date_depense FROM depenses WHERE id = OLD.depense_id) <= ${VERROU} ${refus}`
  );

  return instructions;
}

/** Noms des déclencheurs, pour les retirer avant de les reposer. */
function nomsDesDeclencheurs() {
  return [...Object.keys(DATE_DE), ...Object.keys(LIGNES)]
    .flatMap((t) => ['ajout', 'modification', 'suppression'].map((s) => `verrou_${t}_${s}`))
    .concat('verrou_pieces_jointes_suppression');
}

/**
 * Pose les déclencheurs. Appelé à chaque ouverture, une fois les migrations
 * faites : ils citent des colonnes ajoutées par elles. Ils sont retirés puis
 * reposés, pour qu'une base ancienne reçoive toujours la version en vigueur.
 */
async function installerVerrous(db) {
  await db.exec('BEGIN');
  try {
    for (const nom of nomsDesDeclencheurs()) await db.exec(`DROP TRIGGER IF EXISTS ${nom}`);
    for (const instruction of declencheurs()) await db.exec(instruction);
    await db.exec('COMMIT');
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}

/** La date de verrouillage, ou `null` si aucune période n'est close. */
async function dateDeVerrouillage(db) {
  const ligne = await db.get('SELECT date_verrouillage FROM settings ORDER BY id LIMIT 1');
  return (ligne && ligne.date_verrouillage) || null;
}

/** Vrai si la date tombe dans la période close. */
function estVerrouillee(date, verrou) {
  return Boolean(verrou && date && String(date) <= verrou);
}

/** Le jour qui suit une date AAAA-MM-JJ, en restant hors de tout fuseau. */
function lendemain(date) {
  const jour = new Date(`${date}T00:00:00Z`);
  jour.setUTCDate(jour.getUTCDate() + 1);
  return jour.toISOString().slice(0, 10);
}

/**
 * Refuse une opération qui toucherait une période close.
 *
 * @param {import('sqlite').Database} db
 * @param {Array<string|null|undefined>} dates les dates de la pièce, avant et après
 * @param {{facture?: boolean}} [options] `facture` : propose la note de crédit
 */
async function exigerPeriodeOuverte(db, dates, { facture = false } = {}) {
  const verrou = await dateDeVerrouillage(db);
  if (!dates.some((d) => estVerrouillee(d, verrou))) return;

  throw httpError(409, facture
    ? `La période est verrouillée jusqu'au ${verrou} : pour corriger cette facture, émettez une note de crédit.`
    : `La période est verrouillée jusqu'au ${verrou} : cette pièce ne peut plus être créée, modifiée ni supprimée.`);
}

module.exports = {
  MARQUE_VERROU,
  installerVerrous,
  dateDeVerrouillage,
  estVerrouillee,
  exigerPeriodeOuverte,
  lendemain
};
