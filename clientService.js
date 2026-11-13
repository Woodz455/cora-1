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
  // `documents` compte ce qui rattache le client à la comptabilité : sans
  // aucun, une fiche créée par erreur peut être supprimée ; avec, elle ne peut
  // qu'être archivée.
  const colonnes = `c.*,
    (SELECT COUNT(*) FROM factures f WHERE f.client_id = c.id)
      + (SELECT COUNT(*) FROM devis d WHERE d.client_id = c.id)
      + (SELECT COUNT(*) FROM abonnements a WHERE a.client_id = c.id) AS documents`;
  if (recherche) {
    const motif = `%${recherche}%`;
    return db.all(
      `SELECT ${colonnes} FROM clients c
       WHERE c.nom_entreprise LIKE ? OR c.nom_contact LIKE ? OR c.email LIKE ?
       ORDER BY c.nom_entreprise ASC`,
      [motif, motif, motif]
    );
  }
  return db.all(`SELECT ${colonnes} FROM clients c ORDER BY c.nom_entreprise ASC`);
}

/**
 * Refuse un document neuf pour un client archivé.
 *
 * Archiver un client sert justement à ce qu'on ne lui facture plus rien par
 * mégarde ; ses documents passés, eux, restent intacts et consultables.
 */
function exigerClientActif(client) {
  if (client && client.archive_le) {
    throw Object.assign(
      new Error('Ce client est archivé : réactivez-le pour lui adresser un document.'),
      { status: 400 }
    );
  }
}

/**
 * Archive un client, ou le réactive.
 *
 * Un abonnement actif facturerait encore un client qu'on croit parti : il
 * doit être suspendu d'abord.
 */
async function archiverClient(db, id, archiver) {
  const client = await db.get('SELECT * FROM clients WHERE id = ?', [id]);
  if (!client) throw Object.assign(new Error('Client non trouvé.'), { status: 404 });

  if (archiver) {
    const { n } = await db.get(
      "SELECT COUNT(*) AS n FROM abonnements WHERE client_id = ? AND statut = 'Actif'", [id]
    );
    if (n > 0) {
      throw Object.assign(
        new Error("Ce client a un abonnement actif : suspendez-le avant d'archiver le client."),
        { status: 400 }
      );
    }
  }

  await db.run('UPDATE clients SET archive_le = ? WHERE id = ?', [archiver ? new Date().toISOString() : null, id]);
  return db.get('SELECT * FROM clients WHERE id = ?', [id]);
}

/**
 * Supprime une fiche créée par erreur.
 *
 * Seulement si rien ne la rattache à la comptabilité : une facture, un devis
 * ou un abonnement perdrait sinon son destinataire. Ces clients-là s'archivent.
 */
async function supprimerClient(db, id) {
  const client = await db.get('SELECT * FROM clients WHERE id = ?', [id]);
  if (!client) throw Object.assign(new Error('Client non trouvé.'), { status: 404 });

  const { n } = await db.get(
    `SELECT (SELECT COUNT(*) FROM factures WHERE client_id = ?)
          + (SELECT COUNT(*) FROM devis WHERE client_id = ?)
          + (SELECT COUNT(*) FROM abonnements WHERE client_id = ?) AS n`,
    [id, id, id]
  );
  if (n > 0) {
    throw Object.assign(
      new Error('Ce client a des factures, des devis ou des abonnements : archivez-le plutôt.'),
      { status: 400 }
    );
  }

  await db.run('DELETE FROM clients WHERE id = ?', [id]);
  return client;
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
    `INSERT INTO clients (nom_entreprise, nom_contact, email, adresse, langue, province, conditions_paiement)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [client.nom_entreprise, client.nom_contact, client.email, client.adresse,
      client.langue, client.province, client.conditions_paiement]
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
    `UPDATE clients SET nom_entreprise = ?, nom_contact = ?, email = ?, adresse = ?,
                       langue = ?, province = ?, conditions_paiement = ?
     WHERE id = ?`,
    [client.nom_entreprise, client.nom_contact, client.email, client.adresse,
      client.langue, client.province, client.conditions_paiement, id]
  );
  return db.get('SELECT * FROM clients WHERE id = ?', [id]);
}

module.exports = {
  getClients, createClient, updateClient, archiverClient, supprimerClient, exigerClientActif
};
