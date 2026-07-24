/**
 * Service gérant les opérations liées aux dépenses.
 */

async function getExpenses(db) {
  return await db.all('SELECT * FROM depenses ORDER BY date_depense DESC');
}

async function createExpense(db, data) {
  const { fournisseur, description, date_depense, montant_ht, tps, tvq, montant_ttc, categorie } = data;
  const result = await db.run(
    'INSERT INTO depenses (fournisseur, description, date_depense, montant_ht, tps, tvq, montant_ttc, categorie) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [fournisseur || '', description || '', date_depense, montant_ht || 0, tps || 0, tvq || 0, montant_ttc || 0, categorie || '']
  );
  return await db.get('SELECT * FROM depenses WHERE id = ?', [result.lastID]);
}

async function updateExpense(db, id, data) {
  const { fournisseur, description, date_depense, montant_ht, tps, tvq, montant_ttc, categorie } = data;
  await db.run(
    'UPDATE depenses SET fournisseur = ?, description = ?, date_depense = ?, montant_ht = ?, tps = ?, tvq = ?, montant_ttc = ?, categorie = ? WHERE id = ?',
    [fournisseur || '', description || '', date_depense, montant_ht || 0, tps || 0, tvq || 0, montant_ttc || 0, categorie || '', id]
  );
  return await db.get('SELECT * FROM depenses WHERE id = ?', [id]);
}

async function deleteExpense(db, id) {
  await db.run('DELETE FROM depenses WHERE id = ?', [id]);
  return { message: 'Dépense supprimée' };
}

module.exports = {
  getExpenses,
  createExpense,
  updateExpense,
  deleteExpense
};
