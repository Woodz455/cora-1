const getCatalogue = async (db) => {
  return await db.all('SELECT * FROM catalogue ORDER BY nom ASC');
};

const createCatalogueItem = async (db, item) => {
  const result = await db.run(
    'INSERT INTO catalogue (nom, description, prix_unitaire) VALUES (?, ?, ?)',
    [item.nom, item.description || '', item.prix_unitaire]
  );
  return { id: result.lastID, ...item };
};

const updateCatalogueItem = async (db, id, item) => {
  await db.run(
    'UPDATE catalogue SET nom = ?, description = ?, prix_unitaire = ? WHERE id = ?',
    [item.nom, item.description || '', item.prix_unitaire, id]
  );
  return { id, ...item };
};

const deleteCatalogueItem = async (db, id) => {
  await db.run('DELETE FROM catalogue WHERE id = ?', [id]);
  return { success: true };
};

module.exports = {
  getCatalogue,
  createCatalogueItem,
  updateCatalogueItem,
  deleteCatalogueItem
};
