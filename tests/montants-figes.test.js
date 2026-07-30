/**
 * Montants figés à l'émission.
 *
 * Une pièce comptable remise à un client ne doit jamais changer de montant.
 * Ces tests vérifient que c'est le cas, que les documents antérieurs sont
 * correctement repris, et qu'une dérive est détectée.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const { initDb, reprendreMontants } = require('../database.js');
const { createFacture, updateFacture, getSoldeFacture, getFactureDetails, getReportStats } = require('../invoiceService.js');
const { createDevis, getDevisDetails, convertDevisToFacture } = require('../devisService.js');
const { diagnostiquer, detecterDerives } = require('../doctor.js');
const { createTestDb, insertClient } = require('./helpers.js');

const LIGNES = [{ description: 'Service', quantite: 3, prix_unitaire: 33.33 }];

async function avecFacture(t, province = 'QC') {
  const db = await createTestDb();
  t.after(() => db.__cleanup());
  const clientId = await insertClient(db, { province });
  const facture = await createFacture(db, {
    client_id: clientId, date_emission: '2026-07-01', date_echeance: '2026-07-31'
  }, LIGNES);
  return { db, clientId, facture };
}

test('les montants sont enregistrés à la création', async (t) => {
  const { db, facture } = await avecFacture(t);

  const ligne = await db.get(
    'SELECT sous_total, montant_taxe_1, montant_taxe_2, montant_total FROM factures WHERE id = ?',
    [facture.id]
  );
  assert.deepEqual(ligne, {
    sous_total: 99.99, montant_taxe_1: 5, montant_taxe_2: 9.97, montant_total: 114.96
  });
  assert.equal(facture.montant_total, 114.96);
});

test('modifier les lignes en base ne change pas le montant de la facture', async (t) => {
  const { db, facture } = await avecFacture(t);

  // Écriture directe, comme le ferait un outil externe ou une restauration.
  await db.run('UPDATE lignes_facture SET prix_unitaire = ? WHERE facture_id = ?', [999, facture.id]);

  const apres = await getSoldeFacture(db, facture.id);
  assert.equal(apres.montant_total, 114.96, 'le montant émis reste inchangé');
  assert.equal(apres.sous_total, 99.99);
});

test('un changement de province du client ne rétroagit pas sur la facture', async (t) => {
  const { db, clientId, facture } = await avecFacture(t, 'QC');
  await db.run('UPDATE clients SET province = ? WHERE id = ?', ['ON', clientId]);

  const apres = await getSoldeFacture(db, facture.id);
  assert.equal(apres.montant_total, 114.96);
  assert.equal(apres.taxe_1_nom, 'TPS');
  assert.equal(apres.taux_taxe_1, 0.05);
});

test('la modification par l\'application réarrête bien les montants', async (t) => {
  const { db, clientId, facture } = await avecFacture(t);

  await updateFacture(db, facture.id, { client_id: clientId, date_echeance: '2026-08-31' }, [
    { description: 'Service revu', quantite: 2, prix_unitaire: 100 }
  ]);

  const apres = await getSoldeFacture(db, facture.id);
  assert.equal(apres.sous_total, 200);
  assert.equal(apres.montant_total, 229.95);
});

test('les détails destinés au PDF restent cohérents', async (t) => {
  const { db, facture } = await avecFacture(t);
  const details = await getFactureDetails(db, facture.id);

  assert.equal(
    Number((details.sous_total + details.montant_taxe_1 + details.montant_taxe_2).toFixed(2)),
    details.montant_total
  );
});

test('un devis fige ses montants et les transmet à la facture', async (t) => {
  const db = await createTestDb();
  t.after(() => db.__cleanup());
  const clientId = await insertClient(db, { province: 'ON' });

  const { id } = await createDevis(db, {
    client_id: clientId, date_emission: '2026-07-01', date_validite: '2026-07-31'
  }, [{ description: 'Projet', quantite: 2, prix_unitaire: 500 }]);

  const stocke = await db.get('SELECT sous_total, montant_total FROM devis WHERE id = ?', [id]);
  assert.deepEqual(stocke, { sous_total: 1000, montant_total: 1130 });

  const devis = await getDevisDetails(db, id);
  const facture = await convertDevisToFacture(db, id);
  assert.equal(facture.montant_total, devis.montant_total);
});

test('les rapports s\'appuient sur les montants figés', async (t) => {
  const { db, facture } = await avecFacture(t);
  await db.run('UPDATE lignes_facture SET prix_unitaire = ? WHERE facture_id = ?', [999, facture.id]);

  const rapport = await getReportStats(db);
  assert.equal(rapport.revenu_total, 114.96, 'le revenu suit le montant émis, pas les lignes altérées');
});

test('les documents antérieurs sont repris par la migration', async (t) => {
  // Base construite avec le schéma d'avant le figeage : aucune colonne de montant.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clora-migration-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, 'ancienne.sqlite');

  const ancienne = await open({ filename: dbPath, driver: sqlite3.Database });
  await ancienne.exec(`
    CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, nom_entreprise TEXT NOT NULL, email TEXT NOT NULL);
    CREATE TABLE factures (
      id INTEGER PRIMARY KEY AUTOINCREMENT, numero_facture TEXT UNIQUE NOT NULL, client_id INTEGER,
      date_emission TEXT NOT NULL, date_echeance TEXT NOT NULL, statut TEXT NOT NULL,
      taux_taxe_1 REAL DEFAULT 0, taux_taxe_2 REAL DEFAULT 0
    );
    CREATE TABLE lignes_facture (
      id INTEGER PRIMARY KEY AUTOINCREMENT, facture_id INTEGER,
      description TEXT NOT NULL, quantite REAL, prix_unitaire REAL NOT NULL
    );
  `);
  await ancienne.run("INSERT INTO clients (nom_entreprise, email) VALUES ('Ancien client', 'a@b.ca')");
  await ancienne.run(`INSERT INTO factures (numero_facture, client_id, date_emission, date_echeance, statut, taux_taxe_1, taux_taxe_2)
                      VALUES ('SHT-202601-0001', 1, '2026-01-06', '2026-01-20', 'En attente', 0.05, 0.09975)`);
  await ancienne.run("INSERT INTO lignes_facture (facture_id, description, quantite, prix_unitaire) VALUES (1, 'Ancien service', 3, 33.33)");
  await ancienne.close();

  // La migration doit ajouter les colonnes et les renseigner.
  const db = await initDb(dbPath);
  t.after(() => db.close());

  const reprise = await db.get('SELECT sous_total, montant_taxe_1, montant_taxe_2, montant_total FROM factures WHERE id = 1');
  assert.deepEqual(reprise, {
    sous_total: 99.99, montant_taxe_1: 5, montant_taxe_2: 9.97, montant_total: 114.96
  });

  // Et la facture reste lisible par le service, avec le bon solde.
  const info = await getSoldeFacture(db, 1);
  assert.equal(info.montant_total, 114.96);
  assert.equal(info.solde_restant, 114.96);
});

test('le diagnostic détecte une dérive entre montants figés et lignes', async (t) => {
  const { db, facture } = await avecFacture(t);

  let derives = await detecterDerives(db, 'factures');
  assert.equal(derives.length, 0, 'aucune dérive sur un document sain');

  await db.run('UPDATE lignes_facture SET prix_unitaire = ? WHERE facture_id = ?', [500, facture.id]);

  derives = await detecterDerives(db, 'factures');
  assert.equal(derives.length, 1);
  assert.equal(derives[0].gravite, 'ÉLEVÉE');
  assert.match(derives[0].probleme, /les lignes donnent/);

  const anomalies = await diagnostiquer(db);
  assert.ok(anomalies.some((a) => /les lignes donnent/.test(a.probleme)));
});

test('le diagnostic signale un document sans montant enregistré', async (t) => {
  const { db, facture } = await avecFacture(t);
  await db.run('UPDATE factures SET montant_total = NULL WHERE id = ?', [facture.id]);

  const derives = await detecterDerives(db, 'factures');
  assert.equal(derives.length, 1);
  assert.match(derives[0].probleme, /Aucun montant enregistré/);
});

test('la reprise des montants répare une dérive', async (t) => {
  const { db, facture } = await avecFacture(t);
  await db.run('UPDATE lignes_facture SET prix_unitaire = ? WHERE facture_id = ?', [500, facture.id]);

  const misesAJour = await reprendreMontants(db, 'factures', { toutes: true });
  assert.equal(misesAJour, 1);

  const apres = await getSoldeFacture(db, facture.id);
  assert.equal(apres.sous_total, 1500);
  assert.equal(apres.montant_total, 1724.63);
  assert.equal((await detecterDerives(db, 'factures')).length, 0);
});
