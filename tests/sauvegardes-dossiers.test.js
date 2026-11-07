/**
 * Sauvegardes et restauration avec plusieurs dossiers d'entreprise.
 *
 * Ces tests reprennent trois défauts reproduits sur la 1.9.0 :
 *
 * - deux dossiers qui partageaient un dossier de destination se gênaient : la
 *   copie du premier passait pour « récente » aux yeux du second, qui n'était
 *   jamais sauvegardé, et la rétention de l'un effaçait les copies de l'autre ;
 * - sur une installation neuve, une restauration ne s'appliquait jamais : la
 *   demande était déposée à la racine des données, loin des dossiers ;
 * - sur une installation antérieure au multi-dossier, restaurer le second
 *   dossier écrasait le premier, installé à la racine.
 *
 * Ils montent une vraie installation : registre des comptes, dossiers créés
 * comme le fait l'application, et redémarrage simulé.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

process.env.NODE_ENV = 'test';

const { initDb } = require('../database.js');
const {
  ouvrirComptes, migrerSiNecessaire, creerEntreprise, ouvrirEntreprise, fermerTout
} = require('../companyStore.js');
const {
  lireReglages,
  identifiantDuDossier,
  serieDe,
  listerSauvegardes,
  creerSauvegarde,
  sauvegardeSiNecessaire,
  examinerSauvegarde,
  demanderRestauration,
  appliquerRestaurationEnAttente,
  horodatage,
  AGE_ABANDON_MS,
  MARQUEUR,
  SUFFIXE_PREPARATION,
  PARTIEL
} = require('../backupService.js');

/**
 * Installation à deux dossiers, Alpha et Bravo.
 *
 * `migree` : Alpha est une base antérieure au multi-dossier, restée à la
 * racine des données ; sinon les deux vivent dans un sous-répertoire, comme sur
 * toute installation récente.
 */
async function installation(t, { migree = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clora-dossiers-'));
  process.env.CLORA_DATA_DIR = dir;
  let comptes = await ouvrirComptes(path.join(dir, 'comptes.sqlite'));
  t.after(async () => {
    await fermerTout();
    await comptes.close().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  });

  let userId;
  if (migree) {
    const racine = path.join(dir, 'database.sqlite');
    const ancienne = await initDb(racine);
    await ancienne.run("UPDATE settings SET entreprise_nom = 'Alpha'");
    await ancienne.run("INSERT INTO users (username, password, role) VALUES ('patron', 'x', 'admin')");
    await ancienne.close();
    await migrerSiNecessaire(comptes, racine);
    userId = (await comptes.get("SELECT id FROM users WHERE username = 'patron'")).id;
  } else {
    userId = (await comptes.run("INSERT INTO users (username, password) VALUES ('patron', 'x')")).lastID;
    await creerEntreprise(comptes, { nom: 'Alpha', userId });
  }
  await creerEntreprise(comptes, { nom: 'Bravo', userId });

  const [A, B] = await comptes.all('SELECT id, nom, chemin FROM entreprises ORDER BY id');
  const dbA = await ouvrirEntreprise(A.chemin);
  const dbB = await ouvrirEntreprise(B.chemin);
  await ajouterClient(dbA, 'Client de Alpha');
  await ajouterClient(dbB, 'Client de Bravo');

  return {
    dir, A, B, dbA, dbB,
    get comptes() { return comptes; },
    /** Ferme tout, comme à l'extinction, puis rouvre comme au démarrage. */
    async redemarrer() {
      await fermerTout();
      await comptes.close();
      comptes = await ouvrirComptes(path.join(dir, 'comptes.sqlite'));
      const premier = await comptes.get('SELECT chemin FROM entreprises WHERE archive = 0 ORDER BY id LIMIT 1');
      await ouvrirEntreprise(premier.chemin);
      return {
        dbA: await ouvrirEntreprise(A.chemin),
        dbB: await ouvrirEntreprise(B.chemin)
      };
    }
  };
}

function ajouterClient(db, nom) {
  return db.run('INSERT INTO clients (nom_entreprise, email) VALUES (?, ?)', [nom, 'contact@exemple.ca']);
}

async function clients(db) {
  return (await db.all('SELECT nom_entreprise FROM clients ORDER BY id')).map((c) => c.nom_entreprise);
}

/** Réglages du poste, tels que la route de restauration les transmet. */
function reglagesDuPoste(db) {
  return db.get('SELECT sauvegarde_active, sauvegarde_dossier, sauvegarde_retention FROM settings ORDER BY id LIMIT 1');
}

/** Demande une restauration comme le fait la route. */
async function restaurer(db, source, cible, uidsAilleurs = []) {
  return demanderRestauration(source, cible, {
    uid: await identifiantDuDossier(db),
    poste: await reglagesDuPoste(db),
    uidsAilleurs
  });
}

/* --- L'identité du dossier --- */

test('chaque base reçoit un identifiant permanent, qui survit à sa réouverture', async (t) => {
  const inst = await installation(t);
  const uidA = await identifiantDuDossier(inst.dbA);
  const uidB = await identifiantDuDossier(inst.dbB);

  assert.match(uidA, /^[0-9a-f-]{36}$/);
  assert.notEqual(uidA, uidB);

  const { dbA } = await inst.redemarrer();
  assert.equal(await identifiantDuDossier(dbA), uidA);
});

/* --- Des séries séparées dans un même dossier de destination --- */

test('deux dossiers qui partagent un dossier de destination sont sauvegardés tous les deux', async (t) => {
  const { dbA, dbB } = await installation(t);

  // Le dossier par défaut est commun à tous les dossiers d'une installation.
  assert.equal((await lireReglages(dbA)).dossier, (await lireReglages(dbB)).dossier);

  const a = await sauvegardeSiNecessaire(dbA);
  const b = await sauvegardeSiNecessaire(dbB);

  assert.equal(a.effectuee, true);
  assert.equal(b.effectuee, true, 'la copie d\'Alpha ne doit pas compter comme récente pour Bravo');
  assert.equal((await sauvegardeSiNecessaire(dbB)).raison, 'recente');
});

test('chaque dossier ne compte et ne supprime que ses propres sauvegardes', async (t) => {
  const { dbA, dbB, dir } = await installation(t);
  const dossier = path.join(dir, 'commun');

  for (let i = 0; i < 3; i += 1) await creerSauvegarde(dbA, { dossier, retention: 2 });
  await creerSauvegarde(dbB, { dossier, retention: 2 });
  await creerSauvegarde(dbB, { dossier, retention: 1 });

  const serieA = serieDe(await identifiantDuDossier(dbA));
  const serieB = serieDe(await identifiantDuDossier(dbB));
  const toutes = listerSauvegardes(dossier);

  assert.equal(toutes.filter((s) => s.serie === serieA).length, 2, 'Alpha garde ses deux plus récentes');
  assert.equal(toutes.filter((s) => s.serie === serieB).length, 1, 'Bravo n\'en garde qu\'une');
  assert.equal(toutes.length, 3, 'la rétention de Bravo ne doit rien avoir pris à Alpha');
});

test('les sauvegardes antérieures à la 1.9.1 ne comptent pas comme récentes et ne sont jamais supprimées', async (t) => {
  const { dbA, dir } = await installation(t);
  const dossier = path.join(dir, 'commun');
  await dbA.run('UPDATE settings SET sauvegarde_dossier = ?, sauvegarde_retention = 1', [dossier]);

  // Une copie à l'ancienne forme, faite il y a une heure : sans série.
  fs.mkdirSync(dossier, { recursive: true });
  const ancienne = `clora-${horodatage(new Date(Date.now() - 3600 * 1000))}.sqlite`;
  await dbA.run('VACUUM INTO ?', [path.join(dossier, ancienne)]);

  const resultat = await sauvegardeSiNecessaire(dbA);
  assert.equal(resultat.effectuee, true, 'on ne sait pas de quel dossier elle vient : elle ne dispense de rien');

  await creerSauvegarde(dbA, { dossier, retention: 1 });
  const noms = listerSauvegardes(dossier).map((s) => s.nom);
  assert.ok(noms.includes(ancienne), 'une copie dont on ignore la provenance n\'est jamais supprimée');
  assert.equal(listerSauvegardes(dossier).find((s) => s.nom === ancienne).serie, null);
});

test('la copie est produite à côté de la base, puis déposée d\'un coup', async (t) => {
  const { dbA, A, dir } = await installation(t);
  const dossier = path.join(dir, 'destination');

  const { nom } = await creerSauvegarde(dbA, { dossier });

  // Rien en cours dans la destination, rien d'oublié à côté de la base.
  assert.deepEqual(fs.readdirSync(dossier), [nom]);
  const aCote = fs.readdirSync(path.dirname(A.chemin)).filter((f) => f.includes('.copie-'));
  assert.deepEqual(aCote, []);
});

test('un fichier de travail abandonné est nettoyé, un fichier récent est laissé', async (t) => {
  const { dbA, dbB, A, dir } = await installation(t);
  const dossier = path.join(dir, 'destination');
  fs.mkdirSync(dossier, { recursive: true });
  const serieA = serieDe(await identifiantDuDossier(dbA));
  const serieB = serieDe(await identifiantDuDossier(dbB));

  const ilYADeuxHeures = new Date(Date.now() - 2 * AGE_ABANDON_MS);
  const fichier = (chemin, vieux) => {
    fs.writeFileSync(chemin, 'interrompu');
    if (vieux) fs.utimesSync(chemin, ilYADeuxHeures, ilYADeuxHeures);
    return chemin;
  };
  const copieAbandonnee = fichier(`${A.chemin}.copie-abandonnee`, true);
  const copieEnCours = fichier(`${A.chemin}.copie-en-cours`, false);
  const depotAbandonne = fichier(path.join(dossier, `clora-${serieA}-${horodatage(ilYADeuxHeures)}.sqlite${PARTIEL}`), true);
  const depotDeBravo = fichier(path.join(dossier, `clora-${serieB}-${horodatage(ilYADeuxHeures)}.sqlite${PARTIEL}`), true);

  await creerSauvegarde(dbA, { dossier });

  assert.ok(!fs.existsSync(copieAbandonnee), 'la copie abandonnée doit être retirée');
  assert.ok(fs.existsSync(copieEnCours), 'une copie récente peut appartenir à une sauvegarde en cours');
  assert.ok(!fs.existsSync(depotAbandonne), 'le dépôt interrompu doit être retiré');
  assert.ok(fs.existsSync(depotDeBravo), 'le dépôt d\'un autre dossier n\'est pas le nôtre');
});

/* --- La restauration vise son dossier, et lui seul --- */

test('sur une installation neuve, la restauration s\'applique au dossier qu\'elle vise', async (t) => {
  const inst = await installation(t);
  const { dbB, B, dir } = inst;
  const { chemin } = await creerSauvegarde(dbB, { dossier: path.join(dir, 'sauvegardes-bravo') });
  await ajouterClient(dbB, 'Saisi après la sauvegarde');

  const demande = await restaurer(dbB, chemin, B.chemin);
  assert.equal(path.dirname(demande.marqueur), path.dirname(B.chemin), 'la demande est déposée à côté de la base');

  const apres = await inst.redemarrer();
  assert.deepEqual(await clients(apres.dbB), ['Client de Bravo']);
  assert.deepEqual(await clients(apres.dbA), ['Client de Alpha']);
  assert.ok(!fs.existsSync(demande.marqueur), 'la demande est consommée');
  assert.ok(!fs.existsSync(`${B.chemin}${SUFFIXE_PREPARATION}`), 'la base préparée a pris sa place');
});

test('sur une installation antérieure au multi-dossier, restaurer le second dossier ne touche pas au premier', async (t) => {
  const inst = await installation(t, { migree: true });
  const { dbB, A, B, dir } = inst;
  assert.equal(path.dirname(A.chemin), dir, 'Alpha occupe la racine des données');

  const { chemin } = await creerSauvegarde(dbB, { dossier: path.join(dir, 'sauvegardes-bravo') });
  await ajouterClient(dbB, 'Saisi après la sauvegarde');
  await restaurer(dbB, chemin, B.chemin);

  const apres = await inst.redemarrer();
  assert.deepEqual(await clients(apres.dbA), ['Client de Alpha'], 'Alpha ne doit pas recevoir la copie de Bravo');
  assert.deepEqual(await clients(apres.dbB), ['Client de Bravo']);
});

test('une demande laissée par une version antérieure, sans cible, est écartée', async (t) => {
  const inst = await installation(t, { migree: true });
  const { dbB, A, dir } = inst;
  const { chemin } = await creerSauvegarde(dbB, { dossier: path.join(dir, 'sauvegardes-bravo') });

  // La forme de la 1.9.0 : à la racine, sans dire quel dossier elle vise.
  fs.writeFileSync(path.join(dir, MARQUEUR), JSON.stringify({ source: chemin }));

  const apres = await inst.redemarrer();
  assert.deepEqual(await clients(apres.dbA), ['Client de Alpha']);
  assert.ok(!fs.existsSync(path.join(dir, MARQUEUR)), 'la demande ne doit pas attendre indéfiniment');
  assert.ok(fs.existsSync(A.chemin));
});

test('la restauration garde les réglages de sauvegarde du poste', async (t) => {
  const inst = await installation(t);
  const { dbB, B, dir } = inst;
  const { chemin } = await creerSauvegarde(dbB, { dossier: path.join(dir, 'ancien-dossier') });

  // Après la copie, le poste a changé de dossier de destination et de rétention.
  const nouveau = path.join(dir, 'nouveau-dossier');
  await dbB.run('UPDATE settings SET sauvegarde_dossier = ?, sauvegarde_retention = 12', [nouveau]);
  await restaurer(dbB, chemin, B.chemin);

  const apres = await inst.redemarrer();
  const reglages = await reglagesDuPoste(apres.dbB);
  assert.equal(reglages.sauvegarde_dossier, nouveau);
  assert.equal(reglages.sauvegarde_retention, 12);
});

test('une copie ancienne prend l\'identifiant du dossier où on la restaure', async (t) => {
  const inst = await installation(t);
  const { dbB, B, dir } = inst;
  const uidB = await identifiantDuDossier(dbB);

  // Une copie sans identifiant, comme celles des versions antérieures.
  const ancienne = path.join(dir, `clora-${horodatage()}.sqlite`);
  await dbB.run('VACUUM INTO ?', [ancienne]);
  const copie = await open({ filename: ancienne, driver: sqlite3.Database });
  await copie.run('UPDATE settings SET dossier_uid = NULL');
  await copie.close();

  await restaurer(dbB, ancienne, B.chemin);
  const apres = await inst.redemarrer();
  assert.equal(await identifiantDuDossier(apres.dbB), uidB);
});

test('la copie d\'un autre dossier du poste reçoit un nouvel identifiant', async (t) => {
  const inst = await installation(t);
  const { dbA, dbB, B, dir } = inst;
  const uidA = await identifiantDuDossier(dbA);
  const uidB = await identifiantDuDossier(dbB);
  const { chemin } = await creerSauvegarde(dbA, { dossier: path.join(dir, 'commun') });

  await restaurer(dbB, chemin, B.chemin, [uidA]);
  const apres = await inst.redemarrer();
  const uid = await identifiantDuDossier(apres.dbB);

  assert.deepEqual(await clients(apres.dbB), ['Client de Alpha'], 'le contenu est bien celui de la copie');
  assert.notEqual(uid, uidA, 'deux dossiers ne doivent jamais partager une série');
  assert.notEqual(uid, uidB);
});

test('la copie d\'un autre ordinateur garde son identifiant, pour continuer sa série', async (t) => {
  const inst = await installation(t);
  const { dbA, dbB, B, dir } = inst;
  const uidA = await identifiantDuDossier(dbA);
  const { chemin } = await creerSauvegarde(dbA, { dossier: path.join(dir, 'commun') });

  // Vu de cet ordinateur-ci, la copie vient d'ailleurs : aucun autre dossier
  // du poste ne porte son identifiant.
  await restaurer(dbB, chemin, B.chemin, []);
  const apres = await inst.redemarrer();
  assert.equal(await identifiantDuDossier(apres.dbB), uidA);
});

test('la base de secours garde les dernières écritures, journal WAL compris', async (t) => {
  const inst = await installation(t);
  const { dbB, dir } = inst;
  const { chemin } = await creerSauvegarde(dbB, { dossier: path.join(dir, 'sauvegardes') });
  await ajouterClient(dbB, 'Encore dans le journal');

  // L'état du disque après un arrêt brutal : la base et son journal WAL, non
  // reporté. C'est ce que laisse le redémarrage forcé qui suit une restauration.
  const arret = path.join(dir, 'arret');
  fs.mkdirSync(arret);
  const base = path.join(arret, 'database.sqlite');
  fs.copyFileSync(inst.B.chemin, base);
  assert.ok(fs.existsSync(`${inst.B.chemin}-wal`), 'le test exige des écritures restées dans le journal');
  fs.copyFileSync(`${inst.B.chemin}-wal`, `${base}-wal`);

  await restaurer(dbB, chemin, base);
  const resultat = appliquerRestaurationEnAttente(base);
  assert.ok(resultat && resultat.sauvegardeDeSecurite);

  const secours = await open({ filename: resultat.sauvegardeDeSecurite, driver: sqlite3.Database });
  t.after(() => secours.close());
  assert.deepEqual(await clients(secours), ['Client de Bravo', 'Encore dans le journal']);
});

/* --- Examiner avant de restaurer --- */

test('examiner une sauvegarde dit ce qu\'elle contient et d\'où elle vient', async (t) => {
  const { dbA, dbB, B, dir } = await installation(t);
  const dossier = path.join(dir, 'commun');
  await dbA.run("UPDATE settings SET entreprise_nom = 'Alpha inc.'");
  const deAlpha = await creerSauvegarde(dbA, { dossier });
  const deBravo = await creerSauvegarde(dbB, { dossier });
  const uidB = await identifiantDuDossier(dbB);

  const examen = await examinerSauvegarde(deAlpha.chemin, B.chemin, uidB);
  assert.equal(examen.entreprise, 'Alpha inc.');
  assert.equal(examen.clients, 1);
  assert.equal(examen.factures, 0);
  assert.equal(examen.meme_dossier, false);

  assert.equal((await examinerSauvegarde(deBravo.chemin, B.chemin, uidB)).meme_dossier, true);

  // La lecture n'a rien laissé, ni à côté de la base, ni dans la destination.
  assert.deepEqual(fs.readdirSync(path.dirname(B.chemin)).filter((f) => f.includes('.examen-')), []);
  assert.equal(fs.readdirSync(dossier).length, 2);
});
