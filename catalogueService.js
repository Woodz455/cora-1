/**
 * Service gérant le catalogue de produits et services.
 */

const { sanitizeText } = require('./validators.js');
const { roundCents } = require('./money.js');

/**
 * Valide et normalise un article du catalogue.
 * @returns {{error: string} | {item: Object}}
 */
function validateItem(body) {
  const nom = sanitizeText(body.nom, 200);
  if (!nom) return { error: 'Le nom du service est requis.' };

  const prix = Number(body.prix_unitaire);
  if (!Number.isFinite(prix) || prix < 0) {
    return { error: 'Le prix unitaire doit être un nombre positif.' };
  }

  return {
    item: {
      nom,
      description: sanitizeText(body.description, 1000),
      prix_unitaire: roundCents(prix)
    }
  };
}

async function getCatalogue(db) {
  return db.all('SELECT * FROM catalogue ORDER BY nom ASC');
}

/** Crée un article et retourne la ligne réellement enregistrée. */
async function createCatalogueItem(db, body) {
  const { error, item } = validateItem(body);
  if (error) throw Object.assign(new Error(error), { status: 400 });

  const result = await db.run(
    'INSERT INTO catalogue (nom, description, prix_unitaire) VALUES (?, ?, ?)',
    [item.nom, item.description, item.prix_unitaire]
  );
  return db.get('SELECT * FROM catalogue WHERE id = ?', [result.lastID]);
}

async function updateCatalogueItem(db, id, body) {
  const { error, item } = validateItem(body);
  if (error) throw Object.assign(new Error(error), { status: 400 });

  const existant = await db.get('SELECT id FROM catalogue WHERE id = ?', [id]);
  if (!existant) throw Object.assign(new Error('Article introuvable.'), { status: 404 });

  await db.run(
    'UPDATE catalogue SET nom = ?, description = ?, prix_unitaire = ? WHERE id = ?',
    [item.nom, item.description, item.prix_unitaire, id]
  );
  return db.get('SELECT * FROM catalogue WHERE id = ?', [id]);
}

async function deleteCatalogueItem(db, id) {
  const existant = await db.get('SELECT id FROM catalogue WHERE id = ?', [id]);
  if (!existant) throw Object.assign(new Error('Article introuvable.'), { status: 404 });

  await db.run('DELETE FROM catalogue WHERE id = ?', [id]);
  return { success: true };
}

module.exports = { getCatalogue, createCatalogueItem, updateCatalogueItem, deleteCatalogueItem };
