/**
 * Service gérant les dépenses et achats (et les taxes récupérables, CTI/RTI).
 */

const { sanitizeText, isValidDate } = require('./validators.js');
const { roundCents } = require('./money.js');

/**
 * Valide une dépense et recalcule son total.
 *
 * Le montant TTC est toujours recalculé côté serveur : il était jusqu'ici repris
 * tel quel du formulaire, ce qui permettait d'enregistrer une dépense dont le
 * total ne correspondait pas à ses composantes et faussait le rapport de taxes.
 *
 * @returns {{error: string} | {depense: Object}}
 */
function validateExpense(body) {
  if (!isValidDate(body.date_depense)) {
    return { error: 'La date de la dépense est requise (format AAAA-MM-JJ).' };
  }

  const montant_ht = Number(body.montant_ht);
  if (!Number.isFinite(montant_ht) || montant_ht < 0) {
    return { error: 'Le montant hors taxes doit être un nombre positif.' };
  }

  const tps = Number(body.tps) || 0;
  const tvq = Number(body.tvq) || 0;
  if (tps < 0 || tvq < 0) {
    return { error: 'Les montants de taxes ne peuvent pas être négatifs.' };
  }

  const ht = roundCents(montant_ht);
  const t1 = roundCents(tps);
  const t2 = roundCents(tvq);

  return {
    depense: {
      fournisseur: sanitizeText(body.fournisseur, 200),
      description: sanitizeText(body.description, 500),
      date_depense: body.date_depense,
      montant_ht: ht,
      tps: t1,
      tvq: t2,
      montant_ttc: roundCents(ht + t1 + t2),
      categorie: sanitizeText(body.categorie, 100)
    }
  };
}

async function getExpenses(db) {
  return db.all('SELECT * FROM depenses ORDER BY date_depense DESC, id DESC');
}

async function createExpense(db, body) {
  const { error, depense } = validateExpense(body);
  if (error) throw Object.assign(new Error(error), { status: 400 });

  const result = await db.run(
    `INSERT INTO depenses (fournisseur, description, date_depense, montant_ht, tps, tvq, montant_ttc, categorie)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [depense.fournisseur, depense.description, depense.date_depense, depense.montant_ht,
      depense.tps, depense.tvq, depense.montant_ttc, depense.categorie]
  );
  return db.get('SELECT * FROM depenses WHERE id = ?', [result.lastID]);
}

async function updateExpense(db, id, body) {
  const { error, depense } = validateExpense(body);
  if (error) throw Object.assign(new Error(error), { status: 400 });

  const existant = await db.get('SELECT id FROM depenses WHERE id = ?', [id]);
  if (!existant) throw Object.assign(new Error('Dépense introuvable.'), { status: 404 });

  await db.run(
    `UPDATE depenses SET fournisseur = ?, description = ?, date_depense = ?, montant_ht = ?,
                         tps = ?, tvq = ?, montant_ttc = ?, categorie = ?
     WHERE id = ?`,
    [depense.fournisseur, depense.description, depense.date_depense, depense.montant_ht,
      depense.tps, depense.tvq, depense.montant_ttc, depense.categorie, id]
  );
  return db.get('SELECT * FROM depenses WHERE id = ?', [id]);
}

async function deleteExpense(db, id) {
  const existant = await db.get('SELECT id FROM depenses WHERE id = ?', [id]);
  if (!existant) throw Object.assign(new Error('Dépense introuvable.'), { status: 404 });

  await db.run('DELETE FROM depenses WHERE id = ?', [id]);
  return { message: 'Dépense supprimée.' };
}

module.exports = { getExpenses, createExpense, updateExpense, deleteExpense };
