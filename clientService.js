/**
 * Service gérant les opérations liées aux clients.
 *
 * Les fonctions reçoivent un objet client déjà validé par `validators.js`
 * plutôt qu'une longue liste d'arguments positionnels, où une inversion entre
 * `langue` et `province` passait inaperçue.
 */

/**
 * Récupère les clients, avec recherche optionnelle sur le nom, le contact ou le courriel.
 *
 * @param {import('sqlite').Database} db
 * @param {string} [recherche]
 * @returns {Promise<Array>}
 */
async function getClients(db, recherche) {
  if (recherche) {
    const motif = `%${recherche}%`;
    return db.all(
      `SELECT * FROM clients
       WHERE nom_entreprise LIKE ? OR nom_contact LIKE ? OR email LIKE ?
       ORDER BY nom_entreprise ASC`,
      [motif, motif, motif]
    );
  }
  return db.all('SELECT * FROM clients ORDER BY nom_entreprise ASC');
}

/**
 * Crée un client.
 *
 * @param {import('sqlite').Database} db
 * @param {{nom_entreprise: string, nom_contact: string, email: string, adresse: string, langue: string, province: string}} client
 * @returns {Promise<Object>} le client créé
 */
async function createClient(db, client) {
  const result = await db.run(
    'INSERT INTO clients (nom_entreprise, nom_contact, email, adresse, langue, province) VALUES (?, ?, ?, ?, ?, ?)',
    [client.nom_entreprise, client.nom_contact, client.email, client.adresse, client.langue, client.province]
  );
  return db.get('SELECT * FROM clients WHERE id = ?', [result.lastID]);
}

/**
 * Met à jour un client.
 *
 * La province n'est pas répercutée sur les documents déjà émis : les taux de
 * taxe sont figés à l'émission, une facture passée ne doit pas changer de montant.
 */
async function updateClient(db, id, client) {
  const existant = await db.get('SELECT id FROM clients WHERE id = ?', [id]);
  if (!existant) {
    throw Object.assign(new Error('Client non trouvé.'), { status: 404 });
  }

  await db.run(
    'UPDATE clients SET nom_entreprise = ?, nom_contact = ?, email = ?, adresse = ?, langue = ?, province = ? WHERE id = ?',
    [client.nom_entreprise, client.nom_contact, client.email, client.adresse, client.langue, client.province, id]
  );
  return db.get('SELECT * FROM clients WHERE id = ?', [id]);
}

module.exports = { getClients, createClient, updateClient };
