/**
 * Rapprochement bancaire.
 *
 * Un dépôt ne réglait qu'une facture, pour son montant entier : un versement de
 * 3 000 $ couvrant plusieurs factures ne pouvait être rapproché d'aucune, le
 * contrôle de sur-paiement refusant l'imputation. Il s'affecte désormais par
 * parts successives, et la transaction reste disponible tant qu'il lui reste
 * quelque chose à imputer.
 *
 * Le montant déjà affecté n'est jamais stocké : il se déduit des paiements qui
 * désignent la transaction. Un total conservé en base aurait fini par diverger
 * de la somme des paiements — annulation d'un encaissement, suppression d'une
 * facture — sans que rien ne le signale.
 */

const { withTransaction } = require('./dbUtils.js');
const { roundCents, formatMontant } = require('./money.js');

/** Statuts d'une transaction importée. */
const STATUTS = {
  EN_ATTENTE: 'En attente',
  PARTIEL: 'Partiellement rapproché',
  RAPPROCHE: 'Rapproché',
  IGNORE: 'Ignoré'
};

/** Statuts pour lesquels il reste quelque chose à faire. */
const STATUTS_ACTIFS = [STATUTS.EN_ATTENTE, STATUTS.PARTIEL];

/** Tolérance d'un demi-cent, cohérente avec le reste de l'application. */
const EPSILON = 0.005;

/** Nombre maximal de lignes acceptées dans un relevé. */
const MAX_LIGNES = 5000;

/** Somme des paiements actifs imputés sur une transaction. */
const ALLOUE = `
  COALESCE((
    SELECT ROUND(SUM(p.montant), 2) FROM paiements p
    WHERE p.transaction_id = t.id AND p.annule_le IS NULL
  ), 0)
`;

const COLONNES = `
  t.id, t.date_transaction, t.description, t.montant, t.statut, t.facture_id,
  ${ALLOUE} AS montant_rapproche,
  ROUND(t.montant - ${ALLOUE}, 2) AS montant_restant
`;

/** Statut qu'une transaction devrait porter au vu de ce qui lui est imputé. */
function resolveStatutTransaction(statutActuel, montant, alloue) {
  // Un dépôt volontairement écarté le reste, quoi qu'il arrive ensuite.
  if (statutActuel === STATUTS.IGNORE) return STATUTS.IGNORE;
  if (alloue >= montant - EPSILON) return STATUTS.RAPPROCHE;
  if (alloue > EPSILON) return STATUTS.PARTIEL;
  return STATUTS.EN_ATTENTE;
}

/**
 * Réaligne le statut d'une transaction et son lien de facture.
 *
 * `facture_id` ne garde un sens que si une seule facture est concernée : réparti
 * sur plusieurs, le dépôt n'en désigne aucune, et c'est `paiements.transaction_id`
 * qui porte le détail.
 */
async function majStatutTransaction(db, transactionId) {
  const t = await db.get(
    `SELECT t.id, t.montant, t.statut, ${ALLOUE} AS alloue FROM transactions_bancaires t WHERE t.id = ?`,
    [transactionId]
  );
  if (!t) return null;

  const factures = await db.all(
    'SELECT DISTINCT facture_id FROM paiements WHERE transaction_id = ? AND annule_le IS NULL',
    [transactionId]
  );

  await db.run(
    'UPDATE transactions_bancaires SET statut = ?, facture_id = ? WHERE id = ?',
    [
      resolveStatutTransaction(t.statut, t.montant, t.alloue),
      factures.length === 1 ? factures[0].facture_id : null,
      transactionId
    ]
  );
  return t;
}

/**
 * Transactions d'un statut donné, ou toutes celles qui restent à traiter.
 *
 * @param {import('sqlite').Database} db
 * @param {string} [statut] statut exact ; à défaut, en attente et partielles
 */
async function getTransactions(db, statut) {
  if (statut && Object.values(STATUTS).includes(statut)) {
    return db.all(
      `SELECT ${COLONNES} FROM transactions_bancaires t
       WHERE t.statut = ? ORDER BY t.date_transaction DESC, t.id DESC`,
      [statut]
    );
  }

  return db.all(
    `SELECT ${COLONNES} FROM transactions_bancaires t
     WHERE t.statut IN (?, ?) ORDER BY t.date_transaction DESC, t.id DESC`,
    STATUTS_ACTIFS
  );
}

/** Détail d'une transaction, avec ce qui lui reste à imputer. */
async function getTransaction(db, transactionId) {
  return db.get(
    `SELECT ${COLONNES} FROM transactions_bancaires t WHERE t.id = ?`,
    [transactionId]
  );
}

/** Paiements imputés sur une transaction, annulés compris. */
async function getImputations(db, transactionId) {
  return db.all(
    `SELECT p.id, p.montant, p.date_paiement, p.annule_le, f.numero_facture
     FROM paiements p
     JOIN factures f ON f.id = p.facture_id
     WHERE p.transaction_id = ?
     ORDER BY p.date_paiement ASC, p.id ASC`,
    [transactionId]
  );
}

/**
 * Importe un relevé. Seuls les dépôts sont retenus, et les lignes déjà présentes
 * sont ignorées : réimporter le même relevé dupliquait toutes ses transactions.
 */
async function importerTransactions(db, lignes, { valider }) {
  return withTransaction(db, async () => {
    let inserted = 0;
    let ignored = 0;
    let invalid = 0;

    for (const ligne of lignes) {
      const t = valider(ligne);
      if (!t) { invalid += 1; continue; }
      if (t.montant <= 0) {
        ignored += 1; // Retrait ou frais : hors périmètre du rapprochement de factures.
        continue;
      }

      const doublon = await db.get(
        `SELECT id FROM transactions_bancaires
         WHERE date_transaction = ? AND description = ? AND ABS(montant - ?) < 0.005`,
        [t.date, t.description, t.montant]
      );
      if (doublon) { ignored += 1; continue; }

      await db.run(
        'INSERT INTO transactions_bancaires (date_transaction, description, montant, statut) VALUES (?, ?, ?, ?)',
        [t.date, t.description, t.montant, STATUTS.EN_ATTENTE]
      );
      inserted += 1;
    }

    return { inserted, ignored, invalid };
  });
}

/**
 * Impute tout ou partie d'un dépôt sur une facture.
 *
 * Sans montant précisé, on impute le maximum possible : le plus petit du reste
 * du dépôt et du solde de la facture. C'est le geste courant — solder la facture,
 * ou verser tout ce qui reste — et il évite une saisie de plus.
 *
 * @param {import('sqlite').Database} db
 * @param {number} transactionId
 * @param {number} factureId
 * @param {number} [montantDemande] part à imputer, dans la devise du dépôt
 */
async function rapprocher(db, transactionId, factureId, montantDemande = null) {
  // Import tardif : invoiceService charge ce module pour rétablir le statut d'une
  // transaction quand un paiement est annulé. Le require ici évite le cycle.
  const { addPaiement, getSoldeFacture } = require('./invoiceService.js');

  return withTransaction(db, async () => {
    const transaction = await getTransaction(db, transactionId);
    if (!transaction) {
      throw Object.assign(new Error('Transaction non trouvée.'), { status: 404 });
    }
    if (transaction.statut === STATUTS.IGNORE) {
      throw Object.assign(new Error('Cette transaction a été ignorée.'), { status: 400 });
    }
    if (transaction.montant_restant <= EPSILON) {
      throw Object.assign(new Error('Ce dépôt est déjà entièrement imputé.'), { status: 400 });
    }

    const facture = await db.get(
      'SELECT id, numero_facture, devise FROM factures WHERE id = ?', [factureId]
    );
    if (!facture) {
      throw Object.assign(new Error('Facture non trouvée.'), { status: 404 });
    }
    // Un dépôt en dollars canadiens imputé tel quel sur un solde en dollars
    // américains fausserait les deux.
    if ((facture.devise || 'CAD') !== 'CAD') {
      throw Object.assign(
        new Error(`La facture ${facture.numero_facture} est libellée en ${facture.devise} :`
          + ' saisissez le paiement manuellement dans sa devise.'),
        { status: 400 }
      );
    }

    const solde = (await getSoldeFacture(db, factureId)).solde_restant;
    const montant = montantDemande === null || montantDemande === undefined
      ? roundCents(Math.min(transaction.montant_restant, solde))
      : roundCents(montantDemande);

    if (!(montant > 0)) {
      throw Object.assign(
        new Error('Le montant à imputer doit être strictement positif.'), { status: 400 }
      );
    }
    if (montant > transaction.montant_restant + EPSILON) {
      throw Object.assign(
        new Error(`Le montant imputé (${formatMontant(montant)}) dépasse ce qui reste`
          + ` de ce dépôt (${formatMontant(transaction.montant_restant)}).`),
        { status: 400 }
      );
    }

    // addPaiement refuse déjà tout dépassement du solde de la facture.
    await addPaiement(
      db, factureId, montant,
      `Rapprochement bancaire : ${transaction.description}`,
      transaction.date_transaction,
      transactionId
    );

    await majStatutTransaction(db, transactionId);
    return getTransaction(db, transactionId);
  });
}

/** Écarte un dépôt du rapprochement (frais, virement interne, doublon bancaire). */
async function ignorer(db, transactionId) {
  const transaction = await getTransaction(db, transactionId);
  if (!transaction) {
    throw Object.assign(new Error('Transaction non trouvée.'), { status: 404 });
  }
  if (transaction.montant_rapproche > EPSILON) {
    throw Object.assign(
      new Error('Ce dépôt est déjà imputé sur une facture : annulez d\'abord les encaissements correspondants.'),
      { status: 400 }
    );
  }

  await db.run('UPDATE transactions_bancaires SET statut = ? WHERE id = ?', [STATUTS.IGNORE, transactionId]);
  return { success: true };
}

module.exports = {
  getTransactions,
  getTransaction,
  getImputations,
  importerTransactions,
  rapprocher,
  ignorer,
  majStatutTransaction,
  resolveStatutTransaction,
  STATUTS,
  STATUTS_ACTIFS,
  MAX_LIGNES
};
