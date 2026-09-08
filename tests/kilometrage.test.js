/**
 * Indemnité kilométrique : paliers, recalcul de l'année et cloisonnement.
 *
 * Le cœur de ces tests est le recalcul. Le montant d'un déplacement dépend du
 * cumul de l'année, donc de sa position dans le journal : antidater un trajet
 * oublié doit réajuster ceux qui le suivent, sans quoi l'année reste fausse.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer, MOT_DE_PASSE } = require('./helpers.js');
const { reset: resetRateLimit } = require('../rateLimit.js');

/** Taux d'exemple, choisis pour que les montants tombent juste à la lecture. */
const TAUX = { annee: 2026, taux_1: 0.70, taux_2: 0.64, seuil_km: 5000 };

/** Serveur avec un administrateur connecté. */
async function prepare(t, { taux = TAUX } = {}) {
  resetRateLimit();
  const api = await startTestServer();
  t.after(() => api.close());

  await api.post('/api/auth/setup', { username: 'patron', password: MOT_DE_PASSE });
  if (taux) {
    const res = await api.put('/api/settings/taux-kilometriques', taux);
    assert.equal(res.status, 200, 'les taux devraient être acceptés');
  }
  return api;
}

/** Inscrit un déplacement et renvoie la dépense créée. */
async function trajet(api, date, kilometres, extra = {}) {
  const res = await api.post('/api/depenses', {
    date_depense: date,
    description: extra.description || 'Audition',
    categorie: 'Frais de déplacement',
    vehicule: extra.vehicule || 'Toyota Corolla 2022',
    kilometres,
    ...extra.corps
  });
  return res;
}

/** Montant courant d'une dépense, relu depuis l'API. */
async function montantDe(api, id) {
  const { data } = await api.get('/api/depenses');
  const ligne = data.find((d) => d.id === id);
  return ligne ? ligne.montant_ht : null;
}

test('sous le seuil, la distance est payée au premier taux', async (t) => {
  const api = await prepare(t);

  const res = await trajet(api, '2026-03-01', 100);

  assert.equal(res.status, 201);
  assert.equal(res.data.montant_ht, 70);
  assert.equal(res.data.kilometres, 100);
  assert.equal(res.data.vehicule, 'Toyota Corolla 2022');
});

test('un trajet qui enjambe le seuil est payé aux deux taux', async (t) => {
  const api = await prepare(t);

  await trajet(api, '2026-03-01', 4900);
  const res = await trajet(api, '2026-06-01', 200);

  // 100 km sous le seuil à 0,70 $, puis 100 km au-delà à 0,64 $.
  assert.equal(res.data.montant_ht, 134);
});

test('antidater un trajet réajuste les montants de toute l\'année', async (t) => {
  const api = await prepare(t);

  const a = (await trajet(api, '2026-03-01', 4900)).data;
  const b = (await trajet(api, '2026-06-01', 200)).data;

  assert.equal(a.montant_ht, 3430, '4 900 km entièrement sous le seuil');
  assert.equal(b.montant_ht, 134);

  // Le trajet oublié s'intercale avant les deux autres et repousse 200 km
  // au-delà du seuil.
  const c = (await trajet(api, '2026-01-15', 300)).data;

  assert.equal(c.montant_ht, 210, '300 km sous le seuil');
  assert.equal(await montantDe(api, a.id), 3418, '4 700 km sous le seuil, 200 au-delà');
  assert.equal(await montantDe(api, b.id), 128, 'désormais entièrement au-delà du seuil');

  // Le total de l'année ne dépend pas de l'ordre de saisie : 5 400 km, dont
  // 5 000 au premier taux et 400 au second.
  const total = 210 + 3418 + 128;
  assert.equal(total, 5000 * 0.70 + 400 * 0.64);
});

test('supprimer un trajet libère les kilomètres et réajuste les suivants', async (t) => {
  const api = await prepare(t);

  const c = (await trajet(api, '2026-01-15', 300)).data;
  const a = (await trajet(api, '2026-03-01', 4900)).data;
  const b = (await trajet(api, '2026-06-01', 200)).data;

  assert.equal(await montantDe(api, a.id), 3418);
  assert.equal(await montantDe(api, b.id), 128);

  await api.del(`/api/depenses/${c.id}`);

  assert.equal(await montantDe(api, a.id), 3430, 'le seuil se libère de 300 km');
  assert.equal(await montantDe(api, b.id), 134);
});

test('déplacer un trajet d\'une année à l\'autre réajuste les deux', async (t) => {
  const api = await prepare(t);
  await api.put('/api/settings/taux-kilometriques', { ...TAUX, annee: 2027 });

  const a = (await trajet(api, '2026-03-01', 4900)).data;
  const b = (await trajet(api, '2026-06-01', 200)).data;
  assert.equal(await montantDe(api, b.id), 134);

  // Le gros trajet bascule en 2027 : 2026 n'a plus que 200 km, sous le seuil.
  await api.put(`/api/depenses/${a.id}`, {
    date_depense: '2027-03-01', description: 'Audition', kilometres: 4900
  });

  assert.equal(await montantDe(api, b.id), 140, '200 km désormais tous au premier taux');
  assert.equal(await montantDe(api, a.id), 3430, 'seul trajet de 2027');
});

test('changer les taux d\'une année laisse les autres intactes', async (t) => {
  const api = await prepare(t);

  const a = (await trajet(api, '2026-03-01', 100)).data;
  assert.equal(a.montant_ht, 70);

  await api.put('/api/settings/taux-kilometriques', {
    annee: 2027, taux_1: 0.72, taux_2: 0.66, seuil_km: 5000
  });

  assert.equal(await montantDe(api, a.id), 70, 'une année close ne bouge pas');
});

test('changer les taux d\'une année en réajuste les montants', async (t) => {
  const api = await prepare(t);

  const a = (await trajet(api, '2026-03-01', 100)).data;
  assert.equal(a.montant_ht, 70);

  await api.put('/api/settings/taux-kilometriques', { ...TAUX, taux_1: 0.72 });

  assert.equal(await montantDe(api, a.id), 72);
});

test('le montant envoyé par le client est ignoré', async (t) => {
  const api = await prepare(t);

  const res = await trajet(api, '2026-03-01', 100, {
    corps: { montant_ht: 9999, tps: 500, tvq: 900 }
  });

  assert.equal(res.data.montant_ht, 70, 'seul le calcul fait foi');
  assert.equal(res.data.tps, 0);
  assert.equal(res.data.tvq, 0);
});

test('un déplacement est refusé tant que l\'année n\'a pas de taux', async (t) => {
  const api = await prepare(t, { taux: null });

  const res = await trajet(api, '2026-03-01', 100);

  assert.equal(res.status, 400);
  assert.match(res.data.error, /taux kilométrique/i);
  assert.match(res.data.error, /2026/);
});

test('une distance nulle ou négative est refusée', async (t) => {
  const api = await prepare(t);

  for (const km of [0, -10, 'beaucoup']) {
    const res = await trajet(api, '2026-03-01', km);
    assert.equal(res.status, 400, `${km} devrait être refusé`);
  }
});

test('une dépense ordinaire reste inchangée par le kilométrage', async (t) => {
  const api = await prepare(t);

  const res = await api.post('/api/depenses', {
    date_depense: '2026-03-01',
    fournisseur: 'Pétro-Canada',
    description: 'Carburant',
    montant_ht: 100,
    tps: 5,
    tvq: 9.98,
    categorie: 'Véhicule'
  });

  assert.equal(res.status, 201);
  assert.equal(res.data.montant_ht, 100);
  assert.equal(res.data.montant_ttc, 114.98);
  assert.equal(res.data.kilometres, null);
});

test('le kilométrage entre dans le rapport de taxes sans taxe récupérable', async (t) => {
  const api = await prepare(t);

  await trajet(api, '2026-03-01', 100);
  await api.post('/api/depenses', {
    date_depense: '2026-03-02', description: 'Carburant', montant_ht: 100, tps: 5, tvq: 9.98
  });

  const { data } = await api.get('/api/rapports/taxes?annee=2026');

  assert.equal(data.depenses.total_kilometres, 100);
  assert.equal(data.depenses.total_indemnite_kilometrique, 70);
  assert.equal(data.depenses.total_depenses_ht, 170, 'les deux dépenses cumulées');
  assert.equal(data.taxes_payees, 14.98, 'le déplacement n\'ajoute aucune taxe');
});

test('le kilométrage compte dans les charges du tableau des rapports', async (t) => {
  const api = await prepare(t);

  await trajet(api, '2026-03-01', 100);

  const { data } = await api.get('/api/rapports');

  assert.equal(data.total_kilometres, 100);
  assert.equal(data.total_indemnite_kilometrique, 70);
  assert.equal(data.total_depenses_ht, 70);
});

test('les véhicules déjà employés sont proposés sans doublon', async (t) => {
  const api = await prepare(t);

  await trajet(api, '2026-03-01', 100, { vehicule: 'Toyota Corolla 2022' });
  await trajet(api, '2026-03-02', 50, { vehicule: 'Toyota Corolla 2022' });
  await trajet(api, '2026-03-03', 20, { vehicule: 'Transport en commun' });

  const { data } = await api.get('/api/depenses/vehicules');

  assert.deepEqual(data, ['Toyota Corolla 2022', 'Transport en commun']);
});

test('un taux mal saisi est refusé avant de fausser une année', async (t) => {
  const api = await prepare(t);

  // La virgule oubliée : 70 $ du kilomètre au lieu de 0,70 $.
  const enorme = await api.put('/api/settings/taux-kilometriques', { ...TAUX, taux_1: 70 });
  assert.equal(enorme.status, 400);

  for (const corps of [
    { ...TAUX, taux_1: 0 },
    { ...TAUX, taux_2: -1 },
    { ...TAUX, seuil_km: 0 },
    { ...TAUX, annee: 1999 }
  ]) {
    const res = await api.put('/api/settings/taux-kilometriques', corps);
    assert.equal(res.status, 400, `${JSON.stringify(corps)} devrait être refusé`);
  }
});

test('le comptable lit les taux mais ne les modifie pas', async (t) => {
  const api = await prepare(t);

  await api.post('/api/users', {
    username: 'compta', password: MOT_DE_PASSE, role: 'comptable'
  });
  await api.post('/api/auth/logout');
  await api.post('/api/auth/login', { username: 'compta', password: MOT_DE_PASSE });

  assert.equal((await api.get('/api/settings/taux-kilometriques')).status, 200);
  assert.equal(
    (await api.put('/api/settings/taux-kilometriques', TAUX)).status, 403,
    'modifier un taux réécrit une année entière : administrateur seulement'
  );

  // Il peut en revanche inscrire un déplacement, comme toute dépense.
  assert.equal((await trajet(api, '2026-03-01', 100)).status, 201);
});

test('le changement de taux est consigné au journal', async (t) => {
  const api = await prepare(t);

  await api.put('/api/settings/taux-kilometriques', { ...TAUX, taux_1: 0.72 });

  const { data } = await api.get('/api/audit');
  const entree = data.lignes.find((l) => l.entite === 'taux_kilometriques');

  assert.ok(entree, 'le changement devrait figurer au journal');
  assert.equal(entree.details.annee, 2026);
  assert.equal(entree.details.changements.taux_1.avant, 0.7);
  assert.equal(entree.details.changements.taux_1.apres, 0.72);
});
