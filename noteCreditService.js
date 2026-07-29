/**
 * Service gérant les notes de crédit.
 *
 * Une facture encaissée ne peut être ni modifiée ni supprimée : c'est une pièce
 * comptable. La corriger — remise accordée après coup, marchandise retournée,
 * erreur de facturation — passe donc par l'émission d'une note de crédit, qui
 * vient en diminution du montant dû sans jamais toucher à la facture d'origine.
 */

const { computeTotals, roundCents, formatMontant } = require('./money.js');
const { withTransaction } = require('./dbUtils.js');
const { nextDocumentNumber } = require('./sequences.js');

/** Tolérance d'un demi-cent, alignée sur invoiceService. */
const EPSILON = 0.005;

/** Source de numérotation des notes de crédit (voir sequences.js). */
const SOURCE_NUMERO = { table: 'notes_credit', column: 'numero_note' };

/** Colonnes de montants, figées à l'émission comme pour les factures. */
const COLONNES_MONTANTS = `
  COALESCE(n.sous_total, 0) AS sous_total,
  COALESCE(n.montant_taxe_1, 0) AS montant_taxe_1,
  COALESCE(n.montant_taxe_2, 0) AS montant_taxe_2,
  COALESCE(n.montant_total, 0) AS montant_total
`;

/**
 * Notes de crédit rattachées à une facture.
 *
 * @param {import('sqlite').Database} db
 * @param {number} factureId
 * @returns {Promise<Array>}
 */
async function getNotesCreditPourFacture(db, factureId) {
  return db.all(`
    SELECT n.id, n.numero_note, n.facture_id, n.date_emission, n.motif,
           n.taux_taxe_1, n.taux_taxe_2, n.taxe_1_nom, n.taxe_2_nom,
           n.devise, n.taux_change,
           ${COLONNES_MONTANTS}
    FROM notes_credit n
    WHERE n.facture_id = ?
    ORDER BY n.date_emission ASC, n.id ASC
  `, [factureId]);
}

/** Liste complète des notes de crédit, avec le client et la facture d'origine. */
async function getNotesCredit(db) {
  return db.all(`
    SELECT n.id, n.numero_note, n.facture_id, n.date_emission, n.motif,
           n.devise, n.taux_change,
           f.numero_facture,
           c.nom_entreprise AS client,
           ${COLONNES_MONTANTS}
    FROM notes_credit n
    JOIN factures f ON f.id = n.facture_id
    JOIN clients c ON c.id = f.client_id
    ORDER BY n.date_emission DESC, n.id DESC
  `);
}

/** Détails complets d'une note de crédit, pour l'impression et le courriel. */
async function getNoteCreditDetails(db, noteId) {
  const note = await db.get(`
    SELECT n.*, ${COLONNES_MONTANTS},
           f.numero_facture, f.date_emission AS facture_date_emission, f.client_id
    FROM notes_credit n
    JOIN factures f ON f.id = n.facture_id
    WHERE n.id = ?
  `, [noteId]);

  if (!note) return null;

  const [client, lignes, settings] = await Promise.all([
    db.get('SELECT * FROM clients WHERE id = ?', [note.client_id]),
    db.all('SELECT * FROM lignes_note_credit WHERE note_id = ? ORDER BY id ASC', [noteId]),
    db.get('SELECT * FROM settings LIMIT 1')
  ]);

  return { ...note, client_details: client, lignes, settings };
}

/**
 * Émet une note de crédit sur une facture.
 *
 * Le montant cumulé des notes ne peut pas dépasser le total de la facture :
 * créditer davantage reviendrait à devoir au client plus que ce qui lui a
 * jamais été facturé.
 *
 * @param {import('sqlite').Database} db
 * @param {number} factureId
 * @param {{date_emission: string, motif: string}} donnees
 * @param {Array<{description: string, quantite: number, prix_unitaire: number}>} lignes
 * @returns {Promise<Object>} la note créée
 */
async function createNoteCredit(db, factureId, donnees, lignes) {
  const { date_emission, motif = '' } = donnees;

  return withTransaction(db, async () => {
    const facture = await db.get(`
      SELECT id, numero_facture, statut, montant_total,
             taux_taxe_1, taux_taxe_2, taxe_1_nom, taxe_2_nom, devise, taux_change
      FROM factures WHERE id = ?
    `, [factureId]);

    if (!facture) {
      throw Object.assign(new Error('Facture non trouvée.'), { status: 404 });
    }
    if (facture.statut === 'Annulée') {
      throw Object.assign(
        new Error('Une facture annulée n\'a rien à créditer.'),
        { status: 400 }
      );
    }

    // Les taxes de la note reprennent celles de la facture : c'est bien la
    // taxe collectée à l'origine que l'on annule, au taux d'alors.
    const montants = computeTotals(lignes, facture.taux_taxe_1, facture.taux_taxe_2);
    if (montants.montant_total <= 0) {
      throw Object.assign(new Error('Le montant de la note de crédit doit être strictement positif.'), { status: 400 });
    }

    const { deja } = await db.get(
      'SELECT COALESCE(SUM(montant_total), 0) AS deja FROM notes_credit WHERE facture_id = ?',
      [factureId]
    );
    const disponible = roundCents(facture.montant_total - deja);

    if (montants.montant_total > disponible + EPSILON) {
      throw Object.assign(
        new Error(
          `Le crédit (${formatMontant(montants.montant_total, facture.devise)}) dépasse le montant `
          + `créditable de la facture ${facture.numero_facture} (${formatMontant(disponible, facture.devise)}).`
        ),
        { status: 400 }
      );
    }

    const numero_note = await nextDocumentNumber(db, 'NC', date_emission, SOURCE_NUMERO);

    const result = await db.run(`
      INSERT INTO notes_credit (numero_note, facture_id, date_emission, motif,
                                taux_taxe_1, taux_taxe_2, taxe_1_nom, taxe_2_nom,
                                devise, taux_change,
                                sous_total, montant_taxe_1, montant_taxe_2, montant_total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [numero_note, factureId, date_emission, motif,
      facture.taux_taxe_1, facture.taux_taxe_2, facture.taxe_1_nom, facture.taxe_2_nom,
      facture.devise, facture.taux_change,
      montants.sous_total, montants.taxe_1, montants.taxe_2, montants.montant_total]);

    const noteId = result.lastID;
    for (const ligne of lignes) {
      await db.run(
        'INSERT INTO lignes_note_credit (note_id, description, quantite, prix_unitaire) VALUES (?, ?, ?, ?)',
        [noteId, ligne.description, ligne.quantite, ligne.prix_unitaire]
      );
    }

    // Le solde de la facture a changé : son statut doit suivre.
    const { syncStatut } = require('./invoiceService.js');
    await syncStatut(db, factureId);

    return db.get(`
      SELECT n.*, ${COLONNES_MONTANTS} FROM notes_credit n WHERE n.id = ?
    `, [noteId]);
  });
}

/**
 * Supprime une note de crédit.
 *
 * Autorisé uniquement tant que la facture n'a reçu aucun paiement : au-delà, la
 * note a participé au calcul de ce qui a été encaissé, et la retirer fausserait
 * l'historique. Même règle que pour la suppression d'une facture.
 */
async function deleteNoteCredit(db, noteId) {
  return withTransaction(db, async () => {
    const note = await db.get('SELECT id, facture_id, numero_note FROM notes_credit WHERE id = ?', [noteId]);
    if (!note) {
      throw Object.assign(new Error('Note de crédit non trouvée.'), { status: 404 });
    }

    const { paye } = await db.get(
      'SELECT COALESCE(SUM(montant), 0) AS paye FROM paiements WHERE facture_id = ? AND annule_le IS NULL',
      [note.facture_id]
    );
    if (paye > EPSILON) {
      throw Object.assign(
        new Error('La facture rattachée comporte un paiement : cette note de crédit ne peut plus être supprimée.'),
        { status: 400 }
      );
    }

    await db.run('DELETE FROM notes_credit WHERE id = ?', [noteId]);

    const { syncStatut } = require('./invoiceService.js');
    await syncStatut(db, note.facture_id);

    return { message: `Note de crédit ${note.numero_note} supprimée.` };
  });
}

module.exports = {
  getNotesCredit,
  getNotesCreditPourFacture,
  getNoteCreditDetails,
  createNoteCredit,
  deleteNoteCredit
};
