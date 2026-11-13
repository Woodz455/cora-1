/**
 * Registre des dossiers d'entreprise et comptes partagés.
 *
 * Clora ne tenait qu'une seule comptabilité : un comptable qui suit vingt
 * clients ne pouvait pas s'en servir. Chaque dossier a désormais **son propre
 * fichier de base**, et non une colonne `entreprise_id` ajoutée aux dix-sept
 * tables.
 *
 * Ce choix n'est pas une commodité. Filtrer par colonne aurait imposé de
 * scoper les 81 requêtes existantes, et **un seul `WHERE` oublié aurait montré
 * les factures d'un client à un autre** — sur un logiciel vendu à des
 * comptables, la faute dont on ne se relève pas. Un fichier par dossier rend le
 * cloisonnement physique : il n'y a rien à filtrer, donc rien à oublier.
 *
 * Les comptes, eux, sont communs : ils vivent dans `comptes.sqlite`, à côté des
 * dossiers. Sans quoi un comptable devrait se reconnecter à chaque changement
 * de client.
 */

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const { getDataDir, getDbPath, DB_FILENAME } = require('./config.js');
const { initDb, addColumn } = require('./database.js');

/** Fichier des comptes et du registre, distinct de toute donnée comptable. */
const COMPTES_FILENAME = 'comptes.sqlite';

/** Sous-dossier accueillant les dossiers créés après la migration. */
const DOSSIERS_DIRNAME = 'entreprises';

/** Rôles reconnus, repris de `authMiddleware` pour éviter deux vérités. */
const { ROLES } = require('./authMiddleware.js');
const { profilDe } = require('./profils.js');
const { PREFIXE_FACTURE_DEFAUT } = require('./sequences.js');

/** Connexions ouvertes, indexées par chemin de fichier. */
const connexions = new Map();

function cheminComptes() {
  return path.join(getDataDir(), COMPTES_FILENAME);
}

/**
 * Ouvre `comptes.sqlite` et garantit son schéma.
 *
 * `acces` porte le rôle **par dossier** : un comptable peut être administrateur
 * chez un client et simple employé chez un autre. Le rôle ne peut donc plus
 * vivre sur l'utilisateur.
 */
async function ouvrirComptes(chemin = cheminComptes()) {
  const db = await open({ filename: chemin, driver: sqlite3.Database });

  await db.exec('PRAGMA journal_mode = WAL');
  await db.exec('PRAGMA foreign_keys = ON');

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      cree_le TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS entreprises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL,
      chemin TEXT UNIQUE NOT NULL,
      cree_le TEXT NOT NULL DEFAULT (datetime('now')),
      archive INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS acces (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entreprise_id INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'employe',
      PRIMARY KEY (user_id, entreprise_id)
    );

    -- Une licence vaut pour l'installation, pas pour un dossier : la loger
    -- dans une base d'entreprise permettrait d'en créer une neuve pour
    -- repartir l'essai à zéro. Ligne unique, contrainte par la clé primaire.
    CREATE TABLE IF NOT EXISTS licence (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cle TEXT,
      active_le TEXT,
      essai_debut TEXT,
      date_max TEXT
    );
  `);

  // La langue de l'interface appartient au compte, pas au dossier : une
  // comptable anglophone travaille en anglais dans chacun de ses dossiers, et
  // le patron du même dossier peut garder le français.
  await addColumn(db, 'users', 'langue', "TEXT NOT NULL DEFAULT 'fr'");

  // La visite guidée se montre une fois par personne, au premier dossier
  // ouvert, et non une fois par dossier : qui a déjà vu le menu de Clora n'a
  // pas à le revoir en changeant de client.
  await addColumn(db, 'users', 'visite_vue', 'INTEGER NOT NULL DEFAULT 0');

  // Code de récupération du mot de passe : seule son empreinte est gardée,
  // comme pour le mot de passe lui-même.
  await addColumn(db, 'users', 'recuperation_empreinte', 'TEXT');
  await addColumn(db, 'users', 'recuperation_le', 'TEXT');

  // L'essai commence à la création du registre, donc à la première ouverture
  // de l'application — et non à la première consultation de l'écran de
  // licence, qu'un utilisateur pourrait ne jamais atteindre.
  await db.run(
    "INSERT OR IGNORE INTO licence (id, essai_debut, date_max) VALUES (1, date('now'), date('now'))"
  );

  return db;
}

/**
 * Fait basculer une installation mono-entreprise vers le registre.
 *
 * Trois règles, qui répondent toutes au même souci : l'utilisateur a des
 * données réelles, et doit pouvoir revenir en arrière.
 *
 *   1. La base existante devient le premier dossier **là où elle est**. Aucun
 *      fichier n'est déplacé — un chemin cassé sur une comptabilité serait
 *      autrement plus grave que le confort d'une arborescence propre.
 *   2. Les comptes sont **recopiés**, pas déplacés : la table `users` de la
 *      base d'entreprise reste intacte, si bien que réinstaller la version
 *      précédente redonne une application qui fonctionne.
 *   3. Chaque utilisateur conserve, sur ce premier dossier, le rôle qu'il avait.
 *
 * Idempotent : un registre déjà peuplé n'est pas retouché.
 *
 * @returns {Promise<{migre: boolean, entreprise?: Object, comptes?: number}>}
 */
async function migrerSiNecessaire(comptesDb, cheminBase = getDbPath()) {
  const dejaEnregistre = await comptesDb.get('SELECT id FROM entreprises LIMIT 1');
  if (dejaEnregistre) return { migre: false };

  if (!fs.existsSync(cheminBase)) return { migre: false };

  const base = await open({ filename: cheminBase, driver: sqlite3.Database });
  let nom = 'Mon entreprise';
  let comptes = [];
  try {
    // `initDb` dépose une ligne de paramètres vide dès la création : prendre la
    // première venue nommerait le dossier « Mon entreprise » alors que la
    // raison sociale est renseignée sur une autre ligne.
    const settings = await base.get(
      "SELECT entreprise_nom FROM settings WHERE entreprise_nom IS NOT NULL AND TRIM(entreprise_nom) != '' LIMIT 1"
    );
    if (settings && settings.entreprise_nom) nom = settings.entreprise_nom;
    comptes = await base.all('SELECT username, password, role FROM users');
  } catch (e) {
    // Base présente mais sans schéma exploitable : on l'enregistre quand même,
    // `initDb` la complétera à l'ouverture.
  } finally {
    await base.close();
  }

  const entreprise = await comptesDb.run(
    'INSERT INTO entreprises (nom, chemin) VALUES (?, ?)',
    [nom, cheminBase]
  );

  let repris = 0;
  for (const compte of comptes) {
    const existant = await comptesDb.get('SELECT id FROM users WHERE username = ?', [compte.username]);
    const userId = existant
      ? existant.id
      : (await comptesDb.run(
        'INSERT INTO users (username, password) VALUES (?, ?)',
        [compte.username, compte.password]
      )).lastID;

    const role = ROLES.includes(compte.role) ? compte.role : 'employe';
    await comptesDb.run(
      'INSERT OR REPLACE INTO acces (user_id, entreprise_id, role) VALUES (?, ?, ?)',
      [userId, entreprise.lastID, role]
    );
    repris += 1;
  }

  console.log(`Migration : dossier « ${nom} » enregistré, ${repris} compte(s) repris.`);
  return {
    migre: true,
    entreprise: { id: entreprise.lastID, nom, chemin: cheminBase },
    comptes: repris
  };
}

/** Dossiers auxquels un utilisateur a accès, avec son rôle sur chacun. */
async function listerPourUtilisateur(comptesDb, userId) {
  return comptesDb.all(
    `SELECT e.id, e.nom, e.chemin, e.cree_le, a.role
     FROM entreprises e
     JOIN acces a ON a.entreprise_id = e.id
     WHERE a.user_id = ? AND e.archive = 0
     ORDER BY e.nom COLLATE NOCASE`,
    [userId]
  );
}

/**
 * Dossiers archivés auxquels un utilisateur a accès : ils n'apparaissent plus
 * dans le choix ordinaire, mais restent là pour qui veut les rouvrir.
 */
async function listerArchivesPourUtilisateur(comptesDb, userId) {
  return comptesDb.all(
    `SELECT e.id, e.nom, e.cree_le, a.role
     FROM entreprises e
     JOIN acces a ON a.entreprise_id = e.id
     WHERE a.user_id = ? AND e.archive = 1
     ORDER BY e.nom COLLATE NOCASE`,
    [userId]
  );
}

/**
 * Renomme un dossier dans le registre.
 *
 * Seul le nom affiché au choix du dossier change. Le répertoire garde le sien,
 * car un chemin déplacé sur une comptabilité vaut moins que l'ordre d'une
 * arborescence ; la raison sociale imprimée sur les documents, elle, se règle
 * dans Paramètres.
 */
async function renommerEntreprise(comptesDb, id, nom) {
  await comptesDb.run('UPDATE entreprises SET nom = ? WHERE id = ?', [nom, id]);
}

/** Archive un dossier, ou le rend au choix ordinaire. Rien n'est effacé. */
async function archiverEntreprise(comptesDb, id, archiver) {
  await comptesDb.run('UPDATE entreprises SET archive = ? WHERE id = ?', [archiver ? 1 : 0, id]);
}

/** Rôle d'un utilisateur sur un dossier, ou null s'il n'y a pas accès. */
async function roleSur(comptesDb, userId, entrepriseId) {
  const ligne = await comptesDb.get(
    'SELECT role FROM acces WHERE user_id = ? AND entreprise_id = ?',
    [userId, entrepriseId]
  );
  return ligne ? ligne.role : null;
}

/** Transforme un nom d'entreprise en nom de dossier sûr. */
function versNomDeDossier(nom) {
  const base = String(nom)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 40);
  return base || 'dossier';
}

/**
 * Inscrit dans la base d'un dossier son nom et, s'il est donné, son profil avec
 * les valeurs de départ qui vont avec.
 *
 * L'initialisation de la base sème déjà une ligne de paramètres. Y ajouter la
 * nôtre laissait deux lignes, et toute lecture (`LIMIT 1`) tombait sur la
 * première, au nom vide : le dossier s'appelait « Votre entreprise » sur ses
 * factures jusqu'à ce qu'on retape son nom dans Paramètres.
 */
async function poserIdentite(db, { nom, profil = null }) {
  const reglages = profilDe(profil);
  const valeurs = [nom, reglages ? reglages.valeur : null, reglages ? reglages.conditions_defaut : null];

  const existante = await db.get('SELECT id FROM settings ORDER BY id LIMIT 1');
  if (existante) {
    await db.run(
      'UPDATE settings SET entreprise_nom = ?, profil = ?, conditions_defaut = ? WHERE id = ?',
      [...valeurs, existante.id]
    );
  } else {
    await db.run('INSERT INTO settings (entreprise_nom, profil, conditions_defaut) VALUES (?, ?, ?)', valeurs);
  }

  // Un dossier qui n'a encore rien facturé prend le préfixe neutre. S'il porte
  // déjà des factures, sa série en cours ne change pas.
  const dejaFacture = await db.get('SELECT id FROM factures LIMIT 1');
  if (!dejaFacture) await db.run('UPDATE settings SET prefixe_facture = ?', [PREFIXE_FACTURE_DEFAUT]);
}

/**
 * Donne son identité à un dossier qui n'en a pas encore.
 *
 * Jusqu'à la 1.10.0, le premier lancement créait une base vide à la racine des
 * données. Quitter avant de créer son compte suffisait à la faire prendre, au
 * lancement suivant, pour un dossier hérité : le nom d'entreprise et le profil
 * saisis à la création du compte étaient alors ignorés, et le dossier restait
 * « Mon entreprise ».
 *
 * Un dossier est tenu pour vierge quand ses paramètres ne portent ni nom ni
 * profil. Un vrai dossier hérité, qui porte déjà un nom, garde le sien.
 *
 * @returns {Promise<string|null>} le nom posé, ou null si le dossier avait déjà le sien
 */
async function nommerSiVierge(comptesDb, entreprise, { nom, profil = null }) {
  const db = await ouvrirEntreprise(entreprise.chemin);
  const reglages = await db.get('SELECT entreprise_nom, profil FROM settings ORDER BY id LIMIT 1');
  const dejaNomme = reglages && String(reglages.entreprise_nom || '').trim() !== '';
  if (dejaNomme || (reglages && reglages.profil)) return null;

  await poserIdentite(db, { nom, profil });
  await comptesDb.run('UPDATE entreprises SET nom = ? WHERE id = ?', [nom, entreprise.id]);
  return nom;
}

/**
 * Crée un dossier neuf : un répertoire, une base initialisée, et l'accès
 * accordé à son créateur.
 *
 * Le suffixe numérique évite qu'une seconde « Plomberie Tremblay » écrase la
 * première — deux clients peuvent porter le même nom.
 *
 * Le profil, s'il est donné, pose les valeurs de départ qui vont avec : les
 * conditions de paiement proposées aux nouveaux clients. Rien d'autre n'est
 * décidé à sa place.
 */
async function creerEntreprise(comptesDb, { nom, userId, profil = null }) {
  const racine = path.join(getDataDir(), DOSSIERS_DIRNAME);
  fs.mkdirSync(racine, { recursive: true });

  const souche = versNomDeDossier(nom);
  let dossier = path.join(racine, souche);
  let suffixe = 2;
  while (fs.existsSync(dossier)) {
    dossier = path.join(racine, `${souche}-${suffixe}`);
    suffixe += 1;
  }
  fs.mkdirSync(dossier, { recursive: true });

  const chemin = path.join(dossier, DB_FILENAME);
  const db = await initDb(chemin);
  await poserIdentite(db, { nom, profil });
  connexions.set(chemin, db);

  const resultat = await comptesDb.run(
    'INSERT INTO entreprises (nom, chemin) VALUES (?, ?)',
    [nom, chemin]
  );
  await comptesDb.run(
    "INSERT INTO acces (user_id, entreprise_id, role) VALUES (?, ?, 'admin')",
    [userId, resultat.lastID]
  );

  return { id: resultat.lastID, nom, chemin };
}

/**
 * Ouvre la base d'un dossier, en réutilisant la connexion déjà établie.
 *
 * Les connexions sont conservées : rouvrir un fichier SQLite à chaque requête
 * relancerait les migrations de schéma et le mode WAL à chaque appel.
 */
async function ouvrirEntreprise(chemin) {
  const dejaOuverte = connexions.get(chemin);
  if (dejaOuverte) return dejaOuverte;

  const db = await initDb(chemin);
  connexions.set(chemin, db);
  return db;
}

/** Ferme toutes les bases ouvertes. Appelé à l'extinction de l'application. */
async function fermerTout() {
  const ouvertes = [...connexions.values()];
  connexions.clear();
  for (const db of ouvertes) {
    try {
      await db.close();
    } catch (e) {
      console.error('Fermeture de dossier impossible :', e.message);
    }
  }
}

/**
 * Déclare une connexion déjà ouverte comme étant celle d'un dossier.
 *
 * Les tests ouvrent leur base eux-mêmes puis l'inspectent après coup ; sans
 * cette déclaration, les routes en ouvriraient une seconde sur le même fichier
 * et les assertions porteraient sur une connexion différente de celle qui a
 * écrit.
 */
function enregistrerConnexion(chemin, db) {
  connexions.set(chemin, db);
}

/** Connexions actuellement ouvertes. Utile au planificateur et aux tests. */
function connexionsOuvertes() {
  return [...connexions.entries()].map(([chemin, db]) => ({ chemin, db }));
}

module.exports = {
  ouvrirComptes,
  migrerSiNecessaire,
  listerPourUtilisateur,
  listerArchivesPourUtilisateur,
  renommerEntreprise,
  archiverEntreprise,
  roleSur,
  creerEntreprise,
  nommerSiVierge,
  ouvrirEntreprise,
  enregistrerConnexion,
  fermerTout,
  connexionsOuvertes,
  versNomDeDossier,
  cheminComptes,
  COMPTES_FILENAME,
  DOSSIERS_DIRNAME
};
