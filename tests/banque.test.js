/**
 * Rapprochement bancaire : importation, doublons, plafonnement et devises.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer, MOT_DE_PASSE } = require('./helpers.js');
const { reset: resetRateLimit } = require('../rateLimit.js');

const RELEVE = [
  { date_transaction: '2026-07-05', description: 'Dépôt client A', montant: 1149.75 },
  { date_transaction: '2026-07-06', description: 'Frais bancaires', montant: -12.5 },
  { date_transaction: '2026-07-07', description: 'Dépôt client B', montant: 500 }
];

/** Serveur avec un admin connecté, un client et une facture de 1000 $ HT. */
async function prepare(t, options = {}) {
  resetRateLimit();
  const api = await startTestServer();
  t.after(() => api.close());

  await api.post('/api/auth/setup', { username: 'patron', password: MOT_DE_PASSE });

  const client = await api.post('/api/clients', {
    nom_entreprise: 'Client Test', email: 'client@exemple.ca', province: 'QC'
  });
  const facture = await api.post('/api/factures', {
    client_id: client.data.client.id,
    date_emission: '2026-07-01',
    date_echeance: '2026-07-31',
    devise: options.devise || 'CAD',
    taux_change: options.tauxChange || 1,
    lignes: [{ description: 'Service', quantite: 1, prix_unitaire: 1000 }]
  });
  assert.equal(facture.status, 201, JSON.stringify(facture.data));

  return { api, factureId: facture.data.facture.id };
}

test('seuls les dépôts sont importés', async (t) => {
  const { api } = await prepare(t);

  const res = await api.post('/api/banque/import', RELEVE);
  assert.equal(res.status, 200);
  assert.equal(res.data.inserted, 2);
  assert.equal(res.data.ignored, 1); // les frais bancaires

  const transactions = await api.get('/api/banque/transactions');
  assert.equal(transactions.data.length, 2);
});

test('réimporter le même relevé ne duplique rien', async (t) => {
  const { api } = await prepare(t);
  await api.post('/api/banque/import', RELEVE);

  // Le même relevé importé deux fois dupliquait auparavant toutes ses lignes.
  const second = await api.post('/api/banque/import', RELEVE);
  assert.equal(second.data.inserted, 0);
  assert.equal(second.data.ignored, 3);

  const transactions = await api.get('/api/banque/transactions');
  assert.equal(transactions.data.length, 2);
});

test('les lignes mal formées sont comptées à part', async (t) => {
  const { api } = await prepare(t);

  const res = await api.post('/api/banque/import', [
    { date_transaction: 'pas-une-date', description: 'X', montant: 100 },
    { date_transaction: '2026-07-05', description: '', montant: 100 },
    { date_transaction: '2026-07-05', description: 'Valide', montant: 100 }
  ]);

  assert.equal(res.data.inserted, 1);
  assert.equal(res.data.invalid, 2);
});

test('un dépôt égal au solde solde la facture', async (t) => {
  const { api, factureId } = await prepare(t);
  await api.post('/api/banque/import', RELEVE);

  const transactions = await api.get('/api/banque/transactions');
  const depot = transactions.data.find((tr) => tr.montant === 1149.75);

  const res = await api.post(`/api/banque/rapprocher/${depot.id}`, { facture_id: factureId });
  assert.equal(res.status, 200, JSON.stringify(res.data));

  const solde = await api.get(`/api/factures/${factureId}/solde`);
  assert.equal(solde.data.solde_restant, 0);
  assert.equal(solde.data.statut, 'Payée');

  // La transaction est marquée et disparaît de la file d'attente.
  const restantes = await api.get('/api/banque/transactions');
  assert.equal(restantes.data.length, 1);
});

test('un dépôt supérieur au solde est refusé', async (t) => {
  const { api, factureId } = await prepare(t);
  await api.post('/api/banque/import', [
    { date_transaction: '2026-07-05', description: 'Gros dépôt', montant: 5000 }
  ]);

  const transactions = await api.get('/api/banque/transactions');
  const res = await api.post(`/api/banque/rapprocher/${transactions.data[0].id}`, { facture_id: factureId });

  // Le rapprochement n'était pas plafonné : le solde devenait négatif.
  assert.equal(res.status, 400);
  assert.match(res.data.error, /dépasse le solde restant/);

  const solde = await api.get(`/api/factures/${factureId}/solde`);
  assert.equal(solde.data.montant_paye, 0);

  // La transaction reste disponible pour un autre rapprochement.
  const restantes = await api.get('/api/banque/transactions');
  assert.equal(restantes.data.length, 1);
});

test('une facture en devise étrangère ne peut pas être rapprochée', async (t) => {
  const { api, factureId } = await prepare(t, { devise: 'USD', tauxChange: 1.35 });
  await api.post('/api/banque/import', [
    { date_transaction: '2026-07-05', description: 'Dépôt CAD', montant: 500 }
  ]);

  const transactions = await api.get('/api/banque/transactions');
  const res = await api.post(`/api/banque/rapprocher/${transactions.data[0].id}`, { facture_id: factureId });

  // Un dépôt en dollars canadiens était imputé tel quel sur un solde en dollars américains.
  assert.equal(res.status, 400);
  assert.match(res.data.error, /USD/);
});

test('une transaction déjà traitée ne peut pas être rapprochée deux fois', async (t) => {
  const { api, factureId } = await prepare(t);
  await api.post('/api/banque/import', [
    { date_transaction: '2026-07-05', description: 'Dépôt', montant: 500 }
  ]);

  const transactions = await api.get('/api/banque/transactions');
  const id = transactions.data[0].id;

  assert.equal((await api.post(`/api/banque/rapprocher/${id}`, { facture_id: factureId })).status, 200);
  const second = await api.post(`/api/banque/rapprocher/${id}`, { facture_id: factureId });
  assert.equal(second.status, 400);
  assert.match(second.data.error, /déjà traitée/);
});

test('une transaction rapprochée ne peut plus être ignorée', async (t) => {
  const { api, factureId } = await prepare(t);
  await api.post('/api/banque/import', [
    { date_transaction: '2026-07-05', description: 'Dépôt', montant: 500 }
  ]);
  const transactions = await api.get('/api/banque/transactions');
  const id = transactions.data[0].id;
  await api.post(`/api/banque/rapprocher/${id}`, { facture_id: factureId });

  const res = await api.post(`/api/banque/ignorer/${id}`);
  assert.equal(res.status, 400);
});

test('un corps qui n\'est pas un tableau est refusé', async (t) => {
  const { api } = await prepare(t);
  const res = await api.post('/api/banque/import', { pas: 'un tableau' });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /tableau/);
});
