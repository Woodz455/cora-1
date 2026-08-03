/**
 * Sauvegardes automatiques de la base comptable.
 *
 * Une application de bureau détient l'unique exemplaire des données : un disque
 * qui lâche emporte la comptabilité. Ce service produit une copie datée, en
 * conserve un nombre borné, et sait restaurer l'une d'elles.
 *
 * `VACUUM INTO` plutôt qu'une copie de fichier : la base tourne en mode WAL,
 * et copier `database.sqlite` pendant une écriture donne un fichier tronqué,
 * amputé de tout ce qui n'a pas encore été reporté depuis le journal.
 * `VACUUM INTO` produit un fichier cohérent, compacté, sans interrompre
 * l'application.
 */

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const { getDataDir, getDbPath } = require('./config.js');

/** Préfixe et extension des fichiers produits. */
const PREFIXE = 'clora-';
const EXTENSION = '.sqlite';

/** Nombre de sauvegardes conservées à défaut de réglage. */
const RETENTION_DEFAUT = 30;

/** Délai au-delà duquel une nouvelle sauvegarde est due. */
const INTERVALLE_MS = 24 * 60 * 60 * 1000;

/** Marqueur déposé pour qu'une restauration s'applique au prochain démarrage. */
const MARQUEUR = 'restauration-demandee.json';

/** Dossier utilisé lorsque l'utilisateur n'en a pas choisi d'autre. */
function dossierParDefaut() {
  return path.join(getDataDir(), 'sauvegardes');
}

/**
 * Horodatage sûr pour un nom de fichier, et trié par ordre chronologique quand
 * on trie les noms par ordre alphabétique.
 *
 * Les millisecondes ne sont pas décoratives : à la seconde près, une sauvegarde
 * manuelle déclenchée deux fois de suite, ou celle de la fermeture arrivant sur
 * les talons du planificateur, produisaient le même nom de fichier.
 */
function horodatage(date = new Date()) {
  return date.toISOString().replace(/:/g, '-').replace(/\./g, '-').replace(/Z$/, '');
}

/** Extrait la date d'un nom de sauvegarde, ou `null` si le nom ne suit pas la forme. */
function dateDuNom(nom) {
  if (!nom.startsWith(PREFIXE) || !nom.endsWith(EXTENSION)) return null;
  const brut = nom.slice(PREFIXE.length, -EXTENSION.length);
  // 2026-08-01T03-12-00-123 -> 2026-08-01T03:12:00.123Z
  const iso = brut.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})$/, 'T$1:$2:$3.$4Z');
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Réglages de sauvegarde, avec repli sur les valeurs par défaut.
 * Les colonnes peuvent manquer sur une base ancienne : on ne suppose rien.
 */
async function lireReglages(db) {
  let ligne = null;
  try {
    ligne = await db.get(
      'SELECT sauvegarde_active, sauvegarde_dossier, sauvegarde_retention FROM settings LIMIT 1'
    );
  } catch (e) {
    // Colonnes absentes : la migration n'a pas encore tourné.
  }

  const retention = Number(ligne && ligne.sauvegarde_retention);
  return {
    active: !ligne || ligne.sauvegarde_active !== 0,
    dossier: (ligne && ligne.sauvegarde_dossier) || dossierParDefaut(),
    retention: Number.isInteger(retention) && retention > 0 ? retention : RETENTION_DEFAUT
  };
}

/** Sauvegardes présentes dans un dossier, de la plus récente à la plus ancienne. */
function listerSauvegardes(dossier) {
  let noms = [];
  try {
    noms = fs.readdirSync(dossier);
  } catch (e) {
    // Dossier absent, chemin traversant un fichier, droits refusés : dans tous
    // les cas il n'y a rien à lister. La création, elle, signalera l'échec.
    if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(e.code)) return [];
    throw e;
  }

  return noms
    .filter((nom) => dateDuNom(nom) !== null)
    .sort()
    .reverse()
    .map((nom) => {
      const complet = path.join(dossier, nom);
      let taille = 0;
      try {
        taille = fs.statSync(complet).size;
      } catch (e) {
        // Fichier disparu entre la liste et la mesure : il sera simplement à zéro.
      }
      return { nom, chemin: complet, date: dateDuNom(nom).toISOString(), taille };
    });
}

/**
 * Supprime les sauvegardes excédentaires, les plus anciennes d'abord.
 * @returns {string[]} noms supprimés
 */
function appliquerRetention(dossier, retention = RETENTION_DEFAUT) {
  const surplus = listerSauvegardes(dossier).slice(retention);
  const supprimes = [];

  for (const { nom, chemin } of surplus) {
    try {
      fs.unlinkSync(chemin);
      supprimes.push(nom);
    } catch (e) {
      console.error(`Sauvegarde ${nom} non supprimée : ${e.message}`);
    }
  }
  return supprimes;
}

/**
 * Produit une sauvegarde immédiate.
 *
 * @param {import('sqlite').Database} db
 * @param {{dossier?: string, retention?: number}} [options]
 */
async function creerSauvegarde(db, options = {}) {
  const dossier = options.dossier || dossierParDefaut();
  const retention = options.retention || RETENTION_DEFAUT;

  // Le dossier peut viser un espace synchronisé absent au démarrage : on le
  // recrée sans supposer qu'il existe.
  fs.mkdirSync(dossier, { recursive: true });

  // VACUUM INTO refuse d'écraser un fichier existant, et c'est heureux : on
  // décale d'une milliseconde jusqu'à trouver un nom libre plutôt que
  // d'effacer une sauvegarde déjà là.
  let instant = new Date();
  let nom = `${PREFIXE}${horodatage(instant)}${EXTENSION}`;
  while (fs.existsSync(path.join(dossier, nom))) {
    instant = new Date(instant.getTime() + 1);
    nom = `${PREFIXE}${horodatage(instant)}${EXTENSION}`;
  }
  const chemin = path.join(dossier, nom);

  await db.run('VACUUM INTO ?', [chemin]);

  const supprimes = appliquerRetention(dossier, retention);
  return { nom, chemin, taille: fs.statSync(chemin).size, supprimes };
}

/** Date de la sauvegarde la plus récente d'un dossier, ou `null`. */
function derniereSauvegarde(dossier) {
  const [recente] = listerSauvegardes(dossier);
  return recente ? new Date(recente.date) : null;
}

/**
 * Produit une sauvegarde si la dernière remonte à plus de 24 h.
 * Appelée par le planificateur horaire ; ne lève jamais.
 */
async function sauvegardeSiNecessaire(db, maintenant = new Date()) {
  let reglages;
  try {
    reglages = await lireReglages(db);
  } catch (error) {
    console.error('Sauvegarde : réglages illisibles —', error.message);
    return { effectuee: false, raison: 'reglages' };
  }

  if (!reglages.active) return { effectuee: false, raison: 'desactivee' };

  try {
    // La lecture du dossier fait partie de ce qui peut échouer : elle appartient
    // donc au bloc protégé, sinon un dossier illisible remonte jusqu'au
    // planificateur et interrompt les tâches suivantes.
    const derniere = derniereSauvegarde(reglages.dossier);
    if (derniere && maintenant - derniere < INTERVALLE_MS) {
      return { effectuee: false, raison: 'recente' };
    }

    const resultat = await creerSauvegarde(db, reglages);
    console.log(`Sauvegarde créée : ${resultat.chemin}`);
    return { effectuee: true, ...resultat };
  } catch (error) {
    // Un dossier synchronisé hors ligne ne doit pas faire tomber l'application.
    console.error('Sauvegarde impossible :', error.message);
    return { effectuee: false, raison: 'echec', erreur: error.message };
  }
}

/**
 * Vérifie qu'un fichier est bien une base Clora exploitable.
 * Restaurer un fichier corrompu effacerait la comptabilité en place.
 */
async function verifierSauvegarde(chemin) {
  let base = null;
  try {
    base = await open({ filename: chemin, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY });

    const integrite = await base.get('PRAGMA integrity_check');
    const verdict = integrite && (integrite.integrity_check || Object.values(integrite)[0]);
    if (verdict !== 'ok') {
      throw new Error(`contrôle d'intégrité : ${verdict}`);
    }

    const table = await base.get(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'factures'"
    );
    if (!table) throw new Error('ce fichier ne contient pas de comptabilité Clora');

    return true;
  } finally {
    if (base) await base.close().catch(() => {});
  }
}

/**
 * Demande la restauration d'une sauvegarde.
 *
 * Le remplacement n'a pas lieu ici : la base est ouverte, et un fichier
 * substitué sous une connexion active — avec son journal WAL déjà en cours —
 * donnerait une base incohérente. On dépose un marqueur, appliqué au prochain
 * démarrage alors qu'aucune connexion n'est ouverte.
 */
async function demanderRestauration(chemin, dataDir = getDataDir()) {
  if (!fs.existsSync(chemin)) {
    throw Object.assign(new Error('Cette sauvegarde est introuvable.'), { status: 404 });
  }

  try {
    await verifierSauvegarde(chemin);
  } catch (error) {
    throw Object.assign(
      new Error(`Cette sauvegarde est inutilisable (${error.message}). Rien n'a été modifié.`),
      { status: 400 }
    );
  }

  const marqueur = path.join(dataDir, MARQUEUR);
  fs.writeFileSync(marqueur, JSON.stringify({ source: chemin, demandee_le: new Date().toISOString() }, null, 2));
  return { marqueur, source: chemin };
}

/**
 * Applique une restauration en attente, s'il y en a une.
 *
 * Appelée au démarrage, avant toute ouverture de la base. La base en place est
 * d'abord copiée de côté : une restauration sur le mauvais fichier resterait
 * réversible.
 *
 * @returns {null|{source: string, sauvegardeDeSecurite: string}}
 */
function appliquerRestaurationEnAttente(dbPath = getDbPath(), dataDir = getDataDir()) {
  const marqueur = path.join(dataDir, MARQUEUR);
  if (!fs.existsSync(marqueur)) return null;

  let demande;
  try {
    demande = JSON.parse(fs.readFileSync(marqueur, 'utf8'));
  } catch (error) {
    console.error('Marqueur de restauration illisible, ignoré :', error.message);
    fs.unlinkSync(marqueur);
    return null;
  }

  try {
    if (!demande.source || !fs.existsSync(demande.source)) {
      throw new Error('la sauvegarde demandée a disparu');
    }

    let secours = null;
    if (fs.existsSync(dbPath)) {
      secours = `${dbPath}.avant-restauration-${horodatage()}`;
      fs.copyFileSync(dbPath, secours);
    }

    fs.copyFileSync(demande.source, dbPath);

    // Le journal et l'index partagé de l'ancienne base décriraient des pages
    // qui n'existent plus dans celle qu'on vient de poser.
    for (const suffixe of ['-wal', '-shm']) {
      try {
        fs.unlinkSync(`${dbPath}${suffixe}`);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    }

    console.log(`Base restaurée depuis ${demande.source}`);
    return { source: demande.source, sauvegardeDeSecurite: secours };
  } catch (error) {
    console.error('Restauration impossible :', error.message);
    return null;
  } finally {
    // Réussie ou non, la demande ne doit pas se rejouer indéfiniment.
    try {
      fs.unlinkSync(marqueur);
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('Marqueur non supprimé :', e.message);
    }
  }
}

module.exports = {
  dossierParDefaut,
  lireReglages,
  listerSauvegardes,
  appliquerRetention,
  creerSauvegarde,
  derniereSauvegarde,
  sauvegardeSiNecessaire,
  verifierSauvegarde,
  demanderRestauration,
  appliquerRestaurationEnAttente,
  horodatage,
  dateDuNom,
  RETENTION_DEFAUT,
  INTERVALLE_MS,
  MARQUEUR
};
