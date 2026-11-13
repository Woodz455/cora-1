/**
 * Pièces justificatives jointes aux dépenses.
 *
 * Les autorités fiscales exigent de conserver les reçus six ans. Sans moyen de
 * les joindre, ils vivaient dans une boîte à chaussures ou un dossier à part,
 * et la dépense inscrite dans Clora ne renvoyait à rien.
 *
 * **Les fichiers ne vont pas dans la base.** Les sauvegardes recopient la base
 * entière chaque jour et en gardent trente : un reçu de 300 Ko y serait copié
 * trente fois, et quelques années de reçus feraient des dizaines de gigaoctets
 * dans le dossier synchronisé. Les pièces sont donc rangées à côté de la base,
 * dans `pieces/`, sous le nom de leur empreinte SHA-256 ; la base ne garde que
 * leur description.
 *
 * **Elles sont sauvegardées une fois chacune.** À chaque sauvegarde, les pièces
 * qui manquent au dossier de destination y sont déposées, chiffrées avec la
 * clé du dossier quand la protection est active. Leur nom étant leur empreinte,
 * une pièce n'est jamais réécrite ; elle n'est jamais effacée non plus, puisque
 * des sauvegardes plus anciennes peuvent la citer et qu'il faut la garder six
 * ans de toute façon.
 *
 * **Elles reviennent seules.** Une base restaurée sur un autre ordinateur cite
 * des pièces absentes de son disque : à la première lecture, la pièce est
 * reprise du dossier de sauvegarde, déchiffrée, et son empreinte vérifiée.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { httpError } = require('./httpUtils.js');
const { chiffrer, dechiffrer } = require('./chiffrementSauvegardes.js');
const { exigerPeriodeOuverte } = require('./verrouillage.js');

/** Taille maximale d'une pièce : une photo de téléphone ou un PDF numérisé. */
const TAILLE_MAX = 15 * 1024 * 1024;

/** Nombre maximal de pièces par dépense. */
const MAX_PAR_DEPENSE = 20;

/** Répertoire des pièces d'un dossier de sauvegarde, par série. */
const PREFIXE_DOSSIER_SAUVEGARDE = 'clora-pieces-';
const EXTENSION_CLAIRE = '.piece';
const EXTENSION_CHIFFREE = '.clora';

/**
 * Formats acceptés, reconnus à leur contenu et non à leur nom : un fichier
 * renommé en `.pdf` n'en devient pas un, et c'est le type reconnu qui part
 * dans l'en-tête quand la pièce est rouverte.
 */
const FORMATS = [
  { type: 'application/pdf', extension: '.pdf', reconnaitre: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { type: 'image/jpeg', extension: '.jpg', reconnaitre: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    type: 'image/png',
    extension: '.png',
    reconnaitre: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  },
  {
    type: 'image/webp',
    extension: '.webp',
    reconnaitre: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'
  }
];

/** Le format d'un contenu, ou `null` s'il n'est pas accepté. */
function reconnaitreFormat(tampon) {
  if (!tampon || tampon.length < 12) return null;
  return FORMATS.find((f) => f.reconnaitre(tampon)) || null;
}

const empreinteDe = (tampon) => crypto.createHash('sha256').update(tampon).digest('hex');

/** Une empreinte bien formée : le seul nom de fichier que ce module compose. */
const estEmpreinte = (valeur) => /^[0-9a-f]{64}$/.test(String(valeur));

/** Chemin du fichier d'une base ouverte. */
function fichierDeLaBase(db) {
  return (db && db.config && db.config.filename) || (db && db.__dbPath);
}

/** Répertoire local des pièces d'un dossier : à côté de sa base. */
function repertoireLocal(db) {
  return path.join(path.dirname(fichierDeLaBase(db)), 'pieces');
}

/**
 * Nom de fichier présentable : sans chemin, sans caractère de contrôle, ni
 * trop long. C'est ce nom que l'utilisateur retrouve en rouvrant la pièce.
 */
function nettoyerNom(nom, format) {
  let propre = String(nom || '').split(/[\\/]/).pop()
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .trim()
    .slice(0, 150);
  if (!propre) propre = `piece${format.extension}`;
  return propre;
}

/** Écrit un fichier d'un coup : un fichier à moitié écrit ne porte jamais le vrai nom. */
function ecrireAtomiquement(chemin, contenu) {
  const provisoire = `${chemin}.${crypto.randomBytes(4).toString('hex')}.partiel`;
  fs.writeFileSync(provisoire, contenu);
  fs.renameSync(provisoire, chemin);
}

/** Les pièces d'une dépense, de la plus ancienne à la plus récente. */
async function listerPieces(db, depenseId) {
  return db.all(
    `SELECT id, depense_id, nom, type, taille, empreinte, ajoute_le, ajoute_par
     FROM pieces_jointes WHERE depense_id = ? ORDER BY id ASC`,
    [depenseId]
  );
}

/**
 * Joint une pièce à une dépense.
 *
 * Permis même dans une période close : joindre le reçu d'une dépense déjà
 * déclarée complète la justification sans rien changer aux chiffres.
 *
 * @param {import('sqlite').Database} db
 * @param {number} depenseId
 * @param {{nom: string, contenu: Buffer, utilisateur?: string}} piece
 */
async function joindrePiece(db, depenseId, { nom, contenu, utilisateur = null }) {
  const depense = await db.get('SELECT id FROM depenses WHERE id = ?', [depenseId]);
  if (!depense) throw httpError(404, 'Dépense introuvable.');

  if (!Buffer.isBuffer(contenu) || contenu.length === 0) {
    throw httpError(400, 'Le fichier est vide.');
  }
  if (contenu.length > TAILLE_MAX) {
    throw httpError(413, 'Le fichier dépasse 15 Mo.');
  }
  const format = reconnaitreFormat(contenu);
  if (!format) {
    throw httpError(415, 'Seuls les PDF et les images JPEG, PNG ou WebP peuvent être joints.');
  }

  const { n } = await db.get('SELECT COUNT(*) AS n FROM pieces_jointes WHERE depense_id = ?', [depenseId]);
  if (n >= MAX_PAR_DEPENSE) {
    throw httpError(400, `Une dépense ne peut pas porter plus de ${MAX_PAR_DEPENSE} pièces.`);
  }

  const empreinte = empreinteDe(contenu);
  const repertoire = repertoireLocal(db);
  fs.mkdirSync(repertoire, { recursive: true });
  const chemin = path.join(repertoire, empreinte);
  // Même empreinte, même contenu : un reçu joint deux fois n'occupe qu'une place.
  if (!fs.existsSync(chemin)) ecrireAtomiquement(chemin, contenu);

  const resultat = await db.run(
    `INSERT INTO pieces_jointes (depense_id, nom, type, taille, empreinte, ajoute_le, ajoute_par)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [depenseId, nettoyerNom(nom, format), format.type, contenu.length, empreinte,
      new Date().toISOString(), utilisateur]
  );
  return db.get('SELECT * FROM pieces_jointes WHERE id = ?', [resultat.lastID]);
}

/**
 * Retire une pièce. Refusé dans une période close : la justification d'une
 * dépense déjà déclarée doit rester.
 *
 * Le fichier local n'est effacé que si plus aucune pièce ne le cite. Les
 * exemplaires déposés dans le dossier de sauvegarde restent : des sauvegardes
 * plus anciennes peuvent encore le citer.
 */
async function retirerPiece(db, pieceId) {
  const piece = await db.get(
    `SELECT p.*, d.date_depense, d.fournisseur FROM pieces_jointes p
     JOIN depenses d ON d.id = p.depense_id WHERE p.id = ?`,
    [pieceId]
  );
  if (!piece) throw httpError(404, 'Pièce introuvable.');
  await exigerPeriodeOuverte(db, [piece.date_depense]);

  await db.run('DELETE FROM pieces_jointes WHERE id = ?', [pieceId]);
  await effacerOrphelins(db, [piece.empreinte]);
  return piece;
}

/**
 * Efface du disque les fichiers que plus aucune pièce ne cite : après le
 * retrait d'une pièce, ou la suppression d'une dépense qui en portait.
 */
async function effacerOrphelins(db, empreintes) {
  for (const empreinte of new Set(empreintes)) {
    if (!estEmpreinte(empreinte)) continue;
    const { n } = await db.get('SELECT COUNT(*) AS n FROM pieces_jointes WHERE empreinte = ?', [empreinte]);
    if (n > 0) continue;
    try {
      fs.unlinkSync(path.join(repertoireLocal(db), empreinte));
    } catch (e) {
      if (e.code !== 'ENOENT') console.error(`Pièce ${empreinte.slice(0, 12)} : fichier local non effacé.`, e.message);
    }
  }
}

/** Répertoires de pièces présents dans un dossier de sauvegarde. */
function repertoiresDeSauvegarde(dossier) {
  try {
    return fs.readdirSync(dossier, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith(PREFIXE_DOSSIER_SAUVEGARDE))
      .map((e) => path.join(dossier, e.name));
  } catch (e) {
    return [];
  }
}

/**
 * Reprend une pièce absente du disque dans les dossiers de sauvegarde.
 *
 * Toutes les séries sont parcourues, et pas seulement celle du dossier : une
 * restauration peut avoir donné un nouvel identifiant à la base. C'est sans
 * risque, le nom étant l'empreinte du contenu, vérifiée après lecture.
 *
 * @returns {Promise<Buffer|null>}
 */
async function reprendreDesSauvegardes(db, empreinte) {
  // Import tardif : backupService dépend de ce module pour déposer les pièces.
  const { lireReglages, lireProtection, dossierParDefaut } = require('./backupService.js');
  const reglages = await lireReglages(db);
  const { cle } = await lireProtection(db);
  const dossiers = [...new Set([reglages.dossier, dossierParDefaut()])];

  for (const dossier of dossiers) {
    for (const repertoire of repertoiresDeSauvegarde(dossier)) {
      for (const extension of [EXTENSION_CHIFFREE, EXTENSION_CLAIRE]) {
        const chemin = path.join(repertoire, `${empreinte}${extension}`);
        if (!fs.existsSync(chemin)) continue;
        try {
          const brut = fs.readFileSync(chemin);
          const contenu = extension === EXTENSION_CHIFFREE ? dechiffrer(brut, cle || '') : brut;
          if (empreinteDe(contenu) === empreinte) return contenu;
        } catch (e) {
          // Clé différente, fichier abîmé : on cherche ailleurs.
        }
      }
    }
  }
  return null;
}

/**
 * Lit une pièce, en la reprenant des sauvegardes si elle manque sur ce poste.
 *
 * @returns {Promise<{piece: Object, contenu: Buffer}>}
 */
async function lirePiece(db, pieceId) {
  const piece = await db.get('SELECT * FROM pieces_jointes WHERE id = ?', [pieceId]);
  if (!piece) throw httpError(404, 'Pièce introuvable.');
  if (!estEmpreinte(piece.empreinte)) throw httpError(500, 'Pièce mal décrite dans la base.');

  const chemin = path.join(repertoireLocal(db), piece.empreinte);
  if (fs.existsSync(chemin)) {
    return { piece, contenu: fs.readFileSync(chemin) };
  }

  const repris = await reprendreDesSauvegardes(db, piece.empreinte);
  if (!repris) {
    throw httpError(404, 'Ce fichier est introuvable sur cet ordinateur et dans le dossier des sauvegardes.');
  }
  fs.mkdirSync(path.dirname(chemin), { recursive: true });
  ecrireAtomiquement(chemin, repris);
  return { piece, contenu: repris };
}

/**
 * Ouvre une pièce dans l'application que le système lui associe : la visionneuse
 * de photos, le lecteur PDF.
 *
 * Le serveur tourne dans le processus principal d'Electron et peut donc le
 * demander lui-même. Une copie est déposée dans le dossier temporaire, sous son
 * nom d'origine : c'est elle que l'application ouvre, l'original restant intact.
 *
 * @returns {Promise<boolean>} faux hors d'Electron
 */
async function ouvrirPiece(db, pieceId) {
  if (!process.versions || !process.versions.electron) return false;
  let shell;
  try {
    ({ shell } = require('electron'));
  } catch (e) {
    return false;
  }
  if (!shell) return false;

  const { piece, contenu } = await lirePiece(db, pieceId);
  const format = FORMATS.find((f) => f.type === piece.type);
  let nom = nettoyerNom(piece.nom, format || FORMATS[0]);
  if (format && !nom.toLowerCase().endsWith(format.extension)) nom += format.extension;

  const repertoire = path.join(os.tmpdir(), 'clora-pieces', piece.empreinte.slice(0, 16));
  fs.mkdirSync(repertoire, { recursive: true });
  const chemin = path.join(repertoire, nom);
  fs.writeFileSync(chemin, contenu);

  const erreur = await shell.openPath(chemin);
  if (erreur) throw httpError(500, `Le fichier n'a pas pu être ouvert : ${erreur}`);
  return true;
}

/**
 * Dépose dans le dossier de sauvegarde les pièces qui n'y sont pas encore.
 *
 * @param {import('sqlite').Database} db
 * @param {string} dossier dossier de destination des sauvegardes
 * @param {string} serie série du dossier d'entreprise
 * @param {?string} cle clé des sauvegardes, ou `null` sans protection
 * @returns {Promise<{deposees: number, manquantes: number}>}
 */
async function deposerPieces(db, dossier, serie, cle) {
  const lignes = await db.all('SELECT DISTINCT empreinte FROM pieces_jointes');
  if (lignes.length === 0) return { deposees: 0, manquantes: 0 };

  const destination = path.join(dossier, `${PREFIXE_DOSSIER_SAUVEGARDE}${serie}`);
  fs.mkdirSync(destination, { recursive: true });

  let deposees = 0;
  let manquantes = 0;
  for (const { empreinte } of lignes) {
    if (!estEmpreinte(empreinte)) continue;
    const chiffree = path.join(destination, `${empreinte}${EXTENSION_CHIFFREE}`);
    const claire = path.join(destination, `${empreinte}${EXTENSION_CLAIRE}`);
    // Une pièce déjà déposée sous la forme voulue est laissée telle quelle ;
    // un exemplaire en clair est remplacé quand la protection est active.
    if (fs.existsSync(cle ? chiffree : claire) || (!cle && fs.existsSync(chiffree))) continue;

    const source = path.join(repertoireLocal(db), empreinte);
    if (!fs.existsSync(source)) {
      manquantes += 1;
      continue;
    }
    const contenu = fs.readFileSync(source);
    if (cle) {
      ecrireAtomiquement(chiffree, chiffrer(contenu, cle, { serie, piece: empreinte }));
      if (fs.existsSync(claire)) fs.unlinkSync(claire);
    } else {
      ecrireAtomiquement(claire, contenu);
    }
    deposees += 1;
  }
  return { deposees, manquantes };
}

/**
 * Chiffre les pièces déposées d'une série avec une nouvelle clé : celles en
 * clair, à l'activation de la protection, et celles chiffrées avec l'ancienne,
 * à son remplacement. Même règle que pour les copies de la base.
 *
 * @returns {{rechiffrees: number, laissees: number}}
 */
function rechiffrerPieces(dossier, serie, { ancienne = null, nouvelle, inclureClaires = true }) {
  const repertoire = path.join(dossier, `${PREFIXE_DOSSIER_SAUVEGARDE}${serie}`);
  let noms = [];
  try {
    noms = fs.readdirSync(repertoire);
  } catch (e) {
    return { rechiffrees: 0, laissees: 0 };
  }

  let rechiffrees = 0;
  let laissees = 0;
  for (const nom of noms) {
    const chiffree = nom.endsWith(EXTENSION_CHIFFREE);
    if (!chiffree && !nom.endsWith(EXTENSION_CLAIRE)) continue;
    if (!chiffree && !inclureClaires) continue;
    if (chiffree && !ancienne) {
      laissees += 1;
      continue;
    }
    const empreinte = nom.slice(0, nom.lastIndexOf('.'));
    const chemin = path.join(repertoire, nom);
    try {
      const brut = fs.readFileSync(chemin);
      const contenu = chiffree ? dechiffrer(brut, ancienne) : brut;
      ecrireAtomiquement(
        path.join(repertoire, `${empreinte}${EXTENSION_CHIFFREE}`),
        chiffrer(contenu, nouvelle, { serie, piece: empreinte })
      );
      if (!chiffree) fs.unlinkSync(chemin);
      rechiffrees += 1;
    } catch (error) {
      console.error(`Pièce ${nom} non rechiffrée : ${error.message}`);
      laissees += 1;
    }
  }
  return { rechiffrees, laissees };
}

/**
 * Les pièces des dépenses d'une période, avec ce qui les décrit, dans l'ordre
 * des dépenses. La période suit les mêmes bornes que les registres et le
 * rapport de taxes : les reçus remis au comptable sont ceux des dépenses qu'il
 * retrouve dans la déclaration.
 *
 * @param {{annee?: string, mois?: string, trimestre?: string}} periode
 */
async function piecesDeLaPeriode(db, periode) {
  // Import tardif : invoiceService est lourd, et ce module est chargé tôt.
  const { clausesPeriode } = require('./invoiceService.js');
  const { conditions, params } = clausesPeriode('d.date_depense', periode);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return db.all(
    `SELECT p.id, p.nom, p.type, p.taille, p.empreinte,
            d.id AS depense_id, d.date_depense, d.fournisseur, d.description, d.categorie,
            d.montant_ht, d.tps, d.tvq, d.montant_ttc
     FROM pieces_jointes p
     JOIN depenses d ON d.id = p.depense_id
     ${where}
     ORDER BY d.date_depense ASC, d.id ASC, p.id ASC`,
    params
  );
}

/**
 * Nom d'un reçu dans l'archive remise au comptable : la date et le fournisseur
 * d'abord, pour que l'archive se trie d'elle-même, puis le nom d'origine. Les
 * caractères que Windows refuse dans un nom de fichier sont retirés.
 */
function nomDansLArchive(piece, dejaPris) {
  const format = FORMATS.find((f) => f.type === piece.type);
  const propre = (texte) => String(texte || '')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // L'extension d'origine est retirée, quelle que soit sa graphie (« .JPEG »,
  // « .jpg ») : c'est celle du format reconnu qui est remise.
  const origine = propre(propre(piece.nom).replace(/\.(pdf|jpe?g|png|webp)$/i, ''));
  const extension = format ? format.extension : '';
  const base = [piece.date_depense, propre(piece.fournisseur), origine]
    .filter(Boolean).join(' - ').slice(0, 120);

  let nom = `${base}${extension}`;
  for (let n = 2; dejaPris.has(nom.toLowerCase()); n += 1) nom = `${base} (${n})${extension}`;
  dejaPris.add(nom.toLowerCase());
  return nom;
}

module.exports = {
  piecesDeLaPeriode,
  nomDansLArchive,
  TAILLE_MAX,
  MAX_PAR_DEPENSE,
  PREFIXE_DOSSIER_SAUVEGARDE,
  reconnaitreFormat,
  listerPieces,
  joindrePiece,
  effacerOrphelins,
  retirerPiece,
  lirePiece,
  ouvrirPiece,
  deposerPieces,
  rechiffrerPieces,
  repertoireLocal
};
