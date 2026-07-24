/**
 * Service gérant les opérations liées aux clients.
 */

/**
 * Récupère tous les clients.
 * 
 * @param {import('sqlite').Database} db Instance de la base de données
 * @returns {Promise<Array>} Liste des clients
 */
async function getClients(db) {
  return await db.all('SELECT * FROM clients ORDER BY nom_entreprise ASC');
}

/**
 * Crée un nouveau client.
 * 
 * @param {import('sqlite').Database} db Instance de la base de données
 * @param {string} nom_entreprise 
 * @param {string} nom_contact 
 * @param {string} email 
 * @param {string} adresse 
 * @returns {Promise<Object>} Le client créé
 */
async function createClient(db, nom_entreprise, nom_contact, email, adresse, langue = 'fr', province = 'QC') {
  const result = await db.run(
    'INSERT INTO clients (nom_entreprise, nom_contact, email, adresse, langue, province) VALUES (?, ?, ?, ?, ?, ?)',
    [nom_entreprise, nom_contact || '', email, adresse || '', langue, province]
  );
  
  return await db.get('SELECT * FROM clients WHERE id = ?', [result.lastID]);
}

/**
 * Met à jour un client existant.
 */
async function updateClient(db, id, nom_entreprise, nom_contact, email, adresse, langue = 'fr', province = 'QC') {
  await db.run(
    'UPDATE clients SET nom_entreprise = ?, nom_contact = ?, email = ?, adresse = ?, langue = ?, province = ? WHERE id = ?',
    [nom_entreprise, nom_contact || '', email, adresse || '', langue, province, id]
  );
  return await db.get('SELECT * FROM clients WHERE id = ?', [id]);
}

module.exports = {
  getClients,
  createClient,
  updateClient
};
