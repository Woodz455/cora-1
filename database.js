const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { getDbPath } = require('./config.js');
const { appliquerRestaurationEnAttente } = require('./backupService.js');

/** Journalisation silencieuse sous test, pour ne pas noyer la sortie. */
const log = (...args) => {
  if (process.env.NODE_ENV !== 'test') console.log(...args);
};

/**
 * Indique si une colonne existe déjà sur une table.
 *
 * Les migrations s'appuient sur cette vérification plutôt que sur un
 * `try { ALTER TABLE } catch {}` : regrouper plusieurs ALTER dans un même bloc
 * try faisait qu'une colonne déjà présente empêchait définitivement l'ajout des
 * suivantes, laissant des bases dans un état incomplet et silencieux.
 */
async function columnExists(db, table, column) {
  const rows = await db.all(`PRAGMA table_info(${table})`);
  return rows.some((r) => r.name === column);
}

/**
 * Ajoute une colonne si elle est absente. Idempotent, et sûr à appeler à chaque
 * démarrage.
 */
async function addColumn(db, table, column, definition) {
  if (await columnExists(db, table, column)) return false;
  await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  log(`Migration : colonne ${table}.${column} ajoutée.`);
  return true;
}

/** Création du schéma de base (tables et contraintes). */
async function createTables(db) {
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
      taxe_2_numero TEXT
    );

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
      FOREIGN KEY (client_id) REFERENCES clients (id),
      FOREIGN KEY (facture_id) REFERENCES factures (id)
    );

    CREATE TABLE IF NOT EXISTS lignes_devis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      devis_id INTEGER,
      description TEXT,
      quantite REAL,
      prix_unitaire REAL,
      FOREIGN KEY (devis_id) REFERENCES devis (id) ON DELETE CASCADE
    );

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

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'employe'
    );

    CREATE TABLE IF NOT EXISTS transactions_bancaires (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date_transaction TEXT NOT NULL,
      description TEXT NOT NULL,
      montant REAL NOT NULL,
      statut TEXT DEFAULT 'En attente',
      facture_id INTEGER,
      FOREIGN KEY (facture_id) REFERENCES factures (id) ON DELETE SET NULL
    );

    -- Notes de crédit. Une facture encaissée ne peut être ni modifiée ni
    -- supprimée : la corriger passe par l'émission d'une note de crédit, qui
    -- est elle-même une pièce comptable, avec son numéro et ses taxes.
    CREATE TABLE IF NOT EXISTS notes_credit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero_note TEXT UNIQUE NOT NULL,
      facture_id INTEGER NOT NULL,
      date_emission TEXT NOT NULL,
      motif TEXT,
      -- Taux repris de la facture d'origine : une note de crédit doit annuler
      -- exactement les taxes qui ont été facturées.
      taux_taxe_1 REAL DEFAULT 0,
      taux_taxe_2 REAL DEFAULT 0,
      taxe_1_nom TEXT DEFAULT '',
      taxe_2_nom TEXT DEFAULT '',
      devise TEXT DEFAULT 'CAD',
      taux_change REAL DEFAULT 1.0,
      sous_total REAL,
      montant_taxe_1 REAL,
      montant_taxe_2 REAL,
      montant_total REAL,
      FOREIGN KEY (facture_id) REFERENCES factures (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS lignes_note_credit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id INTEGER,
      description TEXT NOT NULL,
      quantite REAL DEFAULT 1,
      prix_unitaire REAL NOT NULL,
      FOREIGN KEY (note_id) REFERENCES notes_credit (id) ON DELETE CASCADE
    );

    -- Journal des relances envoyées. Une ligne par palier et par facture :
    -- c'est ce qui garantit qu'un même rappel n'est jamais envoyé deux fois.
    CREATE TABLE IF NOT EXISTS relances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      facture_id INTEGER NOT NULL,
      palier_jours INTEGER NOT NULL,
      date_envoi TEXT NOT NULL,
      destinataire TEXT,
      origine TEXT NOT NULL DEFAULT 'automatique',
      statut TEXT NOT NULL DEFAULT 'Envoyée',
      erreur TEXT,
      FOREIGN KEY (facture_id) REFERENCES factures (id) ON DELETE CASCADE
    );

    -- Compteurs de numérotation des documents. Jamais décrémentés, afin qu'un
    -- numéro déjà émis ne puisse pas être réattribué (voir sequences.js).
    CREATE TABLE IF NOT EXISTS document_sequences (
      prefix TEXT PRIMARY KEY,
      last_value INTEGER NOT NULL DEFAULT 0
    );

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

    -- Journal des actions sensibles. Aucune clé étrangère : la trace doit
    -- survivre à la suppression de ce qu'elle décrit, sans quoi effacer une
    -- facture effacerait la preuve qu'on l'a effacée.
    CREATE TABLE IF NOT EXISTS logs_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date_heure TEXT NOT NULL,
      utilisateur TEXT,
      role TEXT,
      action TEXT NOT NULL,
      entite TEXT,
      entite_id INTEGER,
      details TEXT
    );
  `);

  // En ajout seul, et pas seulement par convention : un journal qu'une route
  // distraite — ou malveillante — peut réécrire ne prouve rien. C'est SQLite
  // qui refuse, quel que soit le chemin emprunté.
  await db.exec(`
    CREATE TRIGGER IF NOT EXISTS logs_audit_sans_modification
    BEFORE UPDATE ON logs_audit
    BEGIN
      SELECT RAISE(ABORT, 'Le journal d''audit ne peut pas être modifié.');
    END;

    CREATE TRIGGER IF NOT EXISTS logs_audit_sans_suppression
    BEFORE DELETE ON logs_audit
    BEGIN
      SELECT RAISE(ABORT, 'Le journal d''audit ne peut pas être supprimé.');
    END;
  `);
}

/**
 * Colonnes ajoutées après la première version du schéma.
 * L'ordre importe : la table doit exister avant qu'on l'altère.
 */
async function runMigrations(db) {
  await addColumn(db, 'clients', 'langue', "TEXT DEFAULT 'fr'");
  await addColumn(db, 'clients', 'province', "TEXT DEFAULT ''");

  await addColumn(db, 'factures', 'taux_taxe_1', 'REAL DEFAULT 0');
  await addColumn(db, 'factures', 'taux_taxe_2', 'REAL DEFAULT 0');
  await addColumn(db, 'factures', 'taxe_1_nom', "TEXT DEFAULT ''");
  await addColumn(db, 'factures', 'taxe_2_nom', "TEXT DEFAULT ''");
  await addColumn(db, 'factures', 'devise', "TEXT DEFAULT 'CAD'");
  await addColumn(db, 'factures', 'taux_change', 'REAL DEFAULT 1.0');
  await addColumn(db, 'factures', 'relances_envoyees', 'INTEGER DEFAULT 0');
  await addColumn(db, 'factures', 'date_derniere_relance', 'TEXT');

  await addColumn(db, 'devis', 'taxe_1_nom', "TEXT DEFAULT ''");
  await addColumn(db, 'devis', 'taxe_2_nom', "TEXT DEFAULT ''");
  await addColumn(db, 'devis', 'devise', "TEXT DEFAULT 'CAD'");
  await addColumn(db, 'devis', 'taux_change', 'REAL DEFAULT 1.0');

  await addColumn(db, 'settings', 'payment_instructions', "TEXT DEFAULT ''");
  await addColumn(db, 'settings', 'entreprise_logo', 'TEXT');
  // Colonnes héritées de l'époque où l'unique compte administrateur vivait
  // dans `settings`. Conservées le temps de la migration vers `users`.
  await addColumn(db, 'settings', 'admin_username', 'TEXT');
  await addColumn(db, 'settings', 'admin_password', 'TEXT');

  // Relances automatiques : désactivées par défaut, pour qu'aucun courriel ne
  // parte sans que l'entreprise l'ait explicitement demandé.
  await addColumn(db, 'settings', 'relances_actives', 'INTEGER DEFAULT 0');
  await addColumn(db, 'settings', 'relances_paliers', "TEXT DEFAULT '7,15,30'");

  // Annulation d'un encaissement saisi à tort. La ligne n'est jamais effacée :
  // un mouvement d'argent qui disparaît sans laisser de trace serait
  // injustifiable en vérification. `annule_le` NULL signifie « actif ».
  await addColumn(db, 'paiements', 'annule_le', 'TEXT');
  await addColumn(db, 'paiements', 'annule_par', 'TEXT');
  await addColumn(db, 'paiements', 'motif_annulation', 'TEXT');
  // Transaction bancaire à l'origine du paiement, s'il vient d'un
  // rapprochement : annuler le paiement doit la remettre en attente.
  await addColumn(db, 'paiements', 'transaction_id', 'INTEGER');
  await rattacherPaiementsAuxTransactions(db);

  // Conditions de paiement : le terme est convenu avec le client, puis figé sur
  // chaque facture émise — au même titre que les taux de taxe, pour qu'un
  // changement de terme ne rétroagisse pas sur des documents déjà remis.
  await addColumn(db, 'clients', 'conditions_paiement', "TEXT DEFAULT 'net30'");
  await addColumn(db, 'factures', 'conditions_paiement', "TEXT DEFAULT 'net30'");

  // Sauvegardes automatiques : actives par défaut, contrairement aux relances.
  // Une copie de sécurité ne part vers personne et ne coûte rien à l'utilisateur ;
  // c'est son absence qui serait un choix par défaut discutable.
  await addColumn(db, 'settings', 'sauvegarde_active', 'INTEGER DEFAULT 1');
  await addColumn(db, 'settings', 'sauvegarde_dossier', 'TEXT');
  await addColumn(db, 'settings', 'sauvegarde_retention', 'INTEGER DEFAULT 30');

  await figerMontants(db);
}

/**
 * Montants figés à l'émission.
 *
 * Les totaux étaient recalculés depuis les lignes à chaque lecture. Un document
 * remis à un client aurait donc changé de montant si la règle d'arrondi ou les
 * taux de taxe évoluaient — ce qui est inadmissible pour une pièce comptable.
 * Sous-total, taxes et total sont désormais arrêtés au moment de l'émission.
 *
 * Les documents antérieurs sont repris une seule fois, avec la règle d'arrondi
 * en vigueur au moment de la migration.
 */
/**
 * Relie les paiements issus d'un rapprochement à leur transaction bancaire.
 *
 * Les encaissements enregistrés avant l'existence de `paiements.transaction_id`
 * ne portent que la note « Rapprochement bancaire : … ». Sans ce rattachement,
 * le montant imputé d'un dépôt ancien — désormais déduit des paiements qui le
 * désignent — vaudrait zéro : le dépôt paraîtrait entièrement disponible alors
 * qu'il a déjà réglé une facture.
 *
 * Le rapprochement se fait sur la facture liée et le montant, seuls éléments
 * dont on dispose. Une transaction sans correspondance reste telle quelle.
 */
async function rattacherPaiementsAuxTransactions(db) {
  const resultat = await db.run(`
    UPDATE paiements SET transaction_id = (
      SELECT t.id FROM transactions_bancaires t
      WHERE t.facture_id = paiements.facture_id
        AND t.statut = 'Rapproché'
        AND ABS(t.montant - paiements.montant) < 0.005
      ORDER BY t.id ASC LIMIT 1
    )
    WHERE transaction_id IS NULL
      AND note LIKE 'Rapprochement bancaire%'
      AND EXISTS (
        SELECT 1 FROM transactions_bancaires t
        WHERE t.facture_id = paiements.facture_id
          AND t.statut = 'Rapproché'
          AND ABS(t.montant - paiements.montant) < 0.005
      )
  `);

  if (resultat.changes > 0) {
    log(`Migration : ${resultat.changes} paiement(s) rattaché(s) à leur transaction bancaire.`);
  }
  return resultat.changes;
}

async function figerMontants(db) {
  for (const table of ['factures', 'devis']) {
    const ajoutees = [
      await addColumn(db, table, 'sous_total', 'REAL'),
      await addColumn(db, table, 'montant_taxe_1', 'REAL'),
      await addColumn(db, table, 'montant_taxe_2', 'REAL'),
      await addColumn(db, table, 'montant_total', 'REAL')
    ];
    if (!ajoutees.some(Boolean)) continue;

    const reprises = await reprendreMontants(db, table);
    log(`Migration : montants figés pour ${reprises} ${table === 'devis' ? 'devis' : 'facture(s)'}.`);
  }
}

/**
 * Calcule et enregistre les montants des documents qui n'en ont pas encore.
 * Utilisé par la migration, et par le diagnostic pour réparer une dérive.
 *
 * @param {import('sqlite').Database} db
 * @param {'factures'|'devis'} table
 * @param {{toutes?: boolean}} [options] `toutes` recalcule aussi les documents déjà figés
 * @returns {Promise<number>} nombre de documents mis à jour
 */
async function reprendreMontants(db, table, options = {}) {
  const { roundCents } = require('./money.js');
  const tableLignes = table === 'devis' ? 'lignes_devis' : 'lignes_facture';
  const cle = table === 'devis' ? 'devis_id' : 'facture_id';
  const filtre = options.toutes ? '' : 'WHERE d.montant_total IS NULL';

  const documents = await db.all(`
    SELECT d.id, d.taux_taxe_1, d.taux_taxe_2,
           (SELECT COALESCE(SUM(l.quantite * l.prix_unitaire), 0)
            FROM ${tableLignes} l WHERE l.${cle} = d.id) AS brut
    FROM ${table} d
    ${filtre}
  `);

  for (const doc of documents) {
    const sousTotal = roundCents(doc.brut);
    const taxe1 = roundCents(sousTotal * (doc.taux_taxe_1 || 0));
    const taxe2 = roundCents(sousTotal * (doc.taux_taxe_2 || 0));

    await db.run(
      `UPDATE ${table} SET sous_total = ?, montant_taxe_1 = ?, montant_taxe_2 = ?, montant_total = ? WHERE id = ?`,
      [sousTotal, taxe1, taxe2, roundCents(sousTotal + taxe1 + taxe2), doc.id]
    );
  }

  return documents.length;
}

/**
 * Index sur les colonnes de jointure et de filtre.
 *
 * Sans eux, chaque calcul de solde balaie intégralement `lignes_facture` et
 * `paiements` — le coût grimpe linéairement avec l'historique de facturation.
 */
async function createIndexes(db) {
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_lignes_facture_facture_id ON lignes_facture (facture_id);
    CREATE INDEX IF NOT EXISTS idx_paiements_facture_id ON paiements (facture_id);
    CREATE INDEX IF NOT EXISTS idx_factures_client_id ON factures (client_id);
    CREATE INDEX IF NOT EXISTS idx_factures_statut ON factures (statut);
    CREATE INDEX IF NOT EXISTS idx_factures_date_emission ON factures (date_emission);
    CREATE INDEX IF NOT EXISTS idx_lignes_devis_devis_id ON lignes_devis (devis_id);
    CREATE INDEX IF NOT EXISTS idx_devis_client_id ON devis (client_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_statut ON transactions_bancaires (statut);
    CREATE INDEX IF NOT EXISTS idx_depenses_date ON depenses (date_depense);
    CREATE INDEX IF NOT EXISTS idx_abonnements_statut ON abonnements (statut, date_prochaine_generation);
    CREATE INDEX IF NOT EXISTS idx_notes_credit_facture_id ON notes_credit (facture_id);
    CREATE INDEX IF NOT EXISTS idx_lignes_note_credit_note_id ON lignes_note_credit (note_id);
    CREATE INDEX IF NOT EXISTS idx_relances_facture_palier ON relances (facture_id, palier_jours);
    -- Le journal se consulte du plus récent au plus ancien, et se filtre par
    -- auteur ou par type d'action.
    CREATE INDEX IF NOT EXISTS idx_logs_audit_date ON logs_audit (date_heure DESC);
    CREATE INDEX IF NOT EXISTS idx_logs_audit_action ON logs_audit (action);
    CREATE INDEX IF NOT EXISTS idx_logs_audit_utilisateur ON logs_audit (utilisateur);
  `);
}

/**
 * Migre l'ancien compte administrateur unique de `settings` vers `users`.
 */
async function migrateLegacyAdmin(db) {
  const existing = await db.get('SELECT id, admin_username, admin_password FROM settings LIMIT 1');
  if (!existing) {
    await db.run(
      `INSERT INTO settings (entreprise_nom, entreprise_adresse, entreprise_email,
                             taxe_1_nom, taxe_1_taux, taxe_1_numero,
                             taxe_2_nom, taxe_2_taux, taxe_2_numero)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['', '', '', 'TPS', 0.05, '', 'TVQ', 0.09975, '']
    );
    return;
  }

  if (existing.admin_username && existing.admin_password) {
    const already = await db.get('SELECT id FROM users WHERE username = ?', [existing.admin_username]);
    if (!already) {
      await db.run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
        [existing.admin_username, existing.admin_password, 'admin']);
    }
    await db.run('UPDATE settings SET admin_username = NULL, admin_password = NULL WHERE id = ?', [existing.id]);
  }
}

/**
 * Jeu de données de démonstration.
 *
 * N'est plus inséré automatiquement : une base neuve doit démarrer vide, sinon
 * le premier utilisateur découvre un client et une facture qui ne sont pas les
 * siens. À lancer explicitement via `npm run seed:demo`.
 */
async function seedDemoData(db) {
  const existingClient = await db.get('SELECT id FROM clients LIMIT 1');
  if (existingClient) {
    log('La base contient déjà des données : jeu de démonstration ignoré.');
    return;
  }

  const clientResult = await db.run(
    'INSERT INTO clients (nom_entreprise, nom_contact, email, adresse, langue, province) VALUES (?, ?, ?, ?, ?, ?)',
    ['Client de démonstration', 'Alice Dupont', 'alice@exemple.ca', '123 rue de l\'Innovation, Montréal', 'fr', 'QC']
  );
  const clientId = clientResult.lastID;

  const factureResult = await db.run(
    `INSERT INTO factures (numero_facture, client_id, date_emission, date_echeance, statut,
                           taux_taxe_1, taux_taxe_2, taxe_1_nom, taxe_2_nom, devise, taux_change)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['SHT-202601-0001', clientId, '2026-01-06', '2026-01-20', 'En attente',
      0.05, 0.09975, 'TPS', 'TVQ', 'CAD', 1.0]
  );
  const factureId = factureResult.lastID;

  await db.run('INSERT INTO lignes_facture (facture_id, description, quantite, prix_unitaire) VALUES (?, ?, ?, ?)',
    [factureId, 'Développement module RPA', 1, 1000.0]);
  await db.run('INSERT INTO lignes_facture (facture_id, description, quantite, prix_unitaire) VALUES (?, ?, ?, ?)',
    [factureId, 'Ajustement design', 8, 90.0]);

  // Les montants sont arrêtés une fois les lignes en place, comme le ferait
  // une véritable émission.
  await reprendreMontants(db, 'factures', { toutes: true });

  await db.run('INSERT INTO paiements (facture_id, date_paiement, montant, note) VALUES (?, ?, ?, ?)',
    [factureId, '2026-01-13', 500.0, 'Virement partiel']);
  await db.run('UPDATE factures SET statut = ? WHERE id = ?', ['Partiellement payée', factureId]);

  log('Jeu de démonstration inséré : 1 client, 1 facture de 1720 $ HT, 1 acompte de 500 $.');
}

/**
 * Ouvre la base, crée le schéma si nécessaire et applique les migrations.
 *
 * @param {string} [dbPath] chemin explicite ; par défaut celui de la configuration.
 *   Les tests s'en servent pour travailler sur une base jetable.
 * @returns {Promise<import('sqlite').Database>}
 */
async function initDb(dbPath = getDbPath()) {
  try {
    // Avant toute ouverture : c'est le seul moment où le fichier peut être
    // remplacé sans qu'une connexion ni un journal WAL ne décrivent l'ancienne base.
    appliquerRestaurationEnAttente(dbPath, path.dirname(dbPath));

    const db = await open({ filename: dbPath, driver: sqlite3.Database });

    // Requis pour que les contraintes ON DELETE CASCADE s'appliquent réellement.
    await db.exec('PRAGMA foreign_keys = ON;');
    // Le mode WAL réduit le blocage entre lectures et écritures concurrentes.
    await db.exec('PRAGMA journal_mode = WAL;');

    await createTables(db);
    await runMigrations(db);
    await createIndexes(db);
    await migrateLegacyAdmin(db);

    log('Schéma vérifié et à jour.');
    return db;
  } catch (error) {
    console.error("Erreur lors de l'initialisation de la base de données :", error);
    throw error;
  }
}

// `node database.js` initialise le schéma ; `node database.js --seed` y ajoute
// le jeu de démonstration.
if (require.main === module) {
  initDb()
    .then(async (db) => {
      if (process.argv.includes('--seed')) await seedDemoData(db);
      console.log("Script d'initialisation terminé.");
      return db.close();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { initDb, seedDemoData, addColumn, columnExists, reprendreMontants };
