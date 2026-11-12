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
 *
 * **Chaque dossier d'entreprise a sa série de sauvegardes.** Plusieurs dossiers
 * peuvent viser le même dossier de destination : celui de l'application par
 * défaut, ou le même dossier OneDrive pour tous les clients d'un comptable.
 * Les noms ne portaient alors que la date, si bien que la copie du premier
 * dossier passait pour « récente » aux yeux des autres, qui n'étaient jamais
 * sauvegardés, et que la rétention de l'un effaçait les copies de l'autre. Le
 * nom porte désormais l'identifiant permanent du dossier, rangé dans sa propre
 * base : il suit la comptabilité d'un ordinateur à l'autre.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const { getDataDir, getDbPath } = require('./config.js');
const { chiffrer, dechiffrer, estChiffre, empreinteDe } = require('./chiffrementSauvegardes.js');
const secrets = require('./secretStorage.js');

/** Préfixe et extensions des fichiers produits : en clair, ou chiffrés. */
const PREFIXE = 'clora-';
const EXTENSION = '.sqlite';
const EXTENSION_CHIFFREE = '.clora';

/**
 * Suffixe d'une copie en cours de dépôt. Le fichier ne prend son vrai nom
 * qu'une fois complet : un service de synchronisation ne voit jamais une
 * sauvegarde à moitié écrite, et le listage l'ignore.
 */
const PARTIEL = '.partiel';

/** Longueur de l'identifiant de série porté par le nom des sauvegardes. */
const LONGUEUR_SERIE = 12;

/**
 * Forme des noms : `clora-<série>-<horodatage>.sqlite` (`.clora` quand la
 * copie est chiffrée), ou l'ancienne forme, sans série, des versions
 * antérieures à la 1.9.1.
 */
const FORME_NOM = /^clora-(?:([0-9a-f]{12})-)?(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3})\.(sqlite|clora)$/;

/** Nombre de sauvegardes conservées à défaut de réglage. */
const RETENTION_DEFAUT = 30;

/** Délai au-delà duquel une nouvelle sauvegarde est due. */
const INTERVALLE_MS = 24 * 60 * 60 * 1000;

/**
 * Âge au-delà duquel un fichier de travail est réputé abandonné : une copie
 * interrompue par une coupure de courant, par exemple. En deçà, il peut
 * appartenir à une opération en cours, et on n'y touche pas.
 */
const AGE_ABANDON_MS = 60 * 60 * 1000;

/** Marqueur déposé pour qu'une restauration s'applique au prochain démarrage. */
const MARQUEUR = 'restauration-demandee.json';

/** Base préparée pour une restauration, posée à côté de la base qu'elle remplacera. */
const SUFFIXE_PREPARATION = '.restauration';

/**
 * Réglages propres au poste, que la restauration ne reprend pas de la copie :
 * restaurer une comptabilité ne doit ni rediriger ni couper les sauvegardes
 * de l'ordinateur où l'on travaille.
 */
const REGLAGES_DU_POSTE = [
  ['sauvegarde_active', 'INTEGER DEFAULT 1'],
  ['sauvegarde_dossier', 'TEXT'],
  ['sauvegarde_retention', 'INTEGER DEFAULT 30'],
  ['sauvegarde_cle', 'TEXT'],
  ['sauvegarde_cle_empreinte', 'TEXT']
];

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

/** Série de sauvegardes d'un dossier, tirée de son identifiant permanent. */
function serieDe(uid) {
  return uid ? String(uid).replace(/-/g, '').toLowerCase().slice(0, LONGUEUR_SERIE) : null;
}

function nomDeSauvegarde(serie, date, chiffree = false) {
  return `${PREFIXE}${serie}-${horodatage(date)}${chiffree ? EXTENSION_CHIFFREE : EXTENSION}`;
}

/**
 * Lit un nom de sauvegarde.
 * @returns {null|{serie: ?string, date: Date, chiffree: boolean}} `serie` vaut
 *   `null` pour l'ancienne forme.
 */
function analyserNom(nom) {
  const trouve = FORME_NOM.exec(nom);
  if (!trouve) return null;
  // 2026-08-01T03-12-00-123 -> 2026-08-01T03:12:00.123Z
  const iso = trouve[2].replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})$/, 'T$1:$2:$3.$4Z');
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return { serie: trouve[1] || null, date, chiffree: trouve[3] === 'clora' };
}

/** Extrait la date d'un nom de sauvegarde, ou `null` si le nom ne suit pas la forme. */
function dateDuNom(nom) {
  const analyse = analyserNom(nom);
  return analyse ? analyse.date : null;
}

/** Supprime un fichier, sans se plaindre s'il n'existe déjà plus. */
function supprimer(chemin) {
  try {
    fs.unlinkSync(chemin);
  } catch (e) {
    if (e.code !== 'ENOENT') console.error(`Fichier non supprimé (${chemin}) : ${e.message}`);
  }
}

/** Suffixe aléatoire, pour que deux opérations simultanées ne se marchent pas dessus. */
function aleatoire() {
  return crypto.randomBytes(3).toString('hex');
}

/** Retire d'un répertoire les fichiers de travail abandonnés qui commencent par `prefixe`. */
function nettoyerAbandons(repertoire, prefixe, suffixe = '') {
  let noms = [];
  try {
    noms = fs.readdirSync(repertoire);
  } catch (e) {
    return;
  }
  const limite = Date.now() - AGE_ABANDON_MS;
  for (const nom of noms) {
    if (!nom.startsWith(prefixe) || !nom.endsWith(suffixe)) continue;
    const chemin = path.join(repertoire, nom);
    try {
      if (fs.statSync(chemin).mtimeMs < limite) supprimer(chemin);
    } catch (e) {
      // Disparu entre la liste et la mesure : rien à faire.
    }
  }
}

/** Chemin du fichier d'une base ouverte. */
function fichierDeLaBase(db) {
  return (db && db.config && db.config.filename) || (db && db.__dbPath) || getDbPath();
}

/**
 * Compare deux chemins. Windows ignore la casse : `C:\Users` et `c:\users`
 * désignent le même fichier.
 */
function memeChemin(a, b) {
  if (!a || !b) return false;
  const normaliser = (p) => {
    const absolu = path.resolve(p);
    return process.platform === 'win32' ? absolu.toLowerCase() : absolu;
  };
  return normaliser(a) === normaliser(b);
}

/**
 * Identifiant permanent du dossier, créé au premier appel.
 *
 * Il est rangé dans la base elle-même, et non dans le registre des dossiers :
 * le registre est propre à une installation, alors que l'identifiant doit
 * suivre la comptabilité jusque dans ses sauvegardes, et jusque sur un nouvel
 * ordinateur après une restauration.
 */
async function identifiantDuDossier(db) {
  const lire = () => db.get(
    "SELECT dossier_uid FROM settings WHERE dossier_uid IS NOT NULL AND dossier_uid != '' ORDER BY id LIMIT 1"
  );
  const existant = await lire();
  const sansIdentifiant = await db.get(
    "SELECT id FROM settings WHERE dossier_uid IS NULL OR dossier_uid = '' LIMIT 1"
  );
  if (existant && !sansIdentifiant) return existant.dossier_uid;

  // Toute ligne de paramètres encore sans identifiant reçoit le même : une base
  // n'a qu'une identité, quelle que soit la ligne qu'une lecture retient.
  await db.run(
    "UPDATE settings SET dossier_uid = ? WHERE dossier_uid IS NULL OR dossier_uid = ''",
    [existant ? existant.dossier_uid : crypto.randomUUID()]
  );
  // Relu plutôt que supposé : deux appels simultanés retiennent ainsi le même.
  const retenu = await lire();
  if (!retenu) throw new Error("ce dossier n'a pas de paramètres");
  return retenu.dossier_uid;
}

/**
 * Lit l'identifiant d'un autre dossier, sans l'ouvrir pour de bon.
 * @returns {Promise<?string>} `null` pour un fichier absent ou antérieur à l'identifiant.
 */
async function lireIdentifiant(chemin) {
  if (!chemin || !fs.existsSync(chemin)) return null;
  let base = null;
  try {
    base = await open({ filename: chemin, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY });
    const ligne = await base.get(
      "SELECT dossier_uid FROM settings WHERE dossier_uid IS NOT NULL AND dossier_uid != '' ORDER BY id LIMIT 1"
    );
    return ligne ? ligne.dossier_uid : null;
  } catch (e) {
    return null;
  } finally {
    if (base) await base.close().catch(() => {});
  }
}

/**
 * Réglages de sauvegarde, avec repli sur les valeurs par défaut.
 * Les colonnes peuvent manquer sur une base ancienne : on ne suppose rien.
 */
async function lireReglages(db) {
  let ligne = null;
  try {
    ligne = await db.get(
      'SELECT sauvegarde_active, sauvegarde_dossier, sauvegarde_retention FROM settings ORDER BY id LIMIT 1'
    );
  } catch (e) {
    // Colonnes absentes : la migration n'a pas encore tourné.
  }

  let uid = null;
  try {
    uid = await identifiantDuDossier(db);
  } catch (e) {
    // Sans identifiant, `creerSauvegarde` échouera et le dira : mieux vaut
    // aucune copie qu'une copie anonyme, mêlée à celles des autres dossiers.
  }

  const retention = Number(ligne && ligne.sauvegarde_retention);
  return {
    active: !ligne || ligne.sauvegarde_active !== 0,
    dossier: (ligne && ligne.sauvegarde_dossier) || dossierParDefaut(),
    retention: Number.isInteger(retention) && retention > 0 ? retention : RETENTION_DEFAUT,
    uid
  };
}

/**
 * Protection des sauvegardes du dossier : la clé, si elle a été posée.
 *
 * La clé est gardée dans la base, par le coffre de Windows (`secretStorage`) :
 * les sauvegardes automatiques la trouvent sans rien demander, et une copie de
 * la base emportée ailleurs n'en contient qu'un bloc inexploitable. Son
 * empreinte est gardée à côté, en clair : elle dit qu'une clé est en vigueur
 * même quand le coffre ne sait plus la rendre.
 *
 * @returns {Promise<{active: boolean, lisible: boolean, empreinte: ?string, cle: ?string}>}
 */
async function lireProtection(db) {
  let ligne = null;
  try {
    ligne = await db.get('SELECT sauvegarde_cle, sauvegarde_cle_empreinte FROM settings ORDER BY id LIMIT 1');
  } catch (e) {
    // Colonnes absentes : aucune protection n'a pu être posée.
  }
  const empreinte = (ligne && ligne.sauvegarde_cle_empreinte) || null;
  if (!empreinte) return { active: false, lisible: false, empreinte: null, cle: null };
  const cle = (await secrets.lireSecret(db, 'sauvegarde_cle', ligne.sauvegarde_cle)) || null;
  const lisible = Boolean(cle) && empreinteDe(cle) === empreinte;
  return { active: true, lisible, empreinte, cle: lisible ? cle : null };
}

/** Enregistre la clé des sauvegardes du dossier, protégée par le coffre du système. */
async function enregistrerCle(db, cle) {
  await db.run(
    'UPDATE settings SET sauvegarde_cle = ?, sauvegarde_cle_empreinte = ?',
    [await secrets.chiffrer(cle), empreinteDe(cle)]
  );
}

/**
 * Sauvegardes présentes dans un dossier de destination, toutes séries
 * confondues, de la plus récente à la plus ancienne.
 *
 * Chaque entrée porte sa `serie` : celle d'un dossier d'entreprise, ou `null`
 * pour une sauvegarde antérieure à la 1.9.1, dont on ne sait pas de quel
 * dossier elle vient.
 */
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
    .map((nom) => ({ nom, analyse: analyserNom(nom) }))
    .filter(({ analyse }) => analyse !== null)
    .sort((a, b) => (b.analyse.date - a.analyse.date) || (a.nom < b.nom ? 1 : -1))
    .map(({ nom, analyse }) => {
      const complet = path.join(dossier, nom);
      let taille = 0;
      try {
        taille = fs.statSync(complet).size;
      } catch (e) {
        // Fichier disparu entre la liste et la mesure : il sera simplement à zéro.
      }
      return {
        nom, chemin: complet, date: analyse.date.toISOString(), taille, serie: analyse.serie, chiffree: analyse.chiffree
      };
    });
}

/** Sauvegardes d'une seule série, de la plus récente à la plus ancienne. */
function sauvegardesDeLaSerie(dossier, serie) {
  if (!serie) return [];
  return listerSauvegardes(dossier).filter((s) => s.serie === serie);
}

/**
 * Supprime les sauvegardes excédentaires d'une série, les plus anciennes
 * d'abord. Les autres séries, et les sauvegardes sans série, ne sont jamais
 * touchées : on ne supprime pas ce dont on ignore la provenance.
 *
 * @returns {string[]} noms supprimés
 */
function appliquerRetention(dossier, retention, serie) {
  if (!serie) throw new Error('série de sauvegardes non précisée');
  const surplus = sauvegardesDeLaSerie(dossier, serie).slice(retention);
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

/** Erreur rendue quand la clé du dossier n'est plus lisible sur ce poste. */
const CLE_ILLISIBLE = 'cle_illisible';

/**
 * Produit une sauvegarde immédiate.
 *
 * Quand le dossier est protégé, la copie est chiffrée avant de quitter le
 * répertoire de la base : aucune donnée en clair n'atteint le dossier de
 * destination. Si la clé n'est plus lisible sur ce poste, aucune copie n'est
 * faite plutôt qu'une copie en clair : l'alerte du tableau de bord le dit.
 *
 * La copie est d'abord produite à côté de la base, sur le disque de
 * l'ordinateur, puis déposée d'un coup dans le dossier de destination. Écrite
 * directement dans un dossier synchronisé, elle pouvait y rester à moitié
 * écrite si l'application était coupée, et un fichier incomplet passait alors
 * pour la sauvegarde du jour.
 *
 * @param {import('sqlite').Database} db
 * @param {{dossier?: string, retention?: number, uid?: string}} [options]
 */
async function creerSauvegarde(db, options = {}) {
  const dossier = options.dossier || dossierParDefaut();
  const retention = options.retention || RETENTION_DEFAUT;
  const serie = serieDe(options.uid || await identifiantDuDossier(db));
  const protection = options.protection || await lireProtection(db);
  if (protection.active && !protection.cle) {
    throw Object.assign(
      new Error("la clé des sauvegardes n'est plus lisible sur cet ordinateur"),
      { code: CLE_ILLISIBLE }
    );
  }

  // Le dossier peut viser un espace synchronisé absent au démarrage : on le
  // recrée sans supposer qu'il existe.
  fs.mkdirSync(dossier, { recursive: true });

  const fichier = fichierDeLaBase(db);
  const repertoireLocal = path.dirname(fichier);
  const prefixeLocal = `${path.basename(fichier)}.copie-`;
  nettoyerAbandons(repertoireLocal, prefixeLocal);
  nettoyerAbandons(dossier, `${PREFIXE}${serie}-`, PARTIEL);

  // On décale d'une milliseconde jusqu'à trouver un nom libre plutôt que
  // d'effacer une sauvegarde déjà là.
  let instant = new Date();
  let nom = nomDeSauvegarde(serie, instant, protection.active);
  while (fs.existsSync(path.join(dossier, nom)) || fs.existsSync(path.join(dossier, `${nom}${PARTIEL}`))) {
    instant = new Date(instant.getTime() + 1);
    nom = nomDeSauvegarde(serie, instant, protection.active);
  }
  const chemin = path.join(dossier, nom);
  const partiel = `${chemin}${PARTIEL}`;
  const local = path.join(repertoireLocal, `${prefixeLocal}${horodatage(instant)}-${aleatoire()}`);

  try {
    await db.run('VACUUM INTO ?', [local]);
    if (protection.active) {
      const contenu = chiffrer(fs.readFileSync(local), protection.cle, { serie, cree_le: instant.toISOString() });
      fs.writeFileSync(partiel, contenu);
    } else {
      fs.copyFileSync(local, partiel);
    }
    fs.renameSync(partiel, chemin);
  } finally {
    supprimer(local);
    supprimer(partiel);
  }

  const supprimes = appliquerRetention(dossier, retention, serie);
  return { nom, chemin, taille: fs.statSync(chemin).size, supprimes };
}

/**
 * Chiffre avec une nouvelle clé les sauvegardes d'une série.
 *
 * À l'activation, les copies en clair déjà parties dans le dossier
 * synchronisé y resteraient lisibles : elles sont chiffrées à leur tour, et la
 * version en clair supprimée. Au remplacement d'une clé, les copies chiffrées
 * avec l'ancienne le sont avec la nouvelle : une seule clé ouvre ainsi toute
 * la série. Une copie qu'on ne sait pas ouvrir est laissée telle quelle.
 *
 * Les copies sans série, antérieures à la 1.9.1, ne sont pas touchées : rien
 * ne dit qu'elles viennent de ce dossier, et les chiffrer avec sa clé les
 * rendrait illisibles au dossier qui les a produites.
 *
 * @returns {{rechiffrees: number, laissees: number}}
 */
function rechiffrerSerie(dossier, serie, { ancienne = null, nouvelle, inclureClaires = true }) {
  let rechiffrees = 0;
  let laissees = 0;
  for (const sauvegarde of sauvegardesDeLaSerie(dossier, serie)) {
    if (!sauvegarde.chiffree && !inclureClaires) continue;
    if (sauvegarde.chiffree && !ancienne) {
      laissees += 1;
      continue;
    }
    const final = path.join(dossier, sauvegarde.nom.replace(/\.(sqlite|clora)$/, EXTENSION_CHIFFREE));
    const partiel = `${final}${PARTIEL}`;
    try {
      const contenu = fs.readFileSync(sauvegarde.chemin);
      const clair = sauvegarde.chiffree ? dechiffrer(contenu, ancienne) : contenu;
      fs.writeFileSync(partiel, chiffrer(clair, nouvelle, { serie, cree_le: sauvegarde.date }));
      fs.renameSync(partiel, final);
      if (final !== sauvegarde.chemin) supprimer(sauvegarde.chemin);
      rechiffrees += 1;
    } catch (error) {
      supprimer(partiel);
      console.error(`Sauvegarde ${sauvegarde.nom} non rechiffrée : ${error.message}`);
      laissees += 1;
    }
  }
  return { rechiffrees, laissees };
}

/** Copies en clair d'avant la 1.9.1 présentes dans le dossier de destination. */
function anciennesEnClair(dossier) {
  return listerSauvegardes(dossier).filter((s) => s.serie === null && !s.chiffree).length;
}

/**
 * Ce que le tableau de bord doit signaler à propos des sauvegardes.
 *
 * - `cle_illisible` : le dossier est protégé mais ce poste ne sait plus lire
 *   la clé ; aucune copie n'est faite tant qu'on ne l'a pas ressaisie ;
 * - `en_retard` : la dernière copie réussie a plus de trois jours, par exemple
 *   parce que le dossier synchronisé est hors ligne ;
 * - `aucune` : aucune copie n'a jamais réussi, passé le premier jour.
 *
 * @param {{creeLe?: ?string, maintenant?: Date}} [options] `creeLe` : date de
 *   création du dossier, au format de SQLite (UTC)
 */
async function etatDesSauvegardes(db, { creeLe = null, maintenant = new Date() } = {}) {
  const reglages = await lireReglages(db);
  if (!reglages.active) return { alerte: null, derniere: null, sur_place: false };

  // Les copies restent-elles dans le dossier de données, donc sur le même
  // disque que la comptabilité ? Elles ne protègent alors ni d'une panne de
  // disque ni d'un vol. Ce n'est pas une alerte, les copies se font ; c'est un
  // rappel, qui dure tant que le dossier n'a pas été déplacé.
  const sur_place = memeChemin(reglages.dossier, dossierParDefaut());

  const protection = await lireProtection(db);
  const derniere = derniereSauvegarde(reglages.dossier, serieDe(reglages.uid));
  const iso = derniere ? derniere.toISOString() : null;
  if (protection.active && !protection.lisible) return { alerte: 'cle_illisible', derniere: iso, sur_place };
  if (derniere) {
    return { alerte: maintenant - derniere > 3 * INTERVALLE_MS ? 'en_retard' : null, derniere: iso, sur_place };
  }
  const cree = creeLe ? new Date(`${String(creeLe).replace(' ', 'T')}Z`) : null;
  const age = cree && !Number.isNaN(cree.getTime()) ? maintenant - cree : Infinity;
  return { alerte: age > INTERVALLE_MS ? 'aucune' : null, derniere: null, sur_place };
}

/** Date de la sauvegarde la plus récente d'une série, ou `null`. */
function derniereSauvegarde(dossier, serie) {
  const [recente] = sauvegardesDeLaSerie(dossier, serie);
  return recente ? new Date(recente.date) : null;
}

/**
 * Produit une sauvegarde si la dernière de ce dossier remonte à plus de 24 h.
 * Appelée par le planificateur horaire ; ne lève jamais.
 */
async function sauvegardeSiNecessaire(db, maintenant = new Date()) {
  let reglages;
  try {
    reglages = await lireReglages(db);
  } catch (error) {
    console.error('Sauvegarde : réglages illisibles.', error.message);
    return { effectuee: false, raison: 'reglages' };
  }

  if (!reglages.active) return { effectuee: false, raison: 'desactivee' };

  try {
    // La lecture du dossier fait partie de ce qui peut échouer : elle appartient
    // donc au bloc protégé, sinon un dossier illisible remonte jusqu'au
    // planificateur et interrompt les tâches suivantes.
    const derniere = derniereSauvegarde(reglages.dossier, serieDe(reglages.uid));
    if (derniere && maintenant - derniere < INTERVALLE_MS) {
      return { effectuee: false, raison: 'recente' };
    }

    const resultat = await creerSauvegarde(db, reglages);
    console.log(`Sauvegarde créée : ${resultat.chemin}`);
    return { effectuee: true, ...resultat };
  } catch (error) {
    // Un dossier synchronisé hors ligne ne doit pas faire tomber l'application.
    console.error('Sauvegarde impossible :', error.message);
    return { effectuee: false, raison: error.code === CLE_ILLISIBLE ? 'cle' : 'echec', erreur: error.message };
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

/** Comme `verifierSauvegarde`, avec le message destiné à l'utilisateur. */
async function verifierOuRefuser(chemin) {
  try {
    await verifierSauvegarde(chemin);
  } catch (error) {
    throw Object.assign(
      new Error(`Cette sauvegarde est inutilisable (${error.message}). Rien n'a été modifié.`),
      { status: 400 }
    );
  }
}

/**
 * Pose à `destination` une copie en clair d'une sauvegarde, déchiffrée s'il le
 * faut avec la clé du dossier ou celle que l'utilisateur vient de saisir.
 *
 * @param {{cleDuDossier?: ?string, cleSaisie?: ?string}} cles formes brutes
 * @returns {?string} la clé qui a servi, ou `null` pour une copie en clair
 */
function copieEnClair(source, destination, { cleDuDossier = null, cleSaisie = null } = {}) {
  const contenu = fs.readFileSync(source);
  if (!estChiffre(contenu)) {
    fs.writeFileSync(destination, contenu);
    return null;
  }
  for (const cle of [cleDuDossier, cleSaisie].filter(Boolean)) {
    try {
      fs.writeFileSync(destination, dechiffrer(contenu, cle));
      return cle;
    } catch (error) {
      if (error.code === 'cle_incorrecte') continue;
      if (error.code === 'fichier_altere') {
        throw Object.assign(new Error(
          "Cette sauvegarde a été modifiée ou est incomplète : elle ne peut pas être déchiffrée. Rien n'a été modifié."
        ), { status: 400 });
      }
      throw Object.assign(new Error(`Cette sauvegarde est inutilisable (${error.message}). Rien n'a été modifié.`), { status: 400 });
    }
  }
  // 409 : l'interface demande alors la clé, ou une autre.
  throw Object.assign(new Error(cleSaisie
    ? 'Cette clé ne correspond pas à cette sauvegarde.'
    : 'Cette sauvegarde est chiffrée : saisissez la clé imprimée sur la feuille de secours.'), { status: 409 });
}

/** Compte les lignes d'une table, ou `null` si elle n'existe pas dans cette copie. */
async function compter(base, table) {
  try {
    return (await base.get(`SELECT COUNT(*) AS c FROM ${table}`)).c;
  } catch (e) {
    return null;
  }
}

/**
 * Décrit le contenu d'une sauvegarde avant qu'on la restaure.
 *
 * Le dossier de destination peut contenir les copies d'un autre dossier, d'un
 * autre ordinateur ou d'une version antérieure : on montre l'entreprise qu'elle
 * contient plutôt que de laisser restaurer sur la foi d'une date. La lecture se
 * fait sur une copie posée à côté de la base, jamais dans le dossier
 * synchronisé, et la copie est aussitôt effacée.
 *
 * @param {string} source fichier de sauvegarde
 * @param {string} cible base du dossier ouvert
 * @param {?string} uid identifiant du dossier ouvert
 */
async function examinerSauvegarde(source, cible, uid, cles = {}) {
  if (!fs.existsSync(source)) {
    throw Object.assign(new Error('Cette sauvegarde est introuvable.'), { status: 404 });
  }

  const repertoire = path.dirname(cible);
  const prefixe = `${path.basename(cible)}.examen-`;
  nettoyerAbandons(repertoire, prefixe);
  const copie = path.join(repertoire, `${prefixe}${horodatage()}-${aleatoire()}`);

  try {
    const cle = copieEnClair(source, copie, cles);
    await verifierOuRefuser(copie);

    const base = await open({ filename: copie, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY });
    try {
      // `SELECT *` : une copie ancienne peut ne pas avoir toutes les colonnes.
      const reglages = (await base.get('SELECT * FROM settings ORDER BY id LIMIT 1')) || {};
      const uidCopie = reglages.dossier_uid || null;
      return {
        entreprise: reglages.entreprise_nom || '',
        factures: await compter(base, 'factures'),
        clients: await compter(base, 'clients'),
        chiffree: cle !== null,
        // `null` : copie antérieure à l'identifiant, sa provenance est inconnue.
        meme_dossier: uidCopie ? uidCopie === uid : null
      };
    } finally {
      await base.close().catch(() => {});
    }
  } finally {
    supprimer(copie);
  }
}

/**
 * Accorde une base préparée au poste où on la restaure.
 *
 * - Les réglages de sauvegarde restent ceux du poste : une copie faite sur un
 *   autre ordinateur pointerait vers un dossier qui n'existe pas ici.
 * - L'identifiant : une copie qui en porte un le garde, c'est la même
 *   comptabilité ; une copie ancienne, qui n'en a pas, prend celui du dossier
 *   où on la restaure ; une copie dont l'identifiant appartient déjà à un autre
 *   dossier de ce poste en reçoit un nouveau, car c'est une copie de ce
 *   dossier-là, et deux dossiers ne doivent jamais partager une série.
 */
async function adapterAuPoste(preparation, { uid = null, poste = null, uidsAilleurs = [] } = {}) {
  const base = await open({ filename: preparation, driver: sqlite3.Database });
  try {
    // La base préparée n'a pas à tenir de journal à part : elle repassera en
    // WAL à sa première ouverture, une fois en place.
    await base.exec('PRAGMA journal_mode = DELETE');

    const colonnes = new Set((await base.all('PRAGMA table_info(settings)')).map((c) => c.name));
    for (const [colonne, definition] of [['dossier_uid', 'TEXT'], ...REGLAGES_DU_POSTE]) {
      if (!colonnes.has(colonne)) await base.exec(`ALTER TABLE settings ADD COLUMN ${colonne} ${definition}`);
    }

    const ligne = await base.get(
      "SELECT dossier_uid FROM settings WHERE dossier_uid IS NOT NULL AND dossier_uid != '' ORDER BY id LIMIT 1"
    );
    const uidCopie = ligne ? ligne.dossier_uid : null;
    let identite = uidCopie || uid || crypto.randomUUID();
    if (uidCopie && uidCopie !== uid && uidsAilleurs.includes(uidCopie)) identite = crypto.randomUUID();

    const affectations = ['dossier_uid = ?'];
    const valeurs = [identite];
    if (poste) {
      for (const [colonne] of REGLAGES_DU_POSTE) {
        affectations.push(`${colonne} = ?`);
        valeurs.push(poste[colonne] === undefined ? null : poste[colonne]);
      }
    }
    await base.run(`UPDATE settings SET ${affectations.join(', ')}`, valeurs);
  } finally {
    await base.close();
  }
}

/**
 * Demande la restauration d'une sauvegarde dans une base donnée.
 *
 * Le remplacement n'a pas lieu ici : la base est ouverte, et un fichier
 * substitué sous une connexion active, avec son journal WAL déjà en cours,
 * donnerait une base incohérente. La copie est donc préparée et vérifiée à
 * côté de la base, puis un marqueur qui désigne précisément sa cible est
 * déposé dans le même répertoire ; il s'applique au prochain démarrage, avant
 * qu'aucune connexion ne soit ouverte.
 *
 * Le marqueur était déposé à la racine des données. Les dossiers d'entreprise
 * vivant dans des sous-répertoires, une restauration ne s'appliquait jamais,
 * ou s'appliquait au premier dossier quand celui-ci occupait la racine.
 *
 * @param {string} source fichier de sauvegarde
 * @param {string} cible base à remplacer
 * @param {{uid?: string, poste?: Object, uidsAilleurs?: string[]}} [contexte]
 *   identifiant et réglages du dossier remplacé, identifiants des autres
 *   dossiers du poste
 */
async function demanderRestauration(source, cible, contexte = {}) {
  if (!cible) throw new Error('base à restaurer non précisée');
  if (!fs.existsSync(source)) {
    throw Object.assign(new Error('Cette sauvegarde est introuvable.'), { status: 404 });
  }

  const preparation = `${cible}${SUFFIXE_PREPARATION}`;
  supprimer(preparation);
  try {
    const cle = copieEnClair(source, preparation, contexte.cles);
    await verifierOuRefuser(preparation);

    // La clé qui vient d'ouvrir la copie devient celle du dossier quand il n'en
    // avait pas, ou que le coffre de ce poste ne savait plus la rendre : c'est
    // le cas d'une reprise sur un nouvel ordinateur, et les sauvegardes
    // suivantes restent chiffrées avec la même clé.
    let poste = contexte.poste;
    if (cle && poste && (!poste.sauvegarde_cle_empreinte || poste.sauvegarde_cle_empreinte === empreinteDe(cle))) {
      poste = { ...poste, sauvegarde_cle: await secrets.chiffrer(cle), sauvegarde_cle_empreinte: empreinteDe(cle) };
    }
    await adapterAuPoste(preparation, { ...contexte, poste });
  } catch (error) {
    supprimer(preparation);
    throw error;
  }

  const marqueur = path.join(path.dirname(cible), MARQUEUR);
  fs.writeFileSync(marqueur, JSON.stringify({
    cible,
    source: preparation,
    origine: source,
    demandee_le: new Date().toISOString()
  }, null, 2));
  return { marqueur, source: preparation, origine: source };
}

/** Met la base préparée à sa place. Un renommage, sinon une copie. */
function mettreEnPlace(preparation, dbPath) {
  try {
    fs.renameSync(preparation, dbPath);
  } catch (e) {
    // Un antivirus qui retient le fichier, par exemple : la copie reste sûre.
    fs.copyFileSync(preparation, dbPath);
    supprimer(preparation);
  }
}

/**
 * Applique une restauration en attente, s'il y en a une pour cette base.
 *
 * Appelée au démarrage, avant toute ouverture de la base. La base en place est
 * d'abord copiée de côté, avec son journal WAL, qui contient les dernières
 * écritures : une restauration sur le mauvais fichier resterait réversible.
 *
 * Une demande qui ne désigne pas cette base est écartée sans rien toucher :
 * c'est le cas des demandes laissées par les versions antérieures, qui ne
 * nommaient pas leur cible.
 *
 * @returns {null|{source: string, sauvegardeDeSecurite: string}}
 */
function appliquerRestaurationEnAttente(dbPath = getDbPath(), dataDir = path.dirname(dbPath)) {
  const marqueur = path.join(dataDir, MARQUEUR);
  if (!fs.existsSync(marqueur)) return null;

  let demande;
  try {
    demande = JSON.parse(fs.readFileSync(marqueur, 'utf8'));
  } catch (error) {
    console.error('Marqueur de restauration illisible, ignoré :', error.message);
    supprimer(marqueur);
    return null;
  }

  try {
    if (!demande || !memeChemin(demande.cible, dbPath)) {
      throw new Error('la demande ne désigne pas ce dossier, elle est écartée');
    }
    if (!demande.source || !fs.existsSync(demande.source)) {
      throw new Error('la sauvegarde demandée a disparu');
    }

    let secours = null;
    if (fs.existsSync(dbPath)) {
      secours = `${dbPath}.avant-restauration-${horodatage()}`;
      fs.copyFileSync(dbPath, secours);
      if (fs.existsSync(`${dbPath}-wal`)) fs.copyFileSync(`${dbPath}-wal`, `${secours}-wal`);
    }

    // Le journal et l'index partagé de l'ancienne base décriraient des pages
    // qui n'existent plus dans celle qu'on vient de poser.
    for (const suffixe of ['-wal', '-shm']) {
      try {
        fs.unlinkSync(`${dbPath}${suffixe}`);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    }

    mettreEnPlace(demande.source, dbPath);

    const origine = demande.origine || demande.source;
    console.log(`Base restaurée depuis ${origine}`);
    return { source: origine, sauvegardeDeSecurite: secours };
  } catch (error) {
    console.error('Restauration impossible :', error.message);
    return null;
  } finally {
    // Réussie ou non, la demande ne doit pas se rejouer indéfiniment.
    supprimer(marqueur);
  }
}

module.exports = {
  dossierParDefaut,
  lireReglages,
  lireProtection,
  enregistrerCle,
  rechiffrerSerie,
  anciennesEnClair,
  etatDesSauvegardes,
  identifiantDuDossier,
  lireIdentifiant,
  serieDe,
  listerSauvegardes,
  sauvegardesDeLaSerie,
  appliquerRetention,
  creerSauvegarde,
  derniereSauvegarde,
  sauvegardeSiNecessaire,
  verifierSauvegarde,
  examinerSauvegarde,
  demanderRestauration,
  appliquerRestaurationEnAttente,
  horodatage,
  dateDuNom,
  analyserNom,
  memeChemin,
  RETENTION_DEFAUT,
  INTERVALLE_MS,
  AGE_ABANDON_MS,
  MARQUEUR,
  SUFFIXE_PREPARATION,
  PARTIEL,
  EXTENSION_CHIFFREE,
  CLE_ILLISIBLE
};
