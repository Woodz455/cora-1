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

test('un dépôt plus gros que la facture ne la solde que de son dû', async (t) => {
  const { api, factureId } = await prepare(t);
  await api.post('/api/banque/import', [
    { date_transaction: '2026-07-05', description: 'Gros dépôt', montant: 5000 }
  ]);

  const transactions = await api.get('/api/banque/transactions');
  const res = await api.post(`/api/banque/rapprocher/${transactions.data[0].id}`, { facture_id: factureId });

  // Le rapprochement n'était pas plafonné : le solde devenait négatif. Il l'est
  // désormais au dû de la facture, le reste du dépôt demeurant à imputer.
  assert.equal(res.status, 200, JSON.stringify(res.data));

  const solde = await api.get(`/api/factures/${factureId}/solde`);
  assert.equal(solde.data.montant_paye, 1149.75);
  assert.equal(solde.data.solde_restant, 0);

  const restantes = await api.get('/api/banque/transactions');
  assert.equal(restantes.data.length, 1, 'le dépôt reste dans la file');
  assert.equal(restantes.data[0].montant_restant, 3850.25);
  assert.equal(restantes.data[0].statut, 'Partiellement rapproché');
});

test('une part explicitement supérieure au solde reste refusée', async (t) => {
  const { api, factureId } = await prepare(t);
  await api.post('/api/banque/import', [
    { date_transaction: '2026-07-05', description: 'Gros dépôt', montant: 5000 }
  ]);

  const transactions = await api.get('/api/banque/transactions');
  const res = await api.post(`/api/banque/rapprocher/${transactions.data[0].id}`, {
    facture_id: factureId, montant: 2000
  });

  assert.equal(res.status, 400);
  assert.match(res.data.error, /dépasse le solde restant/);

  const solde = await api.get(`/api/factures/${factureId}/solde`);
  assert.equal(solde.data.montant_paye, 0);
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

test('un dépôt entièrement imputé ne peut pas être rapproché deux fois', async (t) => {
  const { api, factureId } = await prepare(t);
  await api.post('/api/banque/import', [
    { date_transaction: '2026-07-05', description: 'Dépôt', montant: 500 }
  ]);

  const transactions = await api.get('/api/banque/transactions');
  const id = transactions.data[0].id;

  assert.equal((await api.post(`/api/banque/rapprocher/${id}`, { facture_id: factureId })).status, 200);
  const second = await api.post(`/api/banque/rapprocher/${id}`, { facture_id: factureId });
  assert.equal(second.status, 400);
  assert.match(second.data.error, /déjà entièrement imputé/);
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

/** Serveur avec un dépôt de 3 000 $ et trois factures ouvertes. */
async function prepareDepotGlobal(t) {
  resetRateLimit();
  const api = await startTestServer();
  t.after(() => api.close());

  await api.post('/api/auth/setup', { username: 'patron', password: MOT_DE_PASSE });
  const client = await api.post('/api/clients', {
    nom_entreprise: 'Client Test', email: 'client@exemple.ca', province: 'ON'
  });

  const factures = [];
  for (const prix of [1000, 500, 200]) {
    const f = await api.post('/api/factures', {
      client_id: client.data.client.id,
      date_emission: '2026-07-01', date_echeance: '2026-07-31',
      lignes: [{ description: 'Service', quantite: 1, prix_unitaire: prix }]
    });
    factures.push(f.data.facture);
  }

  await api.post('/api/banque/import', [
    { date_transaction: '2026-07-05', description: 'Virement global', montant: 3000 }
  ]);
  const [depot] = (await api.get('/api/banque/transactions')).data;

  // 1130 + 565 + 226 = 1921, sur un dépôt de 3000.
  return { api, depot, factures };
}

test('un dépôt se répartit sur plusieurs factures', async (t) => {
  const { api, depot, factures } = await prepareDepotGlobal(t);

  for (const f of factures) {
    const res = await api.post(`/api/banque/rapprocher/${depot.id}`, { facture_id: f.id });
    assert.equal(res.status, 200, JSON.stringify(res.data));
  }

  for (const f of factures) {
    const solde = await api.get(`/api/factures/${f.id}/solde`);
    assert.equal(solde.data.solde_restant, 0, `${f.numero_facture} soldée`);
    assert.equal(solde.data.statut, 'Payée');
  }

  const [restant] = (await api.get('/api/banque/transactions')).data;
  assert.equal(restant.montant_rapproche, 1921);
  assert.equal(restant.montant_restant, 1079);
  assert.equal(restant.statut, 'Partiellement rapproché');
});

test('le reste à imputer décroît à chaque part', async (t) => {
  const { api, depot, factures } = await prepareDepotGlobal(t);

  await api.post(`/api/banque/rapprocher/${depot.id}`, { facture_id: factures[0].id, montant: 400 });
  let etat = (await api.get('/api/banque/transactions')).data[0];
  assert.equal(etat.montant_restant, 2600);

  await api.post(`/api/banque/rapprocher/${depot.id}`, { facture_id: factures[0].id, montant: 730 });
  etat = (await api.get('/api/banque/transactions')).data[0];
  assert.equal(etat.montant_restant, 1870);

  const solde = await api.get(`/api/factures/${factures[0].id}/solde`);
  assert.equal(solde.data.montant_paye, 1130, 'deux versements sur la même facture');
  assert.equal(solde.data.statut, 'Payée');
});

test('un dépôt entièrement réparti quitte la file', async (t) => {
  const { api, factures } = await prepareDepotGlobal(t);

  // Dépôt de 300 $ sur une facture de 1 130 $ : deux parts l'épuisent.
  await api.post('/api/banque/import', [
    { date_transaction: '2026-07-08', description: 'Acompte', montant: 300 }
  ]);
  const acompte = (await api.get('/api/banque/transactions')).data.find((tr) => tr.montant === 300);

  await api.post(`/api/banque/rapprocher/${acompte.id}`, { facture_id: factures[0].id, montant: 120 });
  assert.equal(
    (await api.get('/api/banque/transactions')).data.find((tr) => tr.id === acompte.id).statut,
    'Partiellement rapproché'
  );

  await api.post(`/api/banque/rapprocher/${acompte.id}`, { facture_id: factures[0].id, montant: 180 });

  const enFile = (await api.get('/api/banque/transactions')).data;
  assert.equal(enFile.some((tr) => tr.id === acompte.id), false, 'il quitte la file');

  const rapproches = await api.get('/api/banque/transactions?status=Rapproch%C3%A9');
  const solde = rapproches.data.find((tr) => tr.id === acompte.id);
  assert.equal(solde.montant_restant, 0);
  assert.equal(solde.facture_id, factures[0].id, 'une seule facture : le lien est conservé');
});

test('une part supérieure au reste du dépôt est refusée', async (t) => {
  const { api, factures } = await prepareDepotGlobal(t);

  // 300 $ de dépôt, dont 250 déjà imputés : il n'en reste que 50, bien en deçà
  // du solde de la facture — c'est donc le dépôt qui borne, pas la facture.
  await api.post('/api/banque/import', [
    { date_transaction: '2026-07-08', description: 'Acompte', montant: 300 }
  ]);
  const acompte = (await api.get('/api/banque/transactions')).data.find((tr) => tr.montant === 300);
  await api.post(`/api/banque/rapprocher/${acompte.id}`, { facture_id: factures[0].id, montant: 250 });

  const res = await api.post(`/api/banque/rapprocher/${acompte.id}`, {
    facture_id: factures[1].id, montant: 100
  });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /reste de ce dépôt/);

  const etat = (await api.get('/api/banque/transactions')).data.find((tr) => tr.id === acompte.id);
  assert.equal(etat.montant_restant, 50, 'le refus ne consomme rien');
});

test('annuler une part rend le dépôt de nouveau disponible', async (t) => {
  const { api, depot, factures } = await prepareDepotGlobal(t);

  await api.post(`/api/banque/rapprocher/${depot.id}`, { facture_id: factures[0].id });
  await api.post(`/api/banque/rapprocher/${depot.id}`, { facture_id: factures[1].id });
  assert.equal((await api.get('/api/banque/transactions')).data[0].montant_rapproche, 1695);

  const details = await api.get(`/api/factures/${factures[0].id}/details`);
  await api.del(`/api/factures/paiements/${details.data.paiements[0].id}`, { motif: 'Mauvaise facture' });

  const etat = (await api.get('/api/banque/transactions')).data[0];
  assert.equal(etat.montant_rapproche, 565, 'seule la part annulée est libérée');
  assert.equal(etat.montant_restant, 2435);
  assert.equal(etat.statut, 'Partiellement rapproché', 'l\'autre part la maintient partielle');
});

test('annuler la dernière part remet le dépôt en attente', async (t) => {
  const { api, depot, factures } = await prepareDepotGlobal(t);
  await api.post(`/api/banque/rapprocher/${depot.id}`, { facture_id: factures[0].id });

  const details = await api.get(`/api/factures/${factures[0].id}/details`);
  await api.del(`/api/factures/paiements/${details.data.paiements[0].id}`, { motif: 'Erreur' });

  const etat = (await api.get('/api/banque/transactions')).data[0];
  assert.equal(etat.montant_rapproche, 0);
  assert.equal(etat.statut, 'En attente');
  assert.equal(etat.facture_id, null, 'le lien de facture est défait');
});

test('un dépôt déjà imputé ne peut plus être ignoré', async (t) => {
  const { api, depot, factures } = await prepareDepotGlobal(t);
  await api.post(`/api/banque/rapprocher/${depot.id}`, { facture_id: factures[0].id, montant: 100 });

  const res = await api.post(`/api/banque/ignorer/${depot.id}`);
  assert.equal(res.status, 400);
  assert.match(res.data.error, /annulez d'abord/);
});

test('le détail des imputations d\'un dépôt est consultable', async (t) => {
  const { api, depot, factures } = await prepareDepotGlobal(t);
  await api.post(`/api/banque/rapprocher/${depot.id}`, { facture_id: factures[0].id });
  await api.post(`/api/banque/rapprocher/${depot.id}`, { facture_id: factures[1].id });

  const res = await api.get(`/api/banque/transactions/${depot.id}/imputations`);
  assert.equal(res.status, 200);
  assert.equal(res.data.imputations.length, 2);
  assert.deepEqual(
    res.data.imputations.map((i) => i.montant).sort((a, b) => a - b),
    [565, 1130]
  );
  assert.equal(res.data.transaction.montant_restant, 1305);
});

test('un dépôt ignoré ne peut pas être imputé', async (t) => {
  const { api, depot, factures } = await prepareDepotGlobal(t);
  await api.post(`/api/banque/ignorer/${depot.id}`);

  const res = await api.post(`/api/banque/rapprocher/${depot.id}`, { facture_id: factures[0].id });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /ignorée/);
});
