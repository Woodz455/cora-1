/**
 * Journal de fonctionnement et rapport de diagnostic.
 *
 * Sur un poste installé, rien de ce que Clora signalait n'était écrit nulle
 * part. Le journal le garde, sans grossir sans fin ; le rapport le remet au
 * soutien, sans rien livrer de la comptabilité.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { startTestServer, insertClient, MOT_DE_PASSE } = require('./helpers.js');
const { reset: resetRateLimit } = require('../rateLimit.js');

/** Charge une copie neuve du journal : il garde son état et remplace `console`. */
function journalNeuf(t) {
  const chemin = require.resolve('../journalFichier.js');
  delete require.cache[chemin];
  const origine = { log: console.log, warn: console.warn, error: console.error };
  const journal = require('../journalFichier.js');
  t.after(() => {
    journal.fermer();
    Object.assign(console, origine);
    process.removeAllListeners('uncaughtExceptionMonitor');
    process.removeAllListeners('unhandledRejection');
    delete require.cache[chemin];
  });
  // La console est rendue muette le temps du test : seul compte le fichier.
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  return journal;
}

function dossier(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clora-journal-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('ce que l\'application signale est recopié dans le journal', (t) => {
  const journal = journalNeuf(t);
  const dir = dossier(t);
  const fichier = journal.installer(dir);
  assert.equal(fichier, path.join(dir, 'journaux', 'clora.log'));

  console.log('Sauvegarde créée');
  console.warn('Dossier lent');
  console.error('Sauvegarde impossible :', new Error('disque plein'));
  console.log('objet', { n: 1 });

  const lignes = journal.dernieresLignes();
  assert.match(lignes[0], /^\d{4}-\d{2}-\d{2}T[\d:.]+Z \[info\] Sauvegarde créée$/);
  assert.match(lignes[1], /\[attention\] Dossier lent$/);
  assert.ok(lignes.some((l) => /\[erreur\] Sauvegarde impossible : Error: disque plein/.test(l)), 'une erreur garde son message');
  assert.ok(lignes.some((l) => l.endsWith('objet {"n":1}')));
});

test('le journal tourne au lieu de grossir sans fin', (t) => {
  const journal = journalNeuf(t);
  const dir = dossier(t);
  const fichier = journal.installer(dir);

  const pave = 'x'.repeat(4096);
  for (let i = 0; i < 3 * (journal.TAILLE_MAX / 4096) + 20; i += 1) console.log(pave);

  const presents = fs.readdirSync(path.dirname(fichier)).sort();
  assert.deepEqual(presents, ['clora.1.log', 'clora.2.log', 'clora.log']);
  for (const nom of presents) {
    assert.ok(fs.statSync(path.join(path.dirname(fichier), nom)).size <= journal.TAILLE_MAX + 8192, `${nom} reste borné`);
  }
});

test('un dossier de journal inaccessible ne fait pas tomber l\'application', (t) => {
  const journal = journalNeuf(t);
  const dir = dossier(t);
  // Un fichier là où le dossier « journaux » devrait naître.
  fs.writeFileSync(path.join(dir, 'journaux'), 'obstacle');

  assert.equal(journal.installer(dir), null);
  assert.doesNotThrow(() => console.error('rien ne doit lever'));
  assert.deepEqual(journal.dernieresLignes(), []);
});

async function avecAdmin(t) {
  resetRateLimit();
  const api = await startTestServer();
  t.after(() => api.close());
  const res = await api.post('/api/auth/setup', { username: 'patron', password: MOT_DE_PASSE });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return api;
}

/** Télécharge le rapport tel quel : ce n'est pas du JSON. */
async function telecharger(api) {
  const res = await fetch(`${api.base}/api/diagnostic`, { headers: { Cookie: api.cookie() } });
  return { status: res.status, type: res.headers.get('content-type'), disposition: res.headers.get('content-disposition'), texte: await res.text() };
}

test('le diagnostic décrit l\'installation sans rien livrer de la comptabilité', async (t) => {
  const api = await avecAdmin(t);
  const clientId = await insertClient(api.db, { nom: 'Boulangerie Secrète', email: 'confidentiel@exemple.ca' });
  await api.post('/api/factures', {
    client_id: clientId, date_emission: '2026-11-10', date_echeance: '2026-12-10',
    lignes: [{ description: 'Prestation confidentielle', quantite: 1, prix_unitaire: 98765 }]
  });
  await api.put('/api/settings', {
    entreprise_nom: 'Entreprise Test', smtp_host: 'smtp.exemple.ca', smtp_user: 'moi@exemple.ca', smtp_pass: 'mot-de-passe-smtp'
  });

  const rapport = await telecharger(api);
  assert.equal(rapport.status, 200);
  assert.match(rapport.type, /text\/plain/);
  assert.match(rapport.disposition, /attachment; filename="clora-diagnostic-\d{4}-\d{2}-\d{2}\.txt"/);

  assert.match(rapport.texte, /Version : \d+\.\d+\.\d+/);
  assert.match(rapport.texte, /Lignes dans clients : 1/);
  assert.match(rapport.texte, /Lignes dans factures : 1/);
  assert.match(rapport.texte, /Intégrité : ok/);
  assert.match(rapport.texte, /Courriel configuré : oui/);
  assert.match(rapport.texte, /== Sauvegardes ==/);

  for (const interdit of ['Boulangerie Secrète', 'confidentiel@exemple.ca', 'Prestation confidentielle', '98765', 'mot-de-passe-smtp', 'moi@exemple.ca', MOT_DE_PASSE]) {
    assert.ok(!rapport.texte.includes(interdit), `« ${interdit} » ne doit pas figurer au rapport`);
  }
});

test('le diagnostic est réservé à l\'administrateur', async (t) => {
  const api = await avecAdmin(t);
  await api.post('/api/users', { username: 'employe1', password: MOT_DE_PASSE, role: 'employe' });
  await api.post('/api/auth/login', { username: 'employe1', password: MOT_DE_PASSE });
  assert.equal((await telecharger(api)).status, 403);

  api.clearCookie();
  assert.equal((await telecharger(api)).status, 401);
});

test('des sauvegardes restées à côté des données sont signalées, jusqu\'à leur déplacement', async (t) => {
  const { createTestDb } = require('./helpers.js');
  const { etatDesSauvegardes, dossierParDefaut } = require('../backupService.js');
  const db = await createTestDb();
  t.after(() => db.__cleanup());
  const ailleurs = dossier(t);

  // Réglage d'origine : le dossier de données lui-même.
  assert.equal((await etatDesSauvegardes(db)).sur_place, true);

  // Le chemin par défaut écrit en toutes lettres ne trompe pas le contrôle.
  await db.run('UPDATE settings SET sauvegarde_dossier = ?', [dossierParDefaut()]);
  assert.equal((await etatDesSauvegardes(db)).sur_place, true);

  await db.run('UPDATE settings SET sauvegarde_dossier = ?', [ailleurs]);
  assert.equal((await etatDesSauvegardes(db)).sur_place, false);

  // Sauvegardes coupées : il n'y a rien à rappeler.
  await db.run('UPDATE settings SET sauvegarde_dossier = NULL, sauvegarde_active = 0');
  assert.equal((await etatDesSauvegardes(db)).sur_place, false);
});
