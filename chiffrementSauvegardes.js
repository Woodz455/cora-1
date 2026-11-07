/**
 * Chiffrement des sauvegardes.
 *
 * Les sauvegardes partent le plus souvent dans un dossier synchronisé : c'est
 * ce qui les met à l'abri d'un disque en panne ou d'un vol, mais c'est aussi
 * la comptabilité entière, et les coordonnées des clients, confiées à un
 * service en ligne. Chiffrées, elles ne se lisent pas sans la clé que
 * l'entreprise a imprimée.
 *
 * Format d'un fichier `.clora` :
 *
 *     CLORASV1 | longueur de l'en-tête (4 octets) | en-tête JSON | données | étiquette (16 octets)
 *
 * - AES-256-GCM, avec la bibliothèque de chiffrement de Node : aucune
 *   dépendance de plus. Toute modification du fichier, en-tête compris, est
 *   détectée par l'étiquette d'authentification.
 * - La clé de chiffrement de chaque fichier est dérivée de la clé imprimée et
 *   d'un sel propre au fichier (HKDF-SHA256). La clé imprimée porte 120 bits
 *   tirés au hasard : une dérivation lente, nécessaire pour un mot de passe
 *   choisi, n'ajouterait rien.
 * - L'en-tête porte l'empreinte de la clé (16 caractères, qui ne permettent pas
 *   de la retrouver) : une clé erronée est reconnue aussitôt, sans tenter de
 *   déchiffrer, et le message peut dire « mauvaise clé » plutôt que « fichier
 *   corrompu ».
 *
 * Le format est documenté pour que la comptabilité reste récupérable même si
 * Clora ne démarre plus : `scripts/dechiffrer-sauvegarde.js` le fait seul.
 */

const crypto = require('crypto');
const fs = require('fs');

const SIGNATURE = Buffer.from('CLORASV1', 'ascii');
const VERSION = 1;
const LONGUEUR_ETIQUETTE = 16;

/** Erreur dont le code dit à l'appelant quoi répondre. */
function erreur(code, message) {
  return Object.assign(new Error(message), { code });
}

/** Empreinte d'une clé, sous sa forme brute (voir `codesSecours.js`). */
function empreinteDe(cle) {
  return Buffer.from(
    crypto.hkdfSync('sha256', Buffer.from(cle, 'utf8'), Buffer.alloc(0), 'clora-empreinte-v1', 8)
  ).toString('hex');
}

function deriver(cle, sel) {
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(cle, 'utf8'), sel, 'clora-sauvegarde-v1', 32));
}

/** Indique si un contenu commence par la signature d'une sauvegarde chiffrée. */
function estChiffre(contenu) {
  return contenu.length >= SIGNATURE.length && contenu.subarray(0, SIGNATURE.length).equals(SIGNATURE);
}

/**
 * Chiffre le contenu d'une base.
 * @param {Buffer} clair
 * @param {string} cle forme brute
 * @param {Object} [metadonnees] série, date : rangées dans l'en-tête, en clair
 */
function chiffrer(clair, cle, metadonnees = {}) {
  const sel = crypto.randomBytes(16);
  const nonce = crypto.randomBytes(12);
  const entete = Buffer.from(JSON.stringify({
    v: VERSION,
    ...metadonnees,
    empreinte: empreinteDe(cle),
    sel: sel.toString('base64'),
    nonce: nonce.toString('base64')
  }), 'utf8');
  const longueur = Buffer.alloc(4);
  longueur.writeUInt32BE(entete.length);
  const prefixe = Buffer.concat([SIGNATURE, longueur, entete]);

  const chiffreur = crypto.createCipheriv('aes-256-gcm', deriver(cle, sel), nonce);
  chiffreur.setAAD(prefixe);
  const donnees = Buffer.concat([chiffreur.update(clair), chiffreur.final()]);
  return Buffer.concat([prefixe, donnees, chiffreur.getAuthTag()]);
}

/** Lit l'en-tête d'un contenu chiffré. */
function lireEntete(contenu) {
  if (!estChiffre(contenu) || contenu.length < SIGNATURE.length + 4) {
    throw erreur('format_inconnu', "ce fichier n'est pas une sauvegarde chiffrée de Clora");
  }
  const longueur = contenu.readUInt32BE(SIGNATURE.length);
  const debut = SIGNATURE.length + 4;
  if (longueur > 64 * 1024 || debut + longueur + LONGUEUR_ETIQUETTE > contenu.length) {
    throw erreur('fichier_altere', 'en-tête de sauvegarde illisible');
  }
  let entete;
  try {
    entete = JSON.parse(contenu.subarray(debut, debut + longueur).toString('utf8'));
  } catch (e) {
    throw erreur('fichier_altere', 'en-tête de sauvegarde illisible');
  }
  if (entete.v !== VERSION) {
    throw erreur('format_inconnu', 'sauvegarde produite par une version plus récente de Clora');
  }
  return { entete, finEntete: debut + longueur };
}

/** Lit l'en-tête d'un fichier sans en charger le contenu. */
function lireEnteteFichier(chemin) {
  const descripteur = fs.openSync(chemin, 'r');
  try {
    const tete = Buffer.alloc(SIGNATURE.length + 4);
    fs.readSync(descripteur, tete, 0, tete.length, 0);
    if (!estChiffre(tete)) return null;
    const longueur = Math.min(tete.readUInt32BE(SIGNATURE.length), 64 * 1024);
    const tout = Buffer.alloc(tete.length + longueur + LONGUEUR_ETIQUETTE);
    fs.readSync(descripteur, tout, 0, tout.length, 0);
    return lireEntete(tout).entete;
  } finally {
    fs.closeSync(descripteur);
  }
}

/**
 * Déchiffre un contenu.
 * @throws {Error} `cle_incorrecte` si l'empreinte ne correspond pas,
 *   `fichier_altere` si le contenu a été modifié ou tronqué.
 */
function dechiffrer(contenu, cle) {
  const { entete, finEntete } = lireEntete(contenu);
  if (entete.empreinte !== empreinteDe(cle)) {
    throw erreur('cle_incorrecte', 'cette clé ne correspond pas à cette sauvegarde');
  }
  const dechiffreur = crypto.createDecipheriv(
    'aes-256-gcm', deriver(cle, Buffer.from(entete.sel, 'base64')), Buffer.from(entete.nonce, 'base64')
  );
  dechiffreur.setAAD(contenu.subarray(0, finEntete));
  dechiffreur.setAuthTag(contenu.subarray(contenu.length - LONGUEUR_ETIQUETTE));
  try {
    return Buffer.concat([
      dechiffreur.update(contenu.subarray(finEntete, contenu.length - LONGUEUR_ETIQUETTE)),
      dechiffreur.final()
    ]);
  } catch (e) {
    throw erreur('fichier_altere', 'la sauvegarde a été modifiée ou est incomplète');
  }
}

module.exports = { chiffrer, dechiffrer, lireEntete, lireEnteteFichier, estChiffre, empreinteDe, SIGNATURE };
