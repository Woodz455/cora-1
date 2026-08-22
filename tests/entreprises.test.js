/**
 * Multi-dossier : cloisonnement, rôles par dossier, migration.
 *
 * Le premier test de ce fichier est celui qui justifie toute l'architecture.
 * Un dossier par fichier a été retenu contre une colonne `entreprise_id`
 * précisément parce qu'un `WHERE` oublié sur 81 requêtes aurait montré les
 * factures d'un client à un autre. Il faut donc le prouver, pas l'affirmer.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { startTestServer, MOT_DE_PASSE } = require('./helpers.js');
const { reset: resetRateLimit } = require('../rateLimit.js');
const { ouvrirComptes, migrerSiNecessaire, fermerTout } = require('../companyStore.js');
const { initDb } = require('../database.js');

/** Serveur avec un administrateur connecté sur le dossier initial. */
async function withAdmin(t) {
  resetRateLimit();
  const api = await startTestServer();
  t.after(async () => { await api.close(); });

  const res = await api.post('/api/auth/setup', { username: 'patron', password: MOT_DE_PASSE });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return api;
}

/** Crée un client dans le dossier ouvert et renvoie son identifiant. */
async function creerClient(api, nom) {
  const res = await api.post('/api/clients', {
    nom_entreprise: nom,
    email: `${nom.replace(/\W/g, '').toLowerCase()}@exemple.ca`,
    province: 'QC'
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data.client;
}

// --- Le cloisonnement ---------------------------------------------------------

test('aucune donnée ne franchit la frontière entre deux dossiers', async (t) => {
  const api = await withAdmin(t);

  await creerClient(api, 'Plomberie Tremblay');

  const second = await api.post('/api/entreprises', { nom: 'Boulangerie Côté' });
  assert.equal(second.status, 201, JSON.stringify(second.data));
  // La création ouvre le dossier neuf : la session pointe désormais dessus.

  const vus = await api.get('/api/clients');
  assert.equal(vus.status, 200, JSON.stringify(vus.data));
  const liste = Array.isArray(vus.data) ? vus.data : vus.data.clients || [];
  assert.equal(liste.length, 0, 'un dossier neuf ne doit contenir aucun client');

  await creerClient(api, 'Dépanneur Roy');

  const apresSecond = await api.get('/api/clients');
  const listeSeconde = Array.isArray(apresSecond.data) ? apresSecond.data : apresSecond.data.clients || [];
  assert.equal(listeSeconde.length, 1);
  assert.equal(listeSeconde[0].nom_entreprise, 'Dépanneur Roy');

  // Retour au premier dossier : il n'a pas vu passer le client du second.
  const dossiers = await api.get('/api/entreprises');
  const premier = dossiers.data.entreprises.find((e) => e.nom === 'Entreprise Test');
  await api.post(`/api/entreprises/${premier.id}/ouvrir`, {});

  const retour = await api.get('/api/clients');
  const listeRetour = Array.isArray(retour.data) ? retour.data : retour.data.clients || [];
  assert.equal(listeRetour.length, 1);
  assert.equal(listeRetour[0].nom_entreprise, 'Plomberie Tremblay');
});

test('chaque dossier numérote ses factures pour lui seul', async (t) => {
  const api = await withAdmin(t);

  const clientA = await creerClient(api, 'Client A');
  const ligne = [{ description: 'Travaux', quantite: 1, prix_unitaire: 100 }];

  const facture = { date_emission: '2026-08-01', lignes: ligne };
  const facA = await api.post('/api/factures', { client_id: clientA.id, ...facture });
  assert.equal(facA.status, 201, JSON.stringify(facA.data));

  await api.post('/api/entreprises', { nom: 'Second Dossier' });
  const clientB = await creerClient(api, 'Client B');
  const facB = await api.post('/api/factures', { client_id: clientB.id, ...facture });
  assert.equal(facB.status, 201, JSON.stringify(facB.data));

  // Deux dossiers doivent pouvoir émettre chacun leur première facture : une
  // séquence commune ferait sauter un numéro chez l'un des deux, et un numéro
  // manquant dans une suite de factures est un problème pour le comptable.
  const numeroA = facA.data.facture.numero_facture;
  const numeroB = facB.data.facture.numero_facture;
  assert.match(numeroA, /-0001$/, `premier dossier : ${numeroA}`);
  assert.match(numeroB, /-0001$/, `second dossier : ${numeroB}`);
});

// --- Les rôles, propres à chaque dossier -------------------------------------

test('un rôle vaut pour un dossier, pas pour les autres', async (t) => {
  const api = await withAdmin(t);

  const creation = await api.post('/api/users', {
    username: 'employe', password: MOT_DE_PASSE, role: 'employe'
  });
  assert.equal(creation.status, 201, JSON.stringify(creation.data));

  // L'employé n'a d'accès que sur le dossier initial ; l'administrateur en crée
  // un second, où l'employé n'existe pas.
  const second = await api.post('/api/entreprises', { nom: 'Dossier Réservé' });
  const membres = await api.get('/api/users');
  assert.equal(membres.data.length, 1, 'un dossier neuf ne doit compter que son créateur');

  api.clearCookie();
  const connexion = await api.post('/api/auth/login', { username: 'employe', password: MOT_DE_PASSE });
  assert.equal(connexion.status, 200, JSON.stringify(connexion.data));
  assert.equal(connexion.data.ouvert.role, 'employe');

  const tentative = await api.post(`/api/entreprises/${second.data.entreprise.id}/ouvrir`, {});
  assert.equal(tentative.status, 404, 'un dossier sans accès ne doit pas être ouvrable');
});

test('retirer un accès prend effet sans attendre l\'expiration de la session', async (t) => {
  const api = await withAdmin(t);

  const employe = await api.post('/api/users', {
    username: 'temporaire', password: MOT_DE_PASSE, role: 'comptable'
  });

  api.clearCookie();
  await api.post('/api/auth/login', { username: 'temporaire', password: MOT_DE_PASSE });
  const avant = await api.get('/api/clients');
  assert.equal(avant.status, 200);

  // L'administrateur retire l'accès pendant que la session du comptable court.
  const cookieComptable = api.cookie();
  api.clearCookie();
  await api.post('/api/auth/login', { username: 'patron', password: MOT_DE_PASSE });
  const retrait = await api.del(`/api/users/${employe.data.id}`);
  assert.equal(retrait.status, 200, JSON.stringify(retrait.data));

  // Le rôle est relu à chaque requête : le jeton encore valide ne suffit plus.
  api.setCookie(cookieComptable);
  const apres = await api.get('/api/clients');
  assert.equal(apres.status, 403, JSON.stringify(apres.data));
});

test('le dernier administrateur d\'un dossier ne peut pas être retiré', async (t) => {
  const api = await withAdmin(t);

  const moi = await api.get('/api/users');
  const patron = moi.data.find((u) => u.username === 'patron');

  const res = await api.del(`/api/users/${patron.id}`);
  assert.equal(res.status, 400, JSON.stringify(res.data));
});

// --- Sans dossier ouvert ------------------------------------------------------

test('une requête métier sans dossier ouvert est refusée clairement', async (t) => {
  const api = await withAdmin(t);
  await api.post('/api/entreprises', { nom: 'Deuxième' });

  // Deux dossiers accessibles : la reconnexion n'en choisit plus aucun.
  api.clearCookie();
  const connexion = await api.post('/api/auth/login', { username: 'patron', password: MOT_DE_PASSE });
  assert.equal(connexion.data.ouvert, null, 'avec deux dossiers, aucun ne doit s\'ouvrir seul');

  const res = await api.get('/api/clients');
  assert.equal(res.status, 409, JSON.stringify(res.data));
  assert.match(res.data.error, /dossier/i);

  // La liste des dossiers, elle, doit répondre : c'est par elle qu'on en sort.
  const dossiers = await api.get('/api/entreprises');
  assert.equal(dossiers.status, 200);
  assert.equal(dossiers.data.entreprises.length, 2);
});

// --- La migration d'une installation existante --------------------------------

test('une base mono-entreprise devient le premier dossier, sans rien perdre', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clora-migration-'));
  t.after(async () => {
    await fermerTout();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // Une base telle que la produisaient les versions mono-entreprise.
  const cheminBase = path.join(dir, 'database.sqlite');
  const ancienne = await initDb(cheminBase);
  // `initDb` dépose déjà une ligne de paramètres : on la renseigne plutôt que
  // d'en ajouter une seconde, comme le ferait l'écran des paramètres.
  await ancienne.run("UPDATE settings SET entreprise_nom = 'Plomberie Tremblay'");
  await ancienne.run("INSERT INTO users (username, password, role) VALUES ('patron', 'empreinte', 'admin')");
  await ancienne.run("INSERT INTO users (username, password, role) VALUES ('julie', 'empreinte2', 'comptable')");
  await ancienne.close();

  const comptes = await ouvrirComptes(path.join(dir, 'comptes.sqlite'));
  t.after(async () => { await comptes.close(); });

  const resultat = await migrerSiNecessaire(comptes, cheminBase);
  assert.equal(resultat.migre, true);
  assert.equal(resultat.comptes, 2);
  assert.equal(resultat.entreprise.nom, 'Plomberie Tremblay');

  // Le fichier reste où il était : un chemin cassé sur une comptabilité serait
  // pire que le confort d'une arborescence rangée.
  assert.equal(resultat.entreprise.chemin, cheminBase);
  assert.ok(fs.existsSync(cheminBase));

  // Les rôles sont conservés, dossier par dossier.
  const roles = await comptes.all(
    `SELECT u.username, a.role FROM users u JOIN acces a ON a.user_id = u.id ORDER BY u.username`
  );
  assert.deepEqual(roles, [
    { username: 'julie', role: 'comptable' },
    { username: 'patron', role: 'admin' }
  ]);

  // La table d'origine est intacte : réinstaller la version précédente doit
  // redonner une application qui fonctionne.
  const relue = await initDb(cheminBase);
  const restes = await relue.all('SELECT username FROM users ORDER BY username');
  await relue.close();
  assert.deepEqual(restes.map((u) => u.username), ['julie', 'patron']);
});

test('la migration ne se rejoue pas sur un registre déjà peuplé', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clora-migration-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const cheminBase = path.join(dir, 'database.sqlite');
  const base = await initDb(cheminBase);
  await base.run("UPDATE settings SET entreprise_nom = 'Une fois'");
  await base.close();

  const comptes = await ouvrirComptes(path.join(dir, 'comptes.sqlite'));
  t.after(async () => { await comptes.close(); await fermerTout(); });

  assert.equal((await migrerSiNecessaire(comptes, cheminBase)).migre, true);
  assert.equal((await migrerSiNecessaire(comptes, cheminBase)).migre, false);

  const { count } = await comptes.get('SELECT COUNT(*) AS count FROM entreprises');
  assert.equal(count, 1);
});
