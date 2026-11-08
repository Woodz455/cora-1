/**
 * Chiffrement des sauvegardes.
 *
 * Une sauvegarde chiffrée qu'on ne sait pas rouvrir est pire qu'une sauvegarde
 * en clair : ces tests vérifient donc l'aller-retour complet, sur le même poste
 * et sur un « autre ordinateur », autant que la protection elle-même.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const { createTestDb, insertClient, startTestServer, MOT_DE_PASSE } = require('./helpers.js');
const { reset: resetRateLimit } = require('../rateLimit.js');
const { chiffrer, dechiffrer, estChiffre, empreinteDe, lireEnteteFichier } = require('../chiffrementSauvegardes.js');
const { genererCle, normaliserCle, formater } = require('../codesSecours.js');
const {
  creerSauvegarde, listerSauvegardes, sauvegardeSiNecessaire, rechiffrerSerie, enregistrerCle,
  identifiantDuDossier, serieDe, etatDesSauvegardes, INTERVALLE_MS
} = require('../backupService.js');
const { principal: dechiffrerEnLigneDeCommande } = require('../scripts/dechiffrer-sauvegarde.js');

/** Un nom qu'on ne doit jamais retrouver en clair dans une copie chiffrée. */
const SIGNE = 'Quincaillerie Reconnaissable';

function dossierTemporaire(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clora-chiffre-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function prepare(t) {
  const db = await createTestDb();
  t.after(() => db.__cleanup());
  await insertClient(db, { nom: SIGNE });
  return { db, dossier: dossierTemporaire(t) };
}

/** Ouvre le contenu d'une base posée en mémoire, le temps d'une lecture. */
async function clientsDe(contenu, t) {
  const fichier = path.join(dossierTemporaire(t), 'lecture.sqlite');
  fs.writeFileSync(fichier, contenu);
  const base = await open({ filename: fichier, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY });
  try {
    return (await base.all('SELECT nom_entreprise FROM clients ORDER BY id')).map((c) => c.nom_entreprise);
  } finally {
    await base.close();
  }
}

/* --- Les codes --- */

test('une clé générée a 24 caractères lisibles, et se ressaisit avec indulgence', () => {
  const cle = genererCle();
  assert.match(cle, /^[0-9A-HJKMNP-TV-Z]{24}$/);
  assert.notEqual(cle, genererCle());
  assert.match(formater(cle), /^([0-9A-Z]{4}-){5}[0-9A-Z]{4}$/);

  // Casse, espaces, tirets indifférents ; O se lit 0, I et L se lisent 1.
  const brute = '0123456789ABCDEFGHJK1MNP';
  assert.equal(normaliserCle('o123-4567 89ab-cdef ghjk-lmnp'), brute);
  assert.equal(normaliserCle('ABCD'), null, 'trop courte');
  assert.equal(normaliserCle('UUUU-UUUU-UUUU-UUUU-UUUU-UUUU'), null, 'U n\'existe pas dans l\'alphabet');
});

/* --- Le format --- */

test('le chiffrement fait l\'aller-retour, et détecte toute altération', () => {
  const cle = genererCle();
  const clair = Buffer.from('comptabilité de démonstration');
  const chiffre = chiffrer(clair, cle, { serie: 'abc' });

  assert.ok(estChiffre(chiffre));
  assert.ok(!chiffre.includes(clair), 'le contenu ne doit pas apparaître en clair');
  assert.deepEqual(dechiffrer(chiffre, cle), clair);

  const donnees = Buffer.from(chiffre);
  donnees[donnees.length - 20] ^= 1;
  assert.throws(() => dechiffrer(donnees, cle), (e) => e.code === 'fichier_altere');

  // L'en-tête est authentifié lui aussi : changer la série se voit.
  const entete = Buffer.from(chiffre.toString('latin1').replace('"serie":"abc"', '"serie":"abd"'), 'latin1');
  assert.throws(() => dechiffrer(entete, cle), (e) => e.code === 'fichier_altere');

  assert.throws(() => dechiffrer(chiffre, genererCle()), (e) => e.code === 'cle_incorrecte');
});

/* --- Les sauvegardes --- */

test('un dossier protégé ne dépose que des copies chiffrées, qui se rouvrent avec la clé', async (t) => {
  const { db, dossier } = await prepare(t);
  const cle = genererCle();
  await enregistrerCle(db, cle);

  const { nom, chemin } = await creerSauvegarde(db, { dossier });

  assert.ok(nom.endsWith('.clora'), nom);
  assert.deepEqual(fs.readdirSync(dossier), [nom], 'rien en clair, rien à moitié écrit');
  const contenu = fs.readFileSync(chemin);
  assert.ok(!contenu.includes(Buffer.from(SIGNE)), 'le nom du client ne doit pas apparaître en clair');
  assert.equal(lireEnteteFichier(chemin).empreinte, empreinteDe(cle));
  assert.deepEqual(await clientsDe(dechiffrer(contenu, cle), t), [SIGNE]);
  assert.equal(listerSauvegardes(dossier)[0].chiffree, true);
});

test('une clé devenue illisible suspend les sauvegardes, sans jamais les faire en clair', async (t) => {
  const { db, dossier } = await prepare(t);
  await enregistrerCle(db, genererCle());
  // Ce que laisse un coffre que ce poste ne sait plus ouvrir.
  await db.run("UPDATE settings SET sauvegarde_cle = 'coffre:illisible', sauvegarde_dossier = ?", [dossier]);

  const resultat = await sauvegardeSiNecessaire(db);
  assert.equal(resultat.effectuee, false);
  assert.equal(resultat.raison, 'cle');
  assert.deepEqual(fs.readdirSync(dossier), []);
  assert.equal((await etatDesSauvegardes(db)).alerte, 'cle_illisible');
});

test('les copies en clair sont chiffrées à l\'activation, et rechiffrées quand la clé change', async (t) => {
  const { db, dossier } = await prepare(t);
  const serie = serieDe(await identifiantDuDossier(db));
  await creerSauvegarde(db, { dossier });
  await creerSauvegarde(db, { dossier });

  const premiere = genererCle();
  await enregistrerCle(db, premiere);
  assert.deepEqual(rechiffrerSerie(dossier, serie, { nouvelle: premiere }), { rechiffrees: 2, laissees: 0 });
  assert.ok(listerSauvegardes(dossier).every((s) => s.chiffree), 'plus aucune copie en clair');

  const seconde = genererCle();
  assert.deepEqual(rechiffrerSerie(dossier, serie, { ancienne: premiere, nouvelle: seconde }), { rechiffrees: 2, laissees: 0 });
  for (const s of listerSauvegardes(dossier)) {
    assert.deepEqual(await clientsDe(dechiffrer(fs.readFileSync(s.chemin), seconde), t), [SIGNE]);
  }
});

test('l\'alerte signale une sauvegarde trop ancienne, ou aucune passé le premier jour', async (t) => {
  const { db, dossier } = await prepare(t);
  await db.run('UPDATE settings SET sauvegarde_dossier = ?', [dossier]);

  assert.equal((await etatDesSauvegardes(db, { creeLe: '2026-01-01 00:00:00' })).alerte, 'aucune');
  const ilYAUneHeure = new Date(Date.now() - 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  assert.equal((await etatDesSauvegardes(db, { creeLe: ilYAUneHeure })).alerte, null, 'un dossier neuf a un jour de grâce');

  await creerSauvegarde(db, { dossier });
  assert.equal((await etatDesSauvegardes(db)).alerte, null);
  const dansQuatreJours = new Date(Date.now() + 4 * INTERVALLE_MS);
  assert.equal((await etatDesSauvegardes(db, { maintenant: dansQuatreJours })).alerte, 'en_retard');
});

test('l\'outil de dépannage déchiffre une sauvegarde sans Clora', async (t) => {
  const { db, dossier } = await prepare(t);
  const cle = genererCle();
  await enregistrerCle(db, cle);
  const { chemin } = await creerSauvegarde(db, { dossier });
  const sortie = path.join(dossier, 'recuperee.sqlite');

  const erreurs = [];
  t.mock.method(console, 'error', (...m) => erreurs.push(m.join(' ')));
  t.mock.method(console, 'log', () => {});
  assert.equal(dechiffrerEnLigneDeCommande([chemin, genererCle(), sortie]), 1, 'une autre clé échoue');
  assert.equal(dechiffrerEnLigneDeCommande([chemin, formater(cle).toLowerCase(), sortie]), 0);
  assert.deepEqual(await clientsDe(fs.readFileSync(sortie), t), [SIGNE]);
});

/* --- Les routes --- */

async function avecAdmin(t) {
  resetRateLimit();
  const api = await startTestServer();
  t.after(() => api.close());
  const res = await api.post('/api/auth/setup', { username: 'patron', password: MOT_DE_PASSE });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const dossier = dossierTemporaire(t);
  await api.db.run('UPDATE settings SET sauvegarde_dossier = ?', [dossier]);
  await insertClient(api.db, { nom: SIGNE });
  return { api, dossier };
}

async function proteger(api) {
  const { cle } = (await api.post('/api/sauvegardes/cle/generer', {})).data;
  const res = await api.post('/api/sauvegardes/cle', { cle, confirmation: cle });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return cle;
}

test('activer la protection exige de recopier la clé, et chiffre les copies déjà faites', async (t) => {
  const { api, dossier } = await avecAdmin(t);
  await api.post('/api/sauvegardes');
  assert.equal((await api.get('/api/sauvegardes')).data.protection.active, false);

  const { cle } = (await api.post('/api/sauvegardes/cle/generer', {})).data;
  const autre = formater(genererCle());
  assert.equal((await api.post('/api/sauvegardes/cle', { cle, confirmation: autre })).status, 400);
  assert.equal((await api.post('/api/sauvegardes/cle', { cle: 'trop-courte', confirmation: 'trop-courte' })).status, 400);

  const res = await api.post('/api/sauvegardes/cle', { cle, confirmation: cle.toLowerCase().replace(/-/g, ' ') });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.rechiffrees, 1);

  const liste = (await api.get('/api/sauvegardes')).data;
  assert.equal(liste.protection.active, true);
  assert.equal(liste.protection.lisible, true);
  assert.ok(liste.sauvegardes.every((s) => s.chiffree));
  assert.ok(fs.readdirSync(dossier).every((f) => f.endsWith('.clora')));

  // La clé ne sort jamais par les paramètres ni par la liste.
  const tout = JSON.stringify([(await api.get('/api/settings')).data, liste]);
  assert.ok(!tout.includes(normaliserCle(cle)) && !tout.includes(cle));
  assert.ok(!('sauvegarde_cle' in (await api.get('/api/settings')).data));

  const trace = await api.db.get("SELECT details FROM logs_audit WHERE action = 'sauvegarde.protection'");
  assert.ok(trace && !trace.details.includes(normaliserCle(cle)), 'la clé ne doit pas entrer au journal');
});

test('afficher ou remplacer la clé demande le mot de passe', async (t) => {
  const { api } = await avecAdmin(t);
  const cle = await proteger(api);
  await api.post('/api/sauvegardes');

  assert.equal((await api.post('/api/sauvegardes/cle/afficher', { motDePasse: 'mauvais' })).status, 401);
  const vue = await api.post('/api/sauvegardes/cle/afficher', { motDePasse: MOT_DE_PASSE });
  assert.equal(vue.data.cle, cle);

  const nouvelle = formater(genererCle());
  assert.equal((await api.post('/api/sauvegardes/cle', { cle: nouvelle, confirmation: nouvelle })).status, 401);
  const res = await api.post('/api/sauvegardes/cle', { cle: nouvelle, confirmation: nouvelle, motDePasse: MOT_DE_PASSE });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.rechiffrees, 1);

  // Les copies existantes s'ouvrent avec la nouvelle clé, sans rien saisir.
  const { nom } = (await api.get('/api/sauvegardes')).data.sauvegardes[0];
  const examen = await api.post('/api/sauvegardes/examiner', { nom });
  assert.equal(examen.status, 200, JSON.stringify(examen.data));
  assert.equal(examen.data.chiffree, true);
});

test('sur un autre ordinateur, la restauration demande la clé et la reprend pour la suite', async (t) => {
  const { api } = await avecAdmin(t);
  const cle = await proteger(api);
  const { nom } = (await api.post('/api/sauvegardes')).data;

  // Un poste neuf : la base ne porte aucune clé.
  await api.db.run('UPDATE settings SET sauvegarde_cle = NULL, sauvegarde_cle_empreinte = NULL');

  const sansCle = await api.post('/api/sauvegardes/examiner', { nom });
  assert.equal(sansCle.status, 409);
  assert.match(sansCle.data.error, /saisissez la clé/);
  const mauvaise = await api.post('/api/sauvegardes/examiner', { nom, cle: formater(genererCle()) });
  assert.equal(mauvaise.status, 409);
  assert.match(mauvaise.data.error, /ne correspond pas/);

  const examen = await api.post('/api/sauvegardes/examiner', { nom, cle });
  assert.equal(examen.status, 200, JSON.stringify(examen.data));
  assert.equal(examen.data.clients, 1);

  assert.equal((await api.post('/api/sauvegardes/restaurer', { nom })).status, 409);
  const res = await api.post('/api/sauvegardes/restaurer', { nom, cle });
  assert.equal(res.status, 200, JSON.stringify(res.data));

  // La base préparée porte la clé : les sauvegardes suivantes restent chiffrées.
  const preparee = await open({
    filename: `${api.db.__dbPath}.restauration`, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY
  });
  t.after(() => preparee.close());
  const reglages = await preparee.get('SELECT sauvegarde_cle, sauvegarde_cle_empreinte FROM settings LIMIT 1');
  assert.equal(reglages.sauvegarde_cle_empreinte, empreinteDe(normaliserCle(cle)));
  assert.ok(reglages.sauvegarde_cle, 'la clé saisie doit être reprise');
});

test('une clé devenue illisible se ressaisit, et les sauvegardes reprennent', async (t) => {
  const { api } = await avecAdmin(t);
  const cle = await proteger(api);
  await api.db.run("UPDATE settings SET sauvegarde_cle = 'coffre:illisible'");

  assert.equal((await api.get('/api/sauvegardes/etat')).data.alerte, 'cle_illisible');
  assert.equal((await api.post('/api/sauvegardes')).status, 409);
  assert.equal((await api.post('/api/sauvegardes/cle/afficher', { motDePasse: MOT_DE_PASSE })).status, 409);

  assert.equal((await api.post('/api/sauvegardes/cle/ressaisir', { cle: formater(genererCle()) })).status, 400);
  assert.equal((await api.post('/api/sauvegardes/cle/ressaisir', { cle })).status, 200);
  assert.equal((await api.post('/api/sauvegardes')).status, 201);
  assert.equal((await api.get('/api/sauvegardes/etat')).data.alerte, null);
});

test('les routes de la clé sont réservées à l\'administrateur', async (t) => {
  const { api } = await avecAdmin(t);
  await api.post('/api/users', { username: 'compta', password: MOT_DE_PASSE, role: 'comptable' });
  await api.post('/api/auth/login', { username: 'compta', password: MOT_DE_PASSE });

  for (const route of ['/api/sauvegardes/cle/generer', '/api/sauvegardes/cle', '/api/sauvegardes/cle/afficher',
    '/api/sauvegardes/cle/ressaisir']) {
    assert.equal((await api.post(route, {})).status, 403, route);
  }
  assert.equal((await api.get('/api/sauvegardes/etat')).status, 403);
});
