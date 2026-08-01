/**
 * Devis : numérotation, taxes et conversion en facture.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getDevis, getDevisDetails, createDevis, updateDevis,
  cancelDevis, convertDevisToFacture, STATUTS
} = require('../devisService.js');
const { getSoldeFacture } = require('../invoiceService.js');
const { createTestDb, insertClient, insertSettings } = require('./helpers.js');

const LIGNES = [{ description: 'Projet', quantite: 2, prix_unitaire: 500 }];

async function prepare(t, province = 'QC') {
  const db = await createTestDb();
  t.after(() => db.__cleanup());
  await insertSettings(db);
  const clientId = await insertClient(db, { province });
  return { db, clientId };
}

test('un devis applique les taxes de la province du client', async (t) => {
  const { db, clientId } = await prepare(t, 'ON');
  const { id } = await createDevis(db, {
    client_id: clientId, date_emission: '2026-07-01', date_validite: '2026-07-31'
  }, LIGNES);

  const details = await getDevisDetails(db, id);

  // Les devis utilisaient les taux globaux des paramètres (TPS + TVQ du Québec),
  // alors que la facture issue du devis appliquait la TVH ontarienne : le client
  // acceptait un montant différent de celui qu'il recevait.
  assert.equal(details.taux_taxe_1, 0.13);
  assert.equal(details.taxe_1_nom, 'TVH');
  assert.equal(details.taux_taxe_2, 0);
  assert.equal(details.sous_total, 1000);
  assert.equal(details.montant_total, 1130);
});

test('le devis et la facture qui en découle portent le même montant', async (t) => {
  const { db, clientId } = await prepare(t, 'ON');
  const { id } = await createDevis(db, {
    client_id: clientId, date_emission: '2026-07-01', date_validite: '2026-07-31'
  }, LIGNES);

  const devis = await getDevisDetails(db, id);
  const facture = await convertDevisToFacture(db, id);

  assert.equal(facture.montant_total, devis.montant_total);
  assert.equal(facture.taxe_1_nom, devis.taxe_1_nom);
  assert.equal(facture.taux_taxe_1, devis.taux_taxe_1);
});

test('la conversion lie le devis à la facture créée', async (t) => {
  const { db, clientId } = await prepare(t);
  const { id } = await createDevis(db, {
    client_id: clientId, date_emission: '2026-07-01', date_validite: '2026-07-31'
  }, LIGNES);

  // La version précédente lisait `facture.facture.id` sur un objet plat : la
  // conversion échouait systématiquement en laissant une facture orpheline.
  const facture = await convertDevisToFacture(db, id);
  assert.ok(facture.id);

  // La conversion émet la facture au jour où elle a lieu, et le numéro suit la
  // date d'émission : écrire le mois en dur ici faisait échouer le test au
  // premier changement de mois, quelle que soit la date du devis d'origine.
  const moisCourant = new Date().toISOString().slice(0, 7).replace('-', '');
  assert.match(facture.numero_facture, new RegExp(`^SHT-${moisCourant}-\\d{4}$`));

  const apres = await db.get('SELECT statut, facture_id FROM devis WHERE id = ?', [id]);
  assert.equal(apres.statut, STATUTS.CONVERTI);
  assert.equal(apres.facture_id, facture.id);

  // Une seule facture existe : aucune trace d'une tentative avortée.
  const { count } = await db.get('SELECT COUNT(*) AS count FROM factures');
  assert.equal(count, 1);
});

test('la facture issue d\'un devis reçoit une échéance à 30 jours', async (t) => {
  const { db, clientId } = await prepare(t);
  const { id } = await createDevis(db, {
    client_id: clientId, date_emission: '2026-07-01', date_validite: '2026-07-31'
  }, LIGNES);

  const facture = await convertDevisToFacture(db, id);
  const ligne = await db.get('SELECT date_emission, date_echeance FROM factures WHERE id = ?', [facture.id]);

  // L'échéance valait la date d'émission : la facture était due le jour même.
  const jours = (new Date(ligne.date_echeance) - new Date(ligne.date_emission)) / 86400000;
  assert.equal(jours, 30);
});

test('un devis refusé ne peut pas être converti', async (t) => {
  const { db, clientId } = await prepare(t);
  const { id } = await createDevis(db, {
    client_id: clientId, date_emission: '2026-07-01', date_validite: '2026-07-31'
  }, LIGNES);
  await cancelDevis(db, id);

  await assert.rejects(() => convertDevisToFacture(db, id), /ne peut pas être converti/);

  // Aucune facture n'a été créée au passage.
  const { count } = await db.get('SELECT COUNT(*) AS count FROM factures');
  assert.equal(count, 0);
});

test('un devis déjà converti ne peut pas l\'être deux fois', async (t) => {
  const { db, clientId } = await prepare(t);
  const { id } = await createDevis(db, {
    client_id: clientId, date_emission: '2026-07-01', date_validite: '2026-07-31'
  }, LIGNES);

  await convertDevisToFacture(db, id);
  await assert.rejects(() => convertDevisToFacture(db, id), /déjà été converti/);

  const { count } = await db.get('SELECT COUNT(*) AS count FROM factures');
  assert.equal(count, 1);
});

test('un devis converti ne peut plus être refusé ni modifié', async (t) => {
  const { db, clientId } = await prepare(t);
  const { id } = await createDevis(db, {
    client_id: clientId, date_emission: '2026-07-01', date_validite: '2026-07-31'
  }, LIGNES);
  await convertDevisToFacture(db, id);

  await assert.rejects(() => cancelDevis(db, id), /converti/);
  await assert.rejects(
    () => updateDevis(db, id, { client_id: clientId, date_validite: '2026-08-31' }, LIGNES),
    /en attente/
  );
});

test('la modification d\'un devis réaligne ses taxes sur le nouveau client', async (t) => {
  const { db, clientId } = await prepare(t, 'QC');
  const clientOntarien = await insertClient(db, { province: 'ON', nom: 'Client ON', email: 'on@exemple.ca' });

  const { id } = await createDevis(db, {
    client_id: clientId, date_emission: '2026-07-01', date_validite: '2026-07-31'
  }, LIGNES);
  assert.equal((await getDevisDetails(db, id)).taux_taxe_1, 0.05);

  await updateDevis(db, id, { client_id: clientOntarien, date_validite: '2026-08-31' }, LIGNES);

  // Les taxes n'étaient pas recalculées à la modification, contrairement aux factures.
  const apres = await getDevisDetails(db, id);
  assert.equal(apres.taux_taxe_1, 0.13);
  assert.equal(apres.taxe_1_nom, 'TVH');
  assert.equal(apres.taux_taxe_2, 0);
});

test('la numérotation des devis ne réattribue pas un numéro supprimé', async (t) => {
  const { db, clientId } = await prepare(t);
  const base = { client_id: clientId, date_emission: '2026-07-01', date_validite: '2026-07-31' };

  const d1 = await createDevis(db, base, LIGNES);
  const d2 = await createDevis(db, base, LIGNES);
  assert.equal(d1.numero_devis, 'DEV-202607-0001');
  assert.equal(d2.numero_devis, 'DEV-202607-0002');

  // Un COUNT(*) aurait ici réémis DEV-202607-0002.
  await db.run('DELETE FROM devis WHERE id = ?', [d2.id]);
  const d3 = await createDevis(db, base, LIGNES);
  assert.equal(d3.numero_devis, 'DEV-202607-0003');
});

test('la liste des devis expose les totaux sans requête par devis', async (t) => {
  const { db, clientId } = await prepare(t);
  const base = { client_id: clientId, date_emission: '2026-07-01', date_validite: '2026-07-31' };
  await createDevis(db, base, LIGNES);
  await createDevis(db, base, [{ description: 'Autre', quantite: 1, prix_unitaire: 250 }]);

  const liste = await getDevis(db);
  assert.equal(liste.length, 2);
  for (const devis of liste) {
    assert.ok(devis.client, 'le nom du client est présent');
    assert.equal(typeof devis.montant_total, 'number');
    assert.equal(
      Number((devis.sous_total + devis.montant_taxe_1 + devis.montant_taxe_2).toFixed(2)),
      devis.montant_total
    );
  }
});

test('un devis sans ligne ne peut pas être converti', async (t) => {
  const { db, clientId } = await prepare(t);
  const { id } = await createDevis(db, {
    client_id: clientId, date_emission: '2026-07-01', date_validite: '2026-07-31'
  }, LIGNES);
  await db.run('DELETE FROM lignes_devis WHERE devis_id = ?', [id]);

  await assert.rejects(() => convertDevisToFacture(db, id), /sans ligne/);
});

test('la devise du devis est reportée sur la facture', async (t) => {
  const { db, clientId } = await prepare(t);
  const { id } = await createDevis(db, {
    client_id: clientId, date_emission: '2026-07-01', date_validite: '2026-07-31',
    devise: 'USD', taux_change: 1.35
  }, LIGNES);

  const facture = await convertDevisToFacture(db, id);
  const etat = await getSoldeFacture(db, facture.id);
  assert.equal(etat.devise, 'USD');
  assert.equal(etat.taux_change, 1.35);
});
