/**
 * Durcissement du serveur local.
 *
 * Clora n'écoute que sur le poste, mais le navigateur de l'utilisateur est sur
 * ce même poste : un site qu'il visite peut tenter de parler au serveur. Ces
 * tests tiennent les deux verrous posés contre cela.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { startTestServer } = require('./helpers.js');

/** Requête brute, pour choisir l'en-tête Host que `fetch` n'autorise pas à changer. */
function requete(base, chemin, hote) {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: url.hostname, port: url.port, path: chemin, headers: hote ? { Host: hote } : {} }, (res) => {
      let corps = '';
      res.on('data', (d) => { corps += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, corps }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function serveur(t) {
  const api = await startTestServer();
  t.after(() => api.close());
  return api;
}

test('une requête adressée à un autre nom que celui du poste est refusée', async (t) => {
  const api = await serveur(t);
  const port = new URL(api.base).port;

  for (const etranger of ['site-malveillant.example', `site-malveillant.example:${port}`, '192.168.1.20', '127.0.0.1.site-malveillant.example']) {
    const res = await requete(api.base, '/api/auth/setup-status', etranger);
    assert.equal(res.status, 403, `Host « ${etranger} » doit être refusé`);
    assert.match(res.corps, /hôte inconnu/);
  }
});

test('le poste lui-même reste servi, sous tous ses noms', async (t) => {
  const api = await serveur(t);
  const port = new URL(api.base).port;

  for (const local of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, 'LOCALHOST']) {
    const res = await requete(api.base, '/api/auth/setup-status', local);
    assert.equal(res.status, 200, `Host « ${local} » doit être accepté`);
  }
});

test('l\'interface n\'est pas servie non plus à un hôte étranger', async (t) => {
  const api = await serveur(t);
  assert.equal((await requete(api.base, '/', 'site-malveillant.example')).status, 403);
});

test('chaque réponse porte la politique de contenu', async (t) => {
  const api = await serveur(t);
  const { headers } = await requete(api.base, '/api/auth/setup-status');
  const politique = headers['content-security-policy'];

  assert.ok(politique, 'la politique doit être présente');
  assert.match(politique, /default-src 'self'/);
  assert.match(politique, /script-src 'self'(;|$)/, 'aucun script en ligne ni venu d\'ailleurs');
  assert.match(politique, /connect-src 'self'/, 'rien ne part vers un autre serveur');
  assert.match(politique, /object-src 'none'/);
  assert.match(politique, /frame-ancestors 'none'/);
  assert.ok(!/unsafe-eval/.test(politique));
});
