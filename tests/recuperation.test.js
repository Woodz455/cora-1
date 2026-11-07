/**
 * Code de récupération du mot de passe.
 *
 * Sans lui, un administrateur seul qui oublie son mot de passe n'a plus aucun
 * moyen de rentrer dans sa comptabilité. Le code doit donc marcher, ne servir
 * qu'une fois, et ne rien laisser deviner à qui l'essaierait au hasard.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer, MOT_DE_PASSE } = require('./helpers.js');
const { reset: resetRateLimit } = require('../rateLimit.js');

const FORME = /^([0-9A-HJKMNP-TV-Z]{4}-){4}[0-9A-HJKMNP-TV-Z]{4}$/;
const NOUVEAU = 'nouveau-mot-de-passe';

async function avecAdmin(t) {
  resetRateLimit();
  const api = await startTestServer();
  t.after(() => api.close());
  const res = await api.post('/api/auth/setup', { username: 'patron', password: MOT_DE_PASSE });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return { api, code: res.data.code_recuperation };
}

const reinitialiser = (api, corps) => api.post('/api/auth/reinitialiser', { username: 'patron', nouveauMotDePasse: NOUVEAU, ...corps });

test('la configuration remet un code de récupération, gardé sous forme d\'empreinte', async (t) => {
  const { api, code } = await avecAdmin(t);
  assert.match(code, FORME);

  const compte = await api.comptesDb.get("SELECT recuperation_empreinte FROM users WHERE username = 'patron'");
  assert.ok(compte.recuperation_empreinte.startsWith('$2'), 'seule une empreinte bcrypt est gardée');
  assert.ok(!compte.recuperation_empreinte.includes(code.replace(/-/g, '')));
  assert.ok((await api.get('/api/auth/check')).data.recuperation_le);
});

test('le code rend l\'accès une fois, et en remet un nouveau', async (t) => {
  const { api, code } = await avecAdmin(t);
  api.clearCookie();

  // Saisie indulgente : minuscules, espaces, O pour 0.
  const saisie = code.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o');
  const res = await reinitialiser(api, { code: saisie });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.match(res.data.code_recuperation, FORME);
  assert.notEqual(res.data.code_recuperation, code);

  assert.equal((await api.post('/api/auth/login', { username: 'patron', password: MOT_DE_PASSE })).status, 401);
  assert.equal((await api.post('/api/auth/login', { username: 'patron', password: NOUVEAU })).status, 200);

  assert.equal((await reinitialiser(api, { code })).status, 401, 'le code ne sert qu\'une fois');
  assert.equal((await reinitialiser(api, { code: res.data.code_recuperation })).status, 200);
});

test('un code erroné, un compte inconnu ou sans code reçoivent la même réponse', async (t) => {
  const { api } = await avecAdmin(t);
  await api.post('/api/users', { username: 'sanscode', password: MOT_DE_PASSE, role: 'employe' });
  const autre = 'ABCD-EFGH-JKMN-PQRS-TVWX';

  const reponses = [
    await reinitialiser(api, { code: autre }),
    await reinitialiser(api, { username: 'inconnu', code: autre }),
    await reinitialiser(api, { username: 'sanscode', code: autre }),
    await reinitialiser(api, { code: 'pas un code' })
  ];
  for (const r of reponses) {
    assert.equal(r.status, 401);
    assert.equal(r.data.error, 'Identifiant ou code de récupération invalide.');
  }
  assert.equal((await reinitialiser(api, { code: autre, nouveauMotDePasse: 'court' })).status, 400);
});

test('les essais sont limités comme à la connexion', async (t) => {
  const { api, code } = await avecAdmin(t);
  const autre = 'ABCD-EFGH-JKMN-PQRS-TVWX';
  let derniere;
  for (let i = 0; i < 9; i += 1) derniere = await reinitialiser(api, { code: autre });
  assert.equal(derniere.status, 429);
  assert.equal((await reinitialiser(api, { code })).status, 429, 'même le bon code attend la fin du blocage');
});

test('créer un nouveau code demande le mot de passe, et annule le précédent', async (t) => {
  const { api, code } = await avecAdmin(t);
  assert.equal((await api.post('/api/auth/recuperation', { motDePasse: 'mauvais' })).status, 401);

  const res = await api.post('/api/auth/recuperation', { motDePasse: MOT_DE_PASSE });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.match(res.data.code_recuperation, FORME);

  assert.equal((await reinitialiser(api, { code })).status, 401, 'l\'ancien code ne sert plus');
  assert.equal((await reinitialiser(api, { code: res.data.code_recuperation })).status, 200);
});

test('la réinitialisation est consignée au journal du dossier, sans le code', async (t) => {
  const { api, code } = await avecAdmin(t);
  const res = await reinitialiser(api, { code });
  assert.equal(res.status, 200);

  const ligne = await api.db.get("SELECT utilisateur, details FROM logs_audit WHERE action = 'motdepasse.reinitialisation'");
  assert.ok(ligne, 'la réinitialisation doit figurer au journal');
  assert.equal(ligne.utilisateur, 'patron');
  for (const c of [code, res.data.code_recuperation]) {
    assert.ok(!ligne.details.includes(c) && !ligne.details.includes(c.replace(/-/g, '')));
  }
  assert.ok(!ligne.details.includes(NOUVEAU));
});
