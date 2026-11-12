/**
 * Préfixe des numéros de facture.
 *
 * Il était écrit en dur : « SHT », les initiales de l'éditeur. Chaque
 * entreprise équipée de Clora émettait donc des factures au nom d'une autre.
 * Il se règle désormais par dossier, sans jamais rompre une numérotation déjà
 * commencée ni réutiliser un numéro émis.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer, MOT_DE_PASSE } = require('./helpers.js');
const { reset: resetRateLimit } = require('../rateLimit.js');
const { normaliserPrefixe } = require('../sequences.js');

async function avecAdmin(t) {
  resetRateLimit();
  const api = await startTestServer();
  t.after(() => api.close());
  const res = await api.post('/api/auth/setup', { username: 'patron', password: MOT_DE_PASSE });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return api;
}

async function creerClient(api) {
  const res = await api.post('/api/clients', { nom_entreprise: 'Client', email: 'client@exemple.ca', province: 'QC' });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data.client.id;
}

async function facturer(api, clientId) {
  const res = await api.post('/api/factures', {
    client_id: clientId,
    date_emission: '2026-11-10',
    date_echeance: '2026-12-10',
    lignes: [{ description: 'Service', quantite: 1, prix_unitaire: 100 }]
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data.facture.numero_facture;
}

const reglerPrefixe = (api, prefixe) => api.put('/api/settings', { entreprise_nom: 'Entreprise Test', prefixe_facture: prefixe });

test('la mise en forme accepte 2 à 6 lettres ou chiffres, en majuscules', () => {
  assert.equal(normaliserPrefixe(' pt '), 'PT');
  assert.equal(normaliserPrefixe('Fac26'), 'FAC26');
  for (const refuse of ['', 'A', 'TROPLONG', 'A-B', 'É1', 'DEV', 'nc', null, undefined, 42]) {
    assert.equal(normaliserPrefixe(refuse), null, `« ${refuse} » ne doit pas être accepté`);
  }
});

test('un dossier existant garde sa numérotation', async (t) => {
  const api = await avecAdmin(t);
  const clientId = await creerClient(api);

  assert.equal((await api.get('/api/settings')).data.prefixe_facture, 'SHT');
  assert.equal(await facturer(api, clientId), 'SHT-202611-0001');
});

test('changer de préfixe ouvre une série neuve et ne réutilise aucun numéro', async (t) => {
  const api = await avecAdmin(t);
  const clientId = await creerClient(api);
  assert.equal(await facturer(api, clientId), 'SHT-202611-0001');

  const res = await reglerPrefixe(api, 'pt');
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal((await api.get('/api/settings')).data.prefixe_facture, 'PT', 'le préfixe est mis en majuscules');

  assert.equal(await facturer(api, clientId), 'PT-202611-0001');
  assert.equal(await facturer(api, clientId), 'PT-202611-0002');

  // Les factures déjà émises ne bougent pas.
  const numeros = (await api.db.all('SELECT numero_facture FROM factures ORDER BY id')).map((f) => f.numero_facture);
  assert.deepEqual(numeros, ['SHT-202611-0001', 'PT-202611-0001', 'PT-202611-0002']);

  // Revenir à l'ancien préfixe reprend sa série là où elle en était.
  await reglerPrefixe(api, 'SHT');
  assert.equal(await facturer(api, clientId), 'SHT-202611-0002');
});

test('un préfixe mal formé ou réservé est refusé, et l\'ancien reste en place', async (t) => {
  const api = await avecAdmin(t);

  for (const refuse of ['', 'A', 'TROPLONG', 'A-B', 'DEV', 'nc']) {
    const res = await reglerPrefixe(api, refuse);
    assert.equal(res.status, 400, `« ${refuse} » : ${JSON.stringify(res.data)}`);
  }
  assert.match((await reglerPrefixe(api, 'DEV')).data.error, /réservés/);
  assert.equal((await api.get('/api/settings')).data.prefixe_facture, 'SHT');
});

test('enregistrer les paramètres sans préfixe ne le change pas', async (t) => {
  const api = await avecAdmin(t);
  await reglerPrefixe(api, 'PT');

  const res = await api.put('/api/settings', { entreprise_nom: 'Entreprise Test' });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal((await api.get('/api/settings')).data.prefixe_facture, 'PT');
});

test('un dossier neuf ne porte pas les initiales de l\'éditeur', async (t) => {
  const api = await avecAdmin(t);

  const dossier = await api.post('/api/entreprises', { nom: 'Plomberie Tremblay' });
  assert.equal(dossier.status, 201, JSON.stringify(dossier.data));

  assert.equal((await api.get('/api/settings')).data.prefixe_facture, 'FAC');
  assert.equal(await facturer(api, await creerClient(api)), 'FAC-202611-0001');
});

test('le changement de préfixe est consigné au journal', async (t) => {
  const api = await avecAdmin(t);
  await reglerPrefixe(api, 'PT');

  const ligne = await api.db.get(
    "SELECT details FROM logs_audit WHERE action = 'parametres.modification' ORDER BY id DESC LIMIT 1"
  );
  assert.ok(ligne, 'la modification doit figurer au journal');
  assert.deepEqual(JSON.parse(ligne.details).changements.prefixe_facture, { avant: 'SHT', apres: 'PT' });
});

test('un préfixe abîmé en base n\'interrompt pas la facturation', async (t) => {
  const api = await avecAdmin(t);
  const clientId = await creerClient(api);

  await api.db.run('UPDATE settings SET prefixe_facture = NULL');
  assert.equal(await facturer(api, clientId), 'SHT-202611-0001');
});
