/**
 * La date du jour, le soir, au Québec.
 *
 * Toutes les dates du jour étaient lues en heure universelle. À Montréal, dès
 * 19 h l'hiver, « aujourd'hui » devenait le lendemain : une facture émise le
 * 30 novembre au soir partait dans la série de décembre, une facture due le
 * jour même passait en retard, et les abonnements du lendemain étaient
 * facturés la veille.
 *
 * Chaque fichier de test tourne dans son propre processus : fixer le fuseau
 * et l'horloge ici ne touche aucun autre test.
 */

process.env.TZ = 'America/Toronto';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test');

const { createTestDb, insertClient, insertSettings } = require('./helpers.js');
const { aujourdhui, dateLocale } = require('../dates.js');
const {
  createFacture, addPaiement, getDashboardStats, getReportStats, getBalanceAgee
} = require('../invoiceService.js');
const { createDevis, convertDevisToFacture } = require('../devisService.js');
const { createSubscription, checkAndGenerateRecurringInvoices } = require('../subscriptionService.js');

/** Le 30 novembre 2026 à 20 h 30, heure de Montréal : déjà le 1er décembre en heure universelle. */
const SOIR = new Date('2026-12-01T01:30:00Z');
const JOUR = '2026-11-30';
const LENDEMAIN = '2026-12-01';

const LIGNES = [{ description: 'Service', quantite: 1, prix_unitaire: 100 }];

async function prepare(t) {
  mock.timers.enable({ apis: ['Date'], now: SOIR });
  t.after(() => mock.timers.reset());

  const db = await createTestDb();
  t.after(() => db.__cleanup());
  await insertSettings(db);
  const clientId = await insertClient(db);
  return { db, clientId };
}

test('le soir, la date du jour reste celle de l\'horloge du poste', async (t) => {
  await prepare(t);
  assert.equal(new Date().toISOString().split('T')[0], LENDEMAIN, 'le scénario suppose que l\'heure universelle a changé de jour');
  assert.equal(aujourdhui(), JOUR);
  assert.equal(dateLocale(new Date('2026-07-01T03:59:00Z')), '2026-06-30', 'heure d\'été : quatre heures de décalage');
});

test('l\'interface lit la même date que le serveur', async (t) => {
  await prepare(t);
  const client = await import('../client/src/dates.js');
  assert.equal(client.aujourdhui(), JOUR);
  assert.equal(client.dateLocale(new Date()), JOUR);
});

test('un encaissement saisi le soir est daté du jour', async (t) => {
  const { db, clientId } = await prepare(t);
  const facture = await createFacture(db, { client_id: clientId, date_emission: JOUR, date_echeance: '2026-12-30' }, LIGNES);
  await addPaiement(db, facture.id, 50);

  const paiement = await db.get('SELECT date_paiement FROM paiements WHERE facture_id = ?', [facture.id]);
  assert.equal(paiement.date_paiement, JOUR);
});

test('une facture due aujourd\'hui n\'est pas en retard avant minuit', async (t) => {
  const { db, clientId } = await prepare(t);
  await createFacture(db, { client_id: clientId, date_emission: '2026-11-01', date_echeance: JOUR }, LIGNES);

  const tableau = await getDashboardStats(db);
  assert.equal(tableau.facturesEnRetard, 0, 'rien n\'est en retard le jour de l\'échéance');
  assert.ok(tableau.facturesEnAttente > 0, 'la facture reste en attente');

  const rapports = await getReportStats(db);
  assert.equal(rapports.lateInvoices.length, 0);

  const balance = await getBalanceAgee(db);
  assert.equal(balance.date_reference, JOUR);
});

test('un devis converti le soir donne une facture du jour, dans la série du mois', async (t) => {
  const { db, clientId } = await prepare(t);
  const devis = await createDevis(db, { client_id: clientId, date_emission: '2026-11-20', date_validite: '2026-12-20' }, LIGNES);
  const facture = await convertDevisToFacture(db, devis.id);

  const ligne = await db.get('SELECT numero_facture, date_emission FROM factures WHERE id = ?', [facture.id]);
  assert.equal(ligne.date_emission, JOUR);
  assert.match(ligne.numero_facture, /-202611-/, 'la facture reste dans la série de novembre');
});

test('l\'abonnement du lendemain n\'est pas facturé la veille au soir', async (t) => {
  const { db, clientId } = await prepare(t);
  const abonnement = (date) => createSubscription(db, {
    client_id: clientId,
    titre: 'Abonnement mensuel',
    lignes_json: JSON.stringify(LIGNES),
    cycle: 'Mensuel',
    date_prochaine_generation: date
  });
  await abonnement(LENDEMAIN);

  assert.equal((await checkAndGenerateRecurringInvoices(db)).generees, 0, 'rien n\'est dû avant demain');

  await abonnement(JOUR);
  assert.equal((await checkAndGenerateRecurringInvoices(db)).generees, 1, 'celui d\'aujourd\'hui est facturé');
  const facture = await db.get('SELECT date_emission FROM factures');
  assert.equal(facture.date_emission, JOUR);
});
