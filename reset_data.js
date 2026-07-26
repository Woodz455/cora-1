/**
 * Outil de développement : efface les données transactionnelles (factures,
 * devis, paiements, transactions bancaires) en conservant clients, catalogue,
 * paramètres et comptes utilisateurs.
 *
 * Une confirmation explicite est exigée : le script précédent s'exécutait dès
 * l'appel, sans avertissement ni sauvegarde, et n'attendait même pas la fin des
 * suppressions avant de fermer la connexion.
 *
 *   node reset_data.js --confirmer
 */

const fs = require('fs');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { getDbPath } = require('./config.js');

const TABLES = ['paiements', 'lignes_facture', 'factures', 'lignes_devis', 'devis', 'transactions_bancaires'];

async function main() {
  if (!process.argv.includes('--confirmer')) {
    console.error('Cette commande efface définitivement toutes les factures, devis, paiements');
    console.error('et transactions bancaires de la base locale.');
    console.error('\nRelancez avec --confirmer pour l\'exécuter :\n  node reset_data.js --confirmer\n');
    process.exit(1);
  }

  const dbPath = getDbPath();
  if (!fs.existsSync(dbPath)) {
    console.error(`Aucune base trouvée à l'emplacement ${dbPath}.`);
    process.exit(1);
  }

  // Sauvegarde horodatée avant toute suppression.
  const backupPath = `${dbPath}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(dbPath, backupPath);
  console.log(`Sauvegarde créée : ${backupPath}`);

  const db = await open({ filename: dbPath, driver: sqlite3.Database });
  await db.exec('PRAGMA foreign_keys = ON;');

  try {
    await db.exec('BEGIN IMMEDIATE;');
    for (const table of TABLES) {
      const { count } = await db.get(`SELECT COUNT(*) AS count FROM ${table}`);
      await db.run(`DELETE FROM ${table}`);
      console.log(`  ${table} : ${count} ligne(s) supprimée(s).`);
    }
    // Remet les séquences d'auto-incrément à zéro.
    await db.run(
      `DELETE FROM sqlite_sequence WHERE name IN (${TABLES.map(() => '?').join(', ')})`,
      TABLES
    );
    await db.exec('COMMIT;');
    console.log('\nDonnées transactionnelles effacées.');
  } catch (error) {
    await db.exec('ROLLBACK;');
    console.error('Échec de la remise à zéro :', error.message);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
