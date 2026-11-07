/**
 * Sauvegardes automatiques et restauration.
 *
 * Une sauvegarde qu'on n'a jamais essayé de relire n'est pas une sauvegarde :
 * ces tests vérifient donc l'aller-retour complet, pas seulement l'existence du
 * fichier produit.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const { createTestDb, insertClient, startTestServer, MOT_DE_PASSE } = require('./helpers.js');
const { reset: resetRateLimit } = require('../rateLimit.js');
const {
  creerSauvegarde,
  listerSauvegardes,
  appliquerRetention,
  sauvegardeSiNecessaire,
  verifierSauvegarde,
  demanderRestauration,
  appliquerRestaurationEnAttente,
  identifiantDuDossier,
  serieDe,
  horodatage,
  dateDuNom,
  analyserNom,
  INTERVALLE_MS,
  MARQUEUR,
  SUFFIXE_PREPARATION
} = require('../backupService.js');

/** Dossier jetable, nettoyé à la fin du test. */
function dossierTemporaire(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clora-sauv-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function prepare(t) {
  const db = await createTestDb();
  t.after(() => db.__cleanup());
  return { db, dossier: dossierTemporaire(t) };
}

/** Ouvre une sauvegarde en lecture seule. */
async function ouvrir(chemin) {
  return open({ filename: chemin, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY });
}

test('la sauvegarde contient les mêmes données que la base', async (t) => {
  const { db, dossier } = await prepare(t);
  await insertClient(db, { nom: 'Ateliers Bélanger; Cie' });
  await insertClient(db, { nom: 'Deuxième client' });

  const { chemin } = await creerSauvegarde(db, { dossier });

  const copie = await ouvrir(chemin);
  t.after(() => copie.close());

  const { c } = await copie.get('SELECT COUNT(*) AS c FROM clients');
  assert.equal(c, 2);

  // L'accentuation et le point-virgule ne doivent pas être altérés par la copie.
  const client = await copie.get('SELECT nom_entreprise FROM clients ORDER BY id LIMIT 1');
  assert.equal(client.nom_entreprise, 'Ateliers Bélanger; Cie');
});

test('une sauvegarde prise pendant des écritures reste cohérente', async (t) => {
  const { db, dossier } = await prepare(t);

  // Écritures lancées sans être attendues : la sauvegarde part au milieu.
  const ecritures = Promise.all(
    Array.from({ length: 40 }, (_, i) => insertClient(db, { nom: `Client ${i}` }))
  );
  const { chemin } = await creerSauvegarde(db, { dossier });
  await ecritures;

  await assert.doesNotReject(() => verifierSauvegarde(chemin));

  const copie = await ouvrir(chemin);
  t.after(() => copie.close());

  // Le nombre exact dépend de l'entrelacement ; ce qui compte est qu'aucune
  // ligne ne soit tronquée et que la base reste lisible.
  const { c } = await copie.get('SELECT COUNT(*) AS c FROM clients');
  assert.ok(c >= 0 && c <= 40, `nombre de clients inattendu : ${c}`);
});

test('deux sauvegardes rapprochées coexistent sans s\'écraser', async (t) => {
  const { db, dossier } = await prepare(t);
  await insertClient(db, { nom: 'Présent dès la première' });

  const premiere = await creerSauvegarde(db, { dossier });
  await insertClient(db, { nom: 'Ajouté entre les deux' });
  const seconde = await creerSauvegarde(db, { dossier });

  // Un horodatage à la seconde près donnait le même nom aux deux, et la
  // seconde effaçait la première : on perdait une sauvegarde en croyant en
  // gagner une.
  assert.notEqual(premiere.nom, seconde.nom);
  assert.equal(listerSauvegardes(dossier).length, 2);

  const ancienne = await ouvrir(premiere.chemin);
  t.after(() => ancienne.close());
  assert.equal((await ancienne.get('SELECT COUNT(*) AS c FROM clients')).c, 1);

  const recente = await ouvrir(seconde.chemin);
  t.after(() => recente.close());
  assert.equal((await recente.get('SELECT COUNT(*) AS c FROM clients')).c, 2);
});

/** Série factice, pour des sauvegardes écrites à la main. */
const SERIE = '0123456789ab';

test('la rétention ne garde que les plus récentes', async (t) => {
  const { dossier } = await prepare(t);

  // Six sauvegardes factices, horodatées de la plus ancienne à la plus récente.
  const noms = [];
  for (let i = 0; i < 6; i += 1) {
    const date = new Date(Date.UTC(2026, 0, 1 + i, 3, 0, 0));
    const nom = `clora-${SERIE}-${horodatage(date)}.sqlite`;
    fs.writeFileSync(path.join(dossier, nom), 'factice');
    noms.push(nom);
  }

  const supprimes = appliquerRetention(dossier, 3, SERIE);

  assert.equal(supprimes.length, 3);
  const restantes = listerSauvegardes(dossier).map((s) => s.nom);
  assert.deepEqual(restantes, [noms[5], noms[4], noms[3]]);
});

test('un fichier étranger au dossier est ignoré, jamais supprimé', async (t) => {
  const { dossier } = await prepare(t);
  fs.writeFileSync(path.join(dossier, 'notes-personnelles.txt'), 'à conserver');
  fs.writeFileSync(path.join(dossier, `clora-${SERIE}-${horodatage()}.sqlite`), 'factice');

  appliquerRetention(dossier, 0, SERIE);

  assert.ok(fs.existsSync(path.join(dossier, 'notes-personnelles.txt')));
  assert.equal(listerSauvegardes(dossier).length, 0);
});

test('la rétention exige de savoir quelle série elle taille', async (t) => {
  const { dossier } = await prepare(t);
  fs.writeFileSync(path.join(dossier, `clora-${horodatage()}.sqlite`), 'factice');

  // Sans série, elle ne supprime rien plutôt que tout.
  assert.throws(() => appliquerRetention(dossier, 0), /série/);
  assert.equal(listerSauvegardes(dossier).length, 1);
});

test('le nom d\'une sauvegarde porte la série de son dossier', async (t) => {
  const { db, dossier } = await prepare(t);
  const uid = await identifiantDuDossier(db);

  const { nom } = await creerSauvegarde(db, { dossier });

  assert.ok(nom.startsWith(`clora-${serieDe(uid)}-`), nom);
  assert.equal(listerSauvegardes(dossier)[0].serie, serieDe(uid));
});

test('la sauvegarde périodique respecte le délai de 24 h', async (t) => {
  const { db, dossier } = await prepare(t);
  await db.run('UPDATE settings SET sauvegarde_dossier = ?, sauvegarde_active = 1', [dossier]);

  const premiere = await sauvegardeSiNecessaire(db);
  assert.equal(premiere.effectuee, true);

  // Immédiatement après, aucune raison d'en refaire une.
  const suivante = await sauvegardeSiNecessaire(db);
  assert.equal(suivante.effectuee, false);
  assert.equal(suivante.raison, 'recente');

  // Une journée plus tard, si.
  const demain = new Date(Date.now() + INTERVALLE_MS + 1000);
  const apres = await sauvegardeSiNecessaire(db, demain);
  assert.equal(apres.effectuee, true);
});

test('le réglage désactivé empêche toute sauvegarde', async (t) => {
  const { db, dossier } = await prepare(t);
  await db.run('UPDATE settings SET sauvegarde_dossier = ?, sauvegarde_active = 0', [dossier]);

  const resultat = await sauvegardeSiNecessaire(db);

  assert.equal(resultat.effectuee, false);
  assert.equal(resultat.raison, 'desactivee');
  assert.equal(listerSauvegardes(dossier).length, 0);
});

test('un dossier inaccessible ne fait pas tomber le planificateur', async (t) => {
  const { db } = await prepare(t);
  // Un chemin dont le parent est un fichier : la création échouera forcément.
  const fichier = path.join(os.tmpdir(), `clora-obstacle-${Date.now()}`);
  fs.writeFileSync(fichier, 'obstacle');
  t.after(() => fs.rmSync(fichier, { force: true }));

  await db.run('UPDATE settings SET sauvegarde_dossier = ?, sauvegarde_active = 1', [path.join(fichier, 'sous-dossier')]);

  const resultat = await sauvegardeSiNecessaire(db);

  assert.equal(resultat.effectuee, false);
  assert.equal(resultat.raison, 'echec');
});

test('un fichier qui n\'est pas une base Clora est refusé', async (t) => {
  const { dossier } = await prepare(t);
  const bidon = path.join(dossier, 'bidon.sqlite');
  fs.writeFileSync(bidon, 'ceci n\'est pas une base de données');

  await assert.rejects(() => verifierSauvegarde(bidon));
  const cible = path.join(dossier, 'courante.sqlite');
  await assert.rejects(() => demanderRestauration(bidon, cible), /inutilisable/);
  assert.ok(!fs.existsSync(path.join(dossier, MARQUEUR)), 'aucune demande ne doit être déposée');
  assert.ok(!fs.existsSync(`${cible}${SUFFIXE_PREPARATION}`), 'la base préparée doit être retirée');
});

test('une base SQLite valide mais étrangère à Clora est refusée', async (t) => {
  const { dossier } = await prepare(t);
  const etrangere = path.join(dossier, 'autre.sqlite');
  const base = await open({ filename: etrangere, driver: sqlite3.Database });
  await base.exec('CREATE TABLE recettes (id INTEGER PRIMARY KEY)');
  await base.close();

  await assert.rejects(() => verifierSauvegarde(etrangere), /comptabilité Clora/);
});

test('la restauration rend une base identique à la sauvegarde', async (t) => {
  const { db, dossier } = await prepare(t);
  const dataDir = dossierTemporaire(t);
  const dbPath = path.join(dataDir, 'courante.sqlite');

  await insertClient(db, { nom: 'Client présent à la sauvegarde' });
  const { chemin } = await creerSauvegarde(db, { dossier });

  // État « actuel » différent : deux clients, dont un postérieur à la sauvegarde.
  await insertClient(db, { nom: 'Client ajouté après' });
  const { chemin: apres } = await creerSauvegarde(db, { dossier });
  fs.copyFileSync(apres, dbPath);

  await demanderRestauration(chemin, dbPath);
  assert.ok(fs.existsSync(path.join(dataDir, MARQUEUR)), 'le marqueur doit être déposé');

  const resultat = appliquerRestaurationEnAttente(dbPath, dataDir);

  assert.ok(resultat, 'la restauration doit aboutir');
  assert.ok(!fs.existsSync(path.join(dataDir, MARQUEUR)), 'le marqueur doit être consommé');

  const restauree = await ouvrir(dbPath);
  t.after(() => restauree.close());
  const { c } = await restauree.get('SELECT COUNT(*) AS c FROM clients');
  assert.equal(c, 1, 'seul le client présent à la sauvegarde doit subsister');
});

test('la base remplacée est conservée de côté', async (t) => {
  const { db, dossier } = await prepare(t);
  const dataDir = dossierTemporaire(t);
  const dbPath = path.join(dataDir, 'courante.sqlite');

  await insertClient(db, { nom: 'Unique' });
  const { chemin } = await creerSauvegarde(db, { dossier });
  fs.copyFileSync(chemin, dbPath);

  await demanderRestauration(chemin, dbPath);
  const resultat = appliquerRestaurationEnAttente(dbPath, dataDir);

  assert.ok(resultat.sauvegardeDeSecurite, 'un exemplaire de secours doit être écrit');
  assert.ok(fs.existsSync(resultat.sauvegardeDeSecurite));
});

test('le journal WAL de l\'ancienne base est écarté à la restauration', async (t) => {
  const { db, dossier } = await prepare(t);
  const dataDir = dossierTemporaire(t);
  const dbPath = path.join(dataDir, 'courante.sqlite');

  await insertClient(db, { nom: 'Unique' });
  const { chemin } = await creerSauvegarde(db, { dossier });
  fs.copyFileSync(chemin, dbPath);

  // Journal résiduel décrivant des pages de l'ancienne base.
  fs.writeFileSync(`${dbPath}-wal`, 'journal périmé');
  fs.writeFileSync(`${dbPath}-shm`, 'index périmé');

  await demanderRestauration(chemin, dbPath);
  appliquerRestaurationEnAttente(dbPath, dataDir);

  assert.ok(!fs.existsSync(`${dbPath}-wal`), 'le journal périmé doit être supprimé');
  assert.ok(!fs.existsSync(`${dbPath}-shm`), 'l\'index périmé doit être supprimé');
});

test('sans marqueur, le démarrage ne touche à rien', async (t) => {
  const dataDir = dossierTemporaire(t);
  const dbPath = path.join(dataDir, 'courante.sqlite');
  fs.writeFileSync(dbPath, 'contenu intact');

  assert.equal(appliquerRestaurationEnAttente(dbPath, dataDir), null);
  assert.equal(fs.readFileSync(dbPath, 'utf8'), 'contenu intact');
});

test('un marqueur illisible est écarté sans casser le démarrage', async (t) => {
  const dataDir = dossierTemporaire(t);
  const dbPath = path.join(dataDir, 'courante.sqlite');
  fs.writeFileSync(dbPath, 'contenu intact');
  fs.writeFileSync(path.join(dataDir, MARQUEUR), 'ceci n\'est pas du JSON');

  assert.equal(appliquerRestaurationEnAttente(dbPath, dataDir), null);
  assert.equal(fs.readFileSync(dbPath, 'utf8'), 'contenu intact');
  assert.ok(!fs.existsSync(path.join(dataDir, MARQUEUR)), 'le marqueur fautif doit être retiré');
});

test('un marqueur désignant un fichier disparu laisse la base en place', async (t) => {
  const dataDir = dossierTemporaire(t);
  const dbPath = path.join(dataDir, 'courante.sqlite');
  fs.writeFileSync(dbPath, 'contenu intact');
  fs.writeFileSync(
    path.join(dataDir, MARQUEUR),
    JSON.stringify({ cible: dbPath, source: path.join(dataDir, 'envolee.sqlite') })
  );

  assert.equal(appliquerRestaurationEnAttente(dbPath, dataDir), null);
  assert.equal(fs.readFileSync(dbPath, 'utf8'), 'contenu intact');
  assert.ok(!fs.existsSync(path.join(dataDir, MARQUEUR)), 'la demande ne doit pas se rejouer');
});

test('une demande qui désigne une autre base est écartée sans rien toucher', async (t) => {
  const { db, dossier } = await prepare(t);
  const dataDir = dossierTemporaire(t);
  const dbPath = path.join(dataDir, 'courante.sqlite');
  const { chemin } = await creerSauvegarde(db, { dossier });
  fs.writeFileSync(dbPath, 'contenu intact');
  fs.writeFileSync(
    path.join(dataDir, MARQUEUR),
    JSON.stringify({ cible: path.join(dataDir, 'autre.sqlite'), source: chemin })
  );

  assert.equal(appliquerRestaurationEnAttente(dbPath, dataDir), null);
  assert.equal(fs.readFileSync(dbPath, 'utf8'), 'contenu intact');
  assert.ok(!fs.existsSync(path.join(dataDir, MARQUEUR)), 'la demande ne doit pas se rejouer');
});

test('les noms de sauvegarde se trient chronologiquement', () => {
  const noms = [
    `clora-${horodatage(new Date(Date.UTC(2026, 10, 3, 9, 0, 0)))}.sqlite`,
    `clora-${horodatage(new Date(Date.UTC(2026, 1, 3, 9, 0, 0)))}.sqlite`,
    `clora-${horodatage(new Date(Date.UTC(2026, 10, 3, 8, 0, 0)))}.sqlite`
  ];

  // Le tri alphabétique doit coïncider avec le tri par date : c'est ce sur quoi
  // repose l'ordre du listage et donc la rétention.
  const parNom = [...noms].sort();
  const parDate = [...noms].sort((a, b) => dateDuNom(a) - dateDuNom(b));
  assert.deepEqual(parNom, parDate);

  // La nouvelle forme se lit aussi, et sa série en est extraite.
  const date = new Date(Date.UTC(2026, 10, 7, 1, 56, 5, 43));
  const nom = `clora-${SERIE}-${horodatage(date)}.sqlite`;
  assert.deepEqual(analyserNom(nom), { serie: SERIE, date, chiffree: false });
  assert.deepEqual(analyserNom(`clora-${horodatage(date)}.sqlite`), { serie: null, date, chiffree: false });
  assert.deepEqual(analyserNom(nom.replace('.sqlite', '.clora')), { serie: SERIE, date, chiffree: true });
  assert.equal(analyserNom(`${nom}.partiel`), null, 'un dépôt en cours n\'est pas une sauvegarde');
});

/* --- Routes --- */

/** Serveur avec un administrateur connecté. */
async function avecAdmin(t) {
  resetRateLimit();
  const api = await startTestServer();
  t.after(() => api.close());

  const res = await api.post('/api/auth/setup', { username: 'patron', password: MOT_DE_PASSE });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return api;
}

/** Bascule la session sur un compte du rôle demandé. */
async function sessionPour(api, role) {
  const username = `compte_${role}`;
  const creation = await api.post('/api/users', { username, password: MOT_DE_PASSE, role });
  assert.equal(creation.status, 201, JSON.stringify(creation.data));
  const login = await api.post('/api/auth/login', { username, password: MOT_DE_PASSE });
  assert.equal(login.status, 200, JSON.stringify(login.data));
}

test('les sauvegardes sont réservées à l\'administrateur', async (t) => {
  const api = await avecAdmin(t);

  // Le fichier contient toute la comptabilité, et la restauration écrase les
  // données en place : ni l'employé ni le comptable n'y ont accès.
  for (const role of ['employe', 'comptable']) {
    await sessionPour(api, role);

    assert.equal((await api.get('/api/sauvegardes')).status, 403, `GET pour ${role}`);
    assert.equal((await api.post('/api/sauvegardes')).status, 403, `POST pour ${role}`);
    assert.equal(
      (await api.post('/api/sauvegardes/restaurer', { nom: 'clora-2026-01-01T00-00-00-000.sqlite' })).status,
      403,
      `restauration pour ${role}`
    );
    assert.equal(
      (await api.post('/api/sauvegardes/examiner', { nom: 'clora-2026-01-01T00-00-00-000.sqlite' })).status,
      403,
      `examen pour ${role}`
    );

    await api.post('/api/auth/login', { username: 'patron', password: MOT_DE_PASSE });
  }
});

test('sans session, les sauvegardes sont inaccessibles', async (t) => {
  const api = await avecAdmin(t);
  api.clearCookie();

  assert.equal((await api.get('/api/sauvegardes')).status, 401);
  assert.equal((await api.post('/api/sauvegardes')).status, 401);
});

test('l\'administrateur crée et retrouve une sauvegarde', async (t) => {
  const api = await avecAdmin(t);
  const dossier = dossierTemporaire(t);
  await api.db.run('UPDATE settings SET sauvegarde_dossier = ?', [dossier]);

  const creation = await api.post('/api/sauvegardes');
  assert.equal(creation.status, 201, JSON.stringify(creation.data));
  assert.ok(creation.data.taille > 0);

  const liste = await api.get('/api/sauvegardes');
  assert.equal(liste.status, 200);
  assert.equal(liste.data.sauvegardes.length, 1);
  assert.equal(liste.data.sauvegardes[0].nom, creation.data.nom);
});

test('la liste sépare les sauvegardes du dossier de celles venues d\'ailleurs', async (t) => {
  const api = await avecAdmin(t);
  const dossier = dossierTemporaire(t);
  await api.db.run('UPDATE settings SET sauvegarde_dossier = ?', [dossier]);

  const propre = (await api.post('/api/sauvegardes')).data.nom;
  const ancienne = `clora-${horodatage(new Date(Date.UTC(2026, 9, 1, 3, 0, 0)))}.sqlite`;
  const etrangere = `clora-${SERIE}-${horodatage(new Date(Date.UTC(2026, 9, 2, 3, 0, 0)))}.sqlite`;
  await api.db.run('VACUUM INTO ?', [path.join(dossier, ancienne)]);
  await api.db.run('VACUUM INTO ?', [path.join(dossier, etrangere)]);

  const liste = (await api.get('/api/sauvegardes')).data;
  assert.deepEqual(liste.sauvegardes.map((s) => s.nom), [propre]);
  assert.deepEqual(liste.autres.map((s) => s.nom).sort(), [ancienne, etrangere].sort());
  assert.equal(liste.autres.find((s) => s.nom === ancienne).serie, null);
  assert.equal(liste.uid, undefined, 'l\'identifiant n\'a rien à faire dans l\'interface');
});

test('examiner une sauvegarde montre son contenu sans rien modifier', async (t) => {
  const api = await avecAdmin(t);
  const dossier = dossierTemporaire(t);
  await api.db.run("UPDATE settings SET sauvegarde_dossier = ?, entreprise_nom = 'Plomberie Rivard'", [dossier]);
  await insertClient(api.db, { nom: 'Boulangerie Côté' });

  const { nom } = (await api.post('/api/sauvegardes')).data;
  const res = await api.post('/api/sauvegardes/examiner', { nom });

  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.entreprise, 'Plomberie Rivard');
  assert.equal(res.data.clients, 1);
  assert.equal(res.data.meme_dossier, true);
  assert.ok(!fs.existsSync(path.join(path.dirname(api.db.__dbPath), MARQUEUR)), 'examiner ne demande rien');
});

test('la restauration est préparée à côté de la base du dossier, et consignée', async (t) => {
  const api = await avecAdmin(t);
  const dossier = dossierTemporaire(t);
  await api.db.run('UPDATE settings SET sauvegarde_dossier = ?', [dossier]);
  const { nom } = (await api.post('/api/sauvegardes')).data;

  const res = await api.post('/api/sauvegardes/restaurer', { nom });
  assert.equal(res.status, 200, JSON.stringify(res.data));

  const marqueur = path.join(path.dirname(api.db.__dbPath), MARQUEUR);
  const demande = JSON.parse(fs.readFileSync(marqueur, 'utf8'));
  assert.equal(demande.cible, api.db.__dbPath);
  assert.ok(fs.existsSync(`${api.db.__dbPath}${SUFFIXE_PREPARATION}`));

  const trace = await api.db.get("SELECT details FROM logs_audit WHERE action = 'sauvegarde.restauration'");
  assert.equal(JSON.parse(trace.details).sauvegarde, nom);
});

test('restaurer une sauvegarde inconnue est refusé', async (t) => {
  const api = await avecAdmin(t);
  await api.db.run('UPDATE settings SET sauvegarde_dossier = ?', [dossierTemporaire(t)]);

  const res = await api.post('/api/sauvegardes/restaurer', { nom: 'clora-2020-01-01T00-00-00-000.sqlite' });

  assert.equal(res.status, 404);
});

test('le nom de sauvegarde ne permet pas de sortir du dossier', async (t) => {
  const api = await avecAdmin(t);
  await api.db.run('UPDATE settings SET sauvegarde_dossier = ?', [dossierTemporaire(t)]);

  // Le nom est confronté à la liste réelle du dossier, jamais concaténé à un
  // chemin : une remontée d'arborescence ne désigne donc rien.
  const res = await api.post('/api/sauvegardes/restaurer', { nom: '../../../etc/passwd' });

  assert.equal(res.status, 404);
});

test('le nombre de sauvegardes conservées est validé', async (t) => {
  const api = await avecAdmin(t);
  const base = { entreprise_nom: 'Test', taxe_1_taux: 0.05, taxe_2_taux: 0.09975 };

  assert.equal((await api.put('/api/settings', { ...base, sauvegarde_retention: 0 })).status, 400);
  assert.equal((await api.put('/api/settings', { ...base, sauvegarde_retention: 1000 })).status, 400);
  assert.equal((await api.put('/api/settings', { ...base, sauvegarde_retention: 7 })).status, 200);

  const settings = await api.get('/api/settings');
  assert.equal(settings.data.sauvegarde_retention, 7);
});

test('enregistrer les paramètres sans mentionner les sauvegardes ne les désactive pas', async (t) => {
  const api = await avecAdmin(t);

  // `body.x ? 1 : 0` traitait l'absence comme une désactivation : un client qui
  // ignorait ce réglage coupait les sauvegardes automatiques à son insu.
  const res = await api.put('/api/settings', {
    entreprise_nom: 'Sans mention', taxe_1_taux: 0.05, taxe_2_taux: 0.09975
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));

  const settings = await api.db.get('SELECT sauvegarde_active, relances_actives FROM settings LIMIT 1');
  assert.equal(settings.sauvegarde_active, 1, 'les sauvegardes doivent rester actives');

  // Et une désactivation explicite reste bien prise en compte.
  await api.put('/api/settings', {
    entreprise_nom: 'Sans mention', taxe_1_taux: 0.05, taxe_2_taux: 0.09975, sauvegarde_active: 0
  });
  const apres = await api.db.get('SELECT sauvegarde_active FROM settings LIMIT 1');
  assert.equal(apres.sauvegarde_active, 0);
});
