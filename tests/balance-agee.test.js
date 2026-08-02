/**
 * Balance âgée des comptes clients.
 *
 * Les bornes des tranches sont testées au jour près : se tromper d'un jour
 * déplace des montants entiers d'une colonne à l'autre sous les yeux du
 * dirigeant qui décide de relancer, ou non.
 */

const test = require('node:test');
const assert = require('node:assert');

const { createTestDb, insertClient, startTestServer, MOT_DE_PASSE } = require('./helpers.js');
const { reset: resetRateLimit } = require('../rateLimit.js');
const { getBalanceAgee, createFacture, addPaiement, cancelFacture } = require('../invoiceService.js');
const { createNoteCredit } = require('../noteCreditService.js');

const REFERENCE = '2026-08-01';

/** Date d'échéance située à `retard` jours avant la date de référence. */
function echeanceAvecRetard(retard) {
  const d = new Date(`${REFERENCE}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - retard);
  return d.toISOString().split('T')[0];
}

const LIGNES = [{ description: 'Prestation', quantite: 1, prix_unitaire: 100 }];

async function prepare(t) {
  const db = await createTestDb();
  t.after(() => db.__cleanup());
  return db;
}

/** Crée une facture échue depuis `retard` jours. */
async function factureEchue(db, clientId, retard, prix = 100) {
  return createFacture(db, {
    client_id: clientId,
    date_emission: '2026-01-01',
    date_echeance: echeanceAvecRetard(retard)
  }, [{ description: 'Prestation', quantite: 1, prix_unitaire: prix }]);
}

test('les bornes de tranche tombent au bon jour', async (t) => {
  const db = await prepare(t);
  const clientId = await insertClient(db, { nom: 'Client', province: '' });

  // Province laissée vide : les taux sont nuls, les montants restent ronds et
  // le test porte sur les bornes, pas sur l'arithmétique des taxes.
  await factureEchue(db, clientId, 0, 10);    // échéance aujourd'hui : non échu
  await factureEchue(db, clientId, 1, 20);    // premier jour de retard
  await factureEchue(db, clientId, 30, 40);   // dernier jour de la tranche 1-30
  await factureEchue(db, clientId, 31, 80);   // premier jour de la tranche 31-60
  await factureEchue(db, clientId, 60, 160);
  await factureEchue(db, clientId, 61, 320);
  await factureEchue(db, clientId, 90, 640);
  await factureEchue(db, clientId, 91, 1280);

  const { totaux } = await getBalanceAgee(db, REFERENCE);

  assert.equal(totaux.non_echu, 10);
  assert.equal(totaux.jours_1_30, 20 + 40);
  assert.equal(totaux.jours_31_60, 80 + 160);
  assert.equal(totaux.jours_61_90, 320 + 640);
  assert.equal(totaux.jours_91_plus, 1280);
  assert.equal(totaux.total, 10 + 20 + 40 + 80 + 160 + 320 + 640 + 1280);
});

test('une facture non encore échue reste hors des tranches de retard', async (t) => {
  const db = await prepare(t);
  const clientId = await insertClient(db, { nom: 'Client', province: '' });
  await factureEchue(db, clientId, -15, 500); // échéance dans quinze jours

  const { totaux } = await getBalanceAgee(db, REFERENCE);

  assert.equal(totaux.non_echu, 500);
  assert.equal(totaux.jours_1_30, 0);
});

test('le solde retenu est net des paiements et des notes de crédit', async (t) => {
  const db = await prepare(t);
  const clientId = await insertClient(db, { nom: 'Client', province: '' });

  const partielle = await factureEchue(db, clientId, 45, 1000);
  await addPaiement(db, partielle.id, 400, 'Acompte', '2026-07-01');

  const creditee = await factureEchue(db, clientId, 45, 500);
  await createNoteCredit(db, creditee.id, {
    date_emission: '2026-07-15', motif: 'Geste commercial'
  }, [{ description: 'Remise', quantite: 1, prix_unitaire: 200 }]);

  const { totaux } = await getBalanceAgee(db, REFERENCE);

  // 1000 - 400 encaissés, puis 500 - 200 crédités.
  assert.equal(totaux.jours_31_60, 600 + 300);
});

test('une facture soldée disparaît de la balance', async (t) => {
  const db = await prepare(t);
  const clientId = await insertClient(db, { nom: 'Client', province: '' });
  const facture = await factureEchue(db, clientId, 45, 300);

  await addPaiement(db, facture.id, 300, 'Solde', '2026-07-20');

  const { clients, totaux } = await getBalanceAgee(db, REFERENCE);

  assert.equal(totaux.total, 0);
  assert.equal(clients.length, 0, 'un client sans solde n\'a pas à figurer');
});

test('une facture annulée est absente', async (t) => {
  const db = await prepare(t);
  const clientId = await insertClient(db, { nom: 'Client', province: '' });
  const gardee = await factureEchue(db, clientId, 45, 100);
  const annulee = await factureEchue(db, clientId, 45, 900);

  await cancelFacture(db, annulee.id);

  const { totaux } = await getBalanceAgee(db, REFERENCE);

  assert.equal(totaux.total, 100, `seule la facture ${gardee.numero_facture} doit compter`);
});

test('le total d\'un client égale la somme de ses tranches', async (t) => {
  const db = await prepare(t);
  const clientId = await insertClient(db, { nom: 'Client unique', province: '' });

  await factureEchue(db, clientId, 5, 100);
  await factureEchue(db, clientId, 40, 200);
  await factureEchue(db, clientId, 100, 400);

  const { clients } = await getBalanceAgee(db, REFERENCE);
  const [entree] = clients;

  const sommeDesTranches = entree.non_echu + entree.jours_1_30
    + entree.jours_31_60 + entree.jours_61_90 + entree.jours_91_plus;

  assert.equal(entree.total, 700);
  assert.equal(sommeDesTranches, entree.total);
});

test('les clients sont classés du plus gros solde au plus petit', async (t) => {
  const db = await prepare(t);
  const petit = await insertClient(db, { nom: 'Petit', province: '', email: 'p@x.ca' });
  const gros = await insertClient(db, { nom: 'Gros', province: '', email: 'g@x.ca' });

  await factureEchue(db, petit, 10, 50);
  await factureEchue(db, gros, 10, 5000);

  const { clients } = await getBalanceAgee(db, REFERENCE);

  assert.equal(clients[0].client, 'Gros');
  assert.equal(clients[1].client, 'Petit');
});

test('la balance est convertie en dollars canadiens', async (t) => {
  const db = await prepare(t);
  const clientId = await insertClient(db, { nom: 'Client', province: '' });

  await createFacture(db, {
    client_id: clientId,
    date_emission: '2026-01-01',
    date_echeance: echeanceAvecRetard(10),
    devise: 'USD',
    taux_change: 1.35
  }, LIGNES);

  const { totaux } = await getBalanceAgee(db, REFERENCE);

  // 100 USD à 1,35 : le dirigeant lit une somme unique, pas un panachage de devises.
  assert.equal(totaux.jours_1_30, 135);
});

test('la balance est réservée à l\'administration et à la comptabilité', async (t) => {
  resetRateLimit();
  const api = await startTestServer();
  t.after(() => api.close());
  await api.post('/api/auth/setup', { username: 'patron', password: MOT_DE_PASSE });

  await api.post('/api/users', { username: 'employe1', password: MOT_DE_PASSE, role: 'employe' });
  await api.post('/api/auth/login', { username: 'employe1', password: MOT_DE_PASSE });
  assert.equal((await api.get('/api/rapports/balance-agee')).status, 403);

  await api.post('/api/auth/login', { username: 'patron', password: MOT_DE_PASSE });
  const res = await api.get('/api/rapports/balance-agee');
  assert.equal(res.status, 200);
  assert.equal(res.data.totaux.total, 0);
  assert.equal(res.data.tranches.length, 5);
});
