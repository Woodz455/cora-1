const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run('DELETE FROM paiements');
  db.run('DELETE FROM lignes_facture');
  db.run('DELETE FROM factures');
  db.run('DELETE FROM lignes_devis');
  db.run('DELETE FROM devis');
  
  // Reset autoincrement sequence so IDs start at 1 again
  db.run('DELETE FROM sqlite_sequence WHERE name IN ("paiements", "lignes_facture", "factures", "lignes_devis", "devis")');

  console.log('Les données de test (factures, devis, paiements) ont été effacées avec succès !');
});

db.close();
