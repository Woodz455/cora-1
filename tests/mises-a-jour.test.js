/**
 * Vérification des mises à jour.
 *
 * Le point sensible n'est pas la comparaison de versions, mais le fait
 * qu'**aucune requête ne parte** quand l'utilisateur a coupé la vérification :
 * c'est le seul appel sortant de l'application.
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

const { createTestDb, startTestServer, MOT_DE_PASSE } = require('./helpers.js');
const { reset: resetRateLimit } = require('../rateLimit.js');
const {
  comparerVersions, verifierMiseAJour, versionCourante, estEmpaquetee, reinitialiser
} = require('../updateService.js');

async function prepare(t) {
  reinitialiser();
  const db = await createTestDb();
  t.after(() => db.__cleanup());
  return db;
}

/* --- Comparaison --- */

test('les versions se comparent composante par composante', () => {
  assert.ok(comparerVersions('1.3.0', '1.2.9') > 0);
  assert.ok(comparerVersions('2.0.0', '1.99.99') > 0);
  assert.ok(comparerVersions('1.2.10', '1.2.9') > 0, '10 est postérieur à 9, pas antérieur');
  assert.equal(comparerVersions('1.2.0', '1.2.0'), 0);
  assert.ok(comparerVersions('1.1.0', '1.2.0') < 0);
});

test('le préfixe « v » des étiquettes est ignoré', () => {
  assert.equal(comparerVersions('v1.2.0', '1.2.0'), 0);
  assert.ok(comparerVersions('v1.3.0', 'v1.2.0') > 0);
});

test('une version incomplète ou absurde ne fait pas tout basculer', () => {
  // Une étiquette mal formée ne doit pas se lire comme une version supérieure
  // et déclencher une alerte à tort.
  // « v2.1 » se publie couramment : une étiquette à deux composantes doit se
  // comparer normalement, et non rendre NaN.
  assert.equal(comparerVersions('1.2', '1.2.0'), 0);
  assert.ok(comparerVersions('2.1', '1.9.9') > 0);
  assert.ok(comparerVersions('bidon', '1.2.0') < 0);
  assert.ok(comparerVersions('', '1.2.0') < 0);
});

/* --- Comportement --- */

test('la version courante est celle de package.json hors Electron', () => {
  assert.equal(versionCourante(), require('../package.json').version);
  assert.equal(estEmpaquetee(), false);
});

test('en développement, rien n\'est vérifié', async (t) => {
  const db = await prepare(t);

  // Interroger le réseau à chaque rechargement en développement serait
  // inutilement bavard, et la version installée n'a pas de sens à comparer.
  const resultat = await verifierMiseAJour(db);

  assert.equal(resultat.verifie, false);
  assert.equal(resultat.raison, 'developpement');
  assert.equal(resultat.disponible, false);
});

test('le réglage désactivé empêche tout appel sortant', async (t) => {
  const db = await prepare(t);
  await db.run('UPDATE settings SET verifier_maj = 0');

  // On rend toute sortie réseau impossible : si le service tentait malgré tout
  // une requête, elle échouerait et le test le verrait.
  const vraiGet = http.get;
  let appels = 0;
  const https = require('https');
  const vraiHttpsGet = https.get;
  https.get = (...args) => { appels += 1; return vraiHttpsGet(...args); };

  try {
    const resultat = await verifierMiseAJour(db, { forcer: true });

    assert.equal(resultat.verifie, false);
    assert.equal(resultat.raison, 'desactivee');
    assert.equal(appels, 0, 'aucune requête ne doit partir quand la vérification est coupée');
  } finally {
    https.get = vraiHttpsGet;
    http.get = vraiGet;
  }
});

test('une panne réseau reste silencieuse', async (t) => {
  const db = await prepare(t);

  const https = require('https');
  const vrai = https.get;
  https.get = (url, options, rappel) => {
    const emetteur = new (require('events').EventEmitter)();
    emetteur.destroy = () => {};
    // Panne immédiate, comme hors ligne ou derrière un pare-feu d'entreprise.
    setImmediate(() => emetteur.emit('error', new Error('ENOTFOUND')));
    return emetteur;
  };

  try {
    const resultat = await verifierMiseAJour(db, { forcer: true });

    assert.equal(resultat.verifie, false, 'une panne ne doit pas être présentée comme une vérification');
    assert.equal(resultat.disponible, false, 'et surtout pas comme une mise à jour disponible');
    assert.equal(resultat.courante, versionCourante());
  } finally {
    https.get = vrai;
  }
});

/* --- Route --- */

test('la route expose la version à tous les rôles', async (t) => {
  resetRateLimit();
  reinitialiser();
  const api = await startTestServer();
  t.after(() => api.close());
  await api.post('/api/auth/setup', { username: 'patron', password: MOT_DE_PASSE });

  await api.post('/api/users', { username: 'employe1', password: MOT_DE_PASSE, role: 'employe' });
  await api.post('/api/auth/login', { username: 'employe1', password: MOT_DE_PASSE });

  // Le bandeau s'affiche pour quiconque utilise l'application, pas seulement
  // pour l'administrateur.
  const res = await api.get('/api/version');

  assert.equal(res.status, 200);
  assert.equal(res.data.courante, require('../package.json').version);
  assert.match(res.data.page, /github\.com/);

  api.clearCookie();
  assert.equal((await api.get('/api/version')).status, 401);
});

test('le réglage se coupe depuis les paramètres et est journalisé', async (t) => {
  resetRateLimit();
  reinitialiser();
  const api = await startTestServer();
  t.after(() => api.close());
  await api.post('/api/auth/setup', { username: 'patron', password: MOT_DE_PASSE });

  const base = { entreprise_nom: 'Test', taxe_1_taux: 0.05, taxe_2_taux: 0.09975 };
  await api.put('/api/settings', { ...base, verifier_maj: 0 });

  const settings = await api.get('/api/settings');
  assert.equal(settings.data.verifier_maj, 0);

  const trace = await api.db.get(
    'SELECT details FROM logs_audit WHERE action = ? ORDER BY id DESC LIMIT 1',
    ['parametres.modification']
  );
  const { changements } = JSON.parse(trace.details);
  assert.deepEqual(changements.verifier_maj, { avant: 1, apres: 0 });
});

test('omettre le réglage ne le désactive pas', async (t) => {
  resetRateLimit();
  reinitialiser();
  const api = await startTestServer();
  t.after(() => api.close());
  await api.post('/api/auth/setup', { username: 'patron', password: MOT_DE_PASSE });

  // Même piège que pour les sauvegardes : l'absence du champ ne doit pas se
  // lire comme un refus.
  await api.put('/api/settings', { entreprise_nom: 'Test', taxe_1_taux: 0.05, taxe_2_taux: 0.09975 });

  const settings = await api.get('/api/settings');
  assert.equal(settings.data.verifier_maj, 1);
});
