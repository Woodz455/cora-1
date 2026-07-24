const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs');

// Définit le chemin du fichier de base de données local par défaut
let dbPath = path.resolve(__dirname, 'database.sqlite');

if (process.versions && process.versions.electron) {
  const { app } = require('electron');
  if (app && app.isPackaged) {
    const userData = app.getPath('userData'); // Utilise %APPDATA%/safequick sous Windows
    dbPath = path.join(userData, 'database.sqlite');
  }
}


/**
 * Initialise la base de données, crée les tables si elles n'existent pas, 
 * et insère un jeu de données fictives (seed) pour tester l'application.
 */
async function initDb() {
  try {
    // 1. Ouvre la connexion à la base de données
    // Si le fichier database.sqlite n'existe pas, il sera créé automatiquement.
    const db = await open({
      filename: dbPath,
      driver: sqlite3.Database
    });

    console.log('Connexion à la base de données SQLite établie.');

    // 2. Active explicitement le support des clés étrangères
    // Requis dans SQLite pour que les contraintes ON DELETE CASCADE fonctionnent
    await db.exec('PRAGMA foreign_keys = ON;');

    // 3. Création du schéma des tables
    await db.exec(`
      CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nom_entreprise TEXT NOT NULL,
        nom_contact TEXT,
        email TEXT NOT NULL,
        adresse TEXT
      );

      CREATE TABLE IF NOT EXISTS factures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        numero_facture TEXT UNIQUE NOT NULL,
        client_id INTEGER,
        date_emission TEXT NOT NULL,
        date_echeance TEXT NOT NULL,
        statut TEXT NOT NULL,
        FOREIGN KEY (client_id) REFERENCES clients (id)
      );

      CREATE TABLE IF NOT EXISTS lignes_facture (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        facture_id INTEGER,
        description TEXT NOT NULL,
        quantite REAL DEFAULT 1,
        prix_unitaire REAL NOT NULL,
        FOREIGN KEY (facture_id) REFERENCES factures (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS paiements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        facture_id INTEGER,
        date_paiement TEXT NOT NULL,
        montant REAL NOT NULL,
        note TEXT,
        FOREIGN KEY (facture_id) REFERENCES factures (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS catalogue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nom TEXT NOT NULL,
        description TEXT,
        prix_unitaire REAL NOT NULL
      );
    `);

    // Migrations
    try {
      await db.exec('ALTER TABLE clients ADD COLUMN langue TEXT DEFAULT "fr"');
    } catch (e) { /* Column probably already exists */ }

    try {
      await db.exec('ALTER TABLE settings ADD COLUMN payment_instructions TEXT DEFAULT ""');
    } catch (e) { /* Column probably already exists */ }

    await db.exec(`
      CREATE TABLE IF NOT EXISTS devis (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        numero_devis TEXT UNIQUE,
        client_id INTEGER,
        date_emission TEXT,
        date_validite TEXT,
        statut TEXT DEFAULT 'En attente',
        taux_taxe_1 REAL DEFAULT 0,
        taux_taxe_2 REAL DEFAULT 0,
        facture_id INTEGER,
        FOREIGN KEY(client_id) REFERENCES clients(id),
        FOREIGN KEY(facture_id) REFERENCES factures(id)
      );
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS lignes_devis (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        devis_id INTEGER,
        description TEXT,
        quantite REAL,
        prix_unitaire REAL,
        FOREIGN KEY(devis_id) REFERENCES devis(id)
      );
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entreprise_nom TEXT,
        entreprise_adresse TEXT,
        entreprise_email TEXT,
        taxe_1_nom TEXT,
        taxe_1_taux REAL,
        taxe_1_numero TEXT,
        taxe_2_nom TEXT,
        taxe_2_taux REAL,
        taxe_2_numero TEXT,
        payment_instructions TEXT DEFAULT "",
        admin_username TEXT,
        admin_password TEXT
      );
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS depenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fournisseur TEXT,
        description TEXT,
        date_depense TEXT,
        montant_ht REAL DEFAULT 0,
        tps REAL DEFAULT 0,
        tvq REAL DEFAULT 0,
        montant_ttc REAL DEFAULT 0,
        categorie TEXT
      );
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'employe'
      );
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS transactions_bancaires (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date_transaction TEXT NOT NULL,
        description TEXT NOT NULL,
        montant REAL NOT NULL,
        statut TEXT DEFAULT 'En attente',
        facture_id INTEGER,
        FOREIGN KEY (facture_id) REFERENCES factures (id) ON DELETE SET NULL
      );
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS abonnements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL,
        titre TEXT NOT NULL,
        lignes_json TEXT NOT NULL,
        cycle TEXT NOT NULL DEFAULT 'Mensuel',
        date_prochaine_generation TEXT NOT NULL,
        statut TEXT NOT NULL DEFAULT 'Actif',
        devise TEXT DEFAULT 'CAD',
        FOREIGN KEY (client_id) REFERENCES clients (id)
      );
    `);

    try {
      await db.exec('ALTER TABLE factures ADD COLUMN taux_taxe_1 REAL DEFAULT 0;');
      await db.exec('ALTER TABLE factures ADD COLUMN taux_taxe_2 REAL DEFAULT 0;');
    } catch (e) {}

    try {
      await db.exec('ALTER TABLE factures ADD COLUMN relances_envoyees INTEGER DEFAULT 0;');
      await db.exec('ALTER TABLE factures ADD COLUMN date_derniere_relance TEXT;');
    } catch (e) {}

    try {
      await db.exec('ALTER TABLE clients ADD COLUMN province TEXT DEFAULT "";');
    } catch (e) {}

    try {
      await db.exec('ALTER TABLE factures ADD COLUMN taxe_1_nom TEXT DEFAULT "";');
      await db.exec('ALTER TABLE factures ADD COLUMN taxe_2_nom TEXT DEFAULT "";');
    } catch (e) {}

    try {
      await db.exec('ALTER TABLE devis ADD COLUMN taxe_1_nom TEXT DEFAULT "";');
      await db.exec('ALTER TABLE devis ADD COLUMN taxe_2_nom TEXT DEFAULT "";');
    } catch (e) {}

    try {
      await db.exec('ALTER TABLE factures ADD COLUMN devise TEXT DEFAULT "CAD";');
      await db.exec('ALTER TABLE factures ADD COLUMN taux_change REAL DEFAULT 1.0;');
    } catch (e) {}

    try {
      await db.exec('ALTER TABLE devis ADD COLUMN devise TEXT DEFAULT "CAD";');
      await db.exec('ALTER TABLE devis ADD COLUMN taux_change REAL DEFAULT 1.0;');
    } catch (e) {}

    try {
      await db.exec('ALTER TABLE settings ADD COLUMN admin_username TEXT;');
    } catch (e) {}
    try {
      await db.exec('ALTER TABLE settings ADD COLUMN admin_password TEXT;');
    } catch (e) {}
    try {
      await db.exec('ALTER TABLE settings ADD COLUMN entreprise_logo TEXT;');
    } catch (e) {}

    const existingSettings = await db.get('SELECT id, admin_username, admin_password FROM settings LIMIT 1');
    if (!existingSettings) {
      await db.run(`INSERT INTO settings (entreprise_nom, entreprise_adresse, entreprise_email, taxe_1_nom, taxe_1_taux, taxe_1_numero, taxe_2_nom, taxe_2_taux, taxe_2_numero) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    ['Safehill Technologies', '', 'contact@safehilltechnologies.ca', 'TPS', 0.05, '', 'TVQ', 0.09975, '']);
    } else if (existingSettings.admin_username && existingSettings.admin_password) {
      // Migrate admin_username to users table if it exists
      const existingUser = await db.get('SELECT id FROM users WHERE username = ?', [existingSettings.admin_username]);
      if (!existingUser) {
        await db.run(
          'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
          [existingSettings.admin_username, existingSettings.admin_password, 'admin']
        );
      }
      // Set to null to indicate migration is done
      await db.run('UPDATE settings SET admin_username = NULL, admin_password = NULL WHERE id = ?', [existingSettings.id]);
    }

    console.log('Tables vérifiées et créées avec succès.');

    // 4. Insertion du jeu de données fictives (Seed)
    // On vérifie d'abord si des clients existent déjà pour éviter de recréer le seed à chaque démarrage
    const existingClient = await db.get('SELECT id FROM clients LIMIT 1');

    if (!existingClient) {
      console.log('Aucune donnée trouvée. Insertion du jeu de données de test...');

      // Création d'un client
      const clientResult = await db.run(
        'INSERT INTO clients (nom_entreprise, nom_contact, email, adresse) VALUES (?, ?, ?, ?)',
        ['Safehill Technologies', 'Alice Dupont', 'alice@safehill.tech', '123 Avenue de Innovation, Paris']
      );
      const clientId = clientResult.lastID;

      // Création d'une facture
      const factureResult = await db.run(
        'INSERT INTO factures (numero_facture, client_id, date_emission, date_echeance, statut) VALUES (?, ?, ?, ?, ?)',
        ['FA-2026-001', clientId, '2026-06-01', '2026-06-15', 'Partiellement payée']
      );
      const factureId = factureResult.lastID;

      // Création des lignes de facture pour atteindre un total de 1720$
      // Ligne 1 : 1000$ (1 x 1000$)
      await db.run(
        'INSERT INTO lignes_facture (facture_id, description, quantite, prix_unitaire) VALUES (?, ?, ?, ?)',
        [factureId, 'Développement module RPA', 1, 1000.0]
      );

      // Ligne 2 : 720$ (8 x 90$)
      await db.run(
        'INSERT INTO lignes_facture (facture_id, description, quantite, prix_unitaire) VALUES (?, ?, ?, ?)',
        [factureId, 'Ajustement design', 8, 90.0]
      );

      // Enregistrement d'un paiement partiel de 500$
      await db.run(
        'INSERT INTO paiements (facture_id, date_paiement, montant, note) VALUES (?, ?, ?, ?)',
        [factureId, '2026-06-08', 500.0, 'Virement virement partiel']
      );

      console.log('Jeu de données de test inséré avec succès.');
      console.log('- Facture totale de 1720$ avec 2 lignes créées.');
      console.log('- Paiement partiel de 500$ enregistré.');
    } else {
      console.log('La base de données contient déjà des données, ajout du seed ignoré.');
    }

    return db;
  } catch (error) {
    console.error('Erreur lors de initialisation de la base de données :', error);
    throw error;
  }
}

// Permet d'exécuter le script directement en ligne de commande via `node database.js`
if (require.main === module) {
  initDb()
    .then((db) => {
      console.log('Script initialisation terminé.');
      // Ferme la connexion proprement à la fin de l'exécution en CLI
      return db.close();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

// Exporte la fonction pour être appelée au démarrage de l'API Node.js
module.exports = { initDb };
