/**
 * PDF au texte réel : le dépôt du document et sa page d'impression.
 *
 * L'impression elle-même demande Chromium, donc Electron : elle est éprouvée
 * par l'essai de bout en bout de l'interface. Ici, ce qui l'entoure.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { startTestServer, MOT_DE_PASSE } = require('./helpers.js');
const { reset: resetRateLimit } = require('../rateLimit.js');
const { deposerPage, prendrePage, DUREE_PAGE_MS } = require('../pdfService.js');

function interfaceFactice(t) {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'clora-pdf-'));
  t.after(() => fs.rmSync(dossier, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dossier, 'index.html'),
    '<html><head><link rel="stylesheet" crossorigin href="/assets/index-ABC.css"></head></html>');
  return dossier;
}

test('le document déposé reprend les styles de l\'interface et s\'imprime en clair', (t) => {
  const jeton = deposerPage('<div class="print-only">Facture</div>', {
    titre: 'Facture <FAC-1>.pdf', langue: 'en', dossierClient: interfaceFactice(t)
  });
  assert.match(jeton, /^[0-9a-f]{48}$/);

  const page = prendrePage(jeton);
  assert.match(page, /<link rel="stylesheet" href="\/assets\/index-ABC.css">/, 'polices et classes de l\'application');
  assert.match(page, /<html lang="en" data-theme="light">/, 'jamais en thème sombre');
  assert.match(page, /<title>Facture &lt;FAC-1&gt;.pdf<\/title>/, 'le titre est échappé');
  assert.match(page, /<body><div class="print-only">Facture<\/div><\/body>/);

  assert.equal(prendrePage(jeton), null, 'une page ne se lit qu\'une fois');
});

test('une page déposée expire au bout d\'une minute', (t) => {
  const jeton = deposerPage('<p>x</p>', { dossierClient: interfaceFactice(t) });
  const maintenant = Date.now();
  t.mock.method(Date, 'now', () => maintenant + DUREE_PAGE_MS + 1);
  assert.equal(prendrePage(jeton), null);
});

test('la page s\'ouvre par son jeton seul, une fois ; la fabrication exige Electron', async (t) => {
  resetRateLimit();
  const api = await startTestServer();
  t.after(() => api.close());

  // Hors d'Electron, rien ne sait imprimer : l'interface reçoit un refus clair.
  assert.equal((await api.post('/api/pdf', { html: '<p>x</p>' })).status, 401, 'il faut être connecté');
  assert.equal((await api.post('/api/auth/setup', { username: 'patron', password: MOT_DE_PASSE })).status, 200);
  const refus = await api.post('/api/pdf', { html: '<p>x</p>' });
  assert.equal(refus.status, 501);
  assert.match(refus.data.error, /application de bureau/);

  const jeton = deposerPage('<p>Bonjour</p>', { dossierClient: interfaceFactice(t) });
  const sansSession = (url) => fetch(`${api.base}${url}`);
  const page = await sansSession(`/api/pdf/page/${jeton}`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /<p>Bonjour<\/p>/);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/, 'la politique de contenu s\'applique');

  assert.equal((await sansSession(`/api/pdf/page/${jeton}`)).status, 404);
  assert.equal((await sansSession('/api/pdf/page/inconnu')).status, 404);
});
