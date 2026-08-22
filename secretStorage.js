/**
 * Chiffrement des secrets au repos.
 *
 * Le mot de passe du serveur d'envoi est enregistré dans `database.sqlite`, que
 * les sauvegardes automatiques recopient vers un dossier souvent synchronisé —
 * OneDrive, Dropbox, un disque réseau. En clair, il partirait dans le nuage à
 * chaque copie, et une sauvegarde égarée livrerait la boîte courriel de
 * l'entreprise.
 *
 * `safeStorage` d'Electron s'appuie sur le coffre du système d'exploitation
 * (DPAPI sous Windows) : la valeur n'est déchiffrable que par le même compte
 * utilisateur, sur la même machine. Une sauvegarde emportée ailleurs ne
 * contient qu'un bloc inexploitable — ce qui est exactement le comportement
 * recherché.
 *
 * Hors Electron — serveur lancé seul, tests — le coffre n'existe pas. La valeur
 * est alors encodée sans être protégée, et le préfixe le dit franchement plutôt
 * que de laisser croire à un chiffrement qui n'a pas eu lieu.
 */

/** Valeur protégée par le coffre du système. */
const PREFIXE_COFFRE = 'coffre:';

/** Valeur simplement encodée : aucun coffre n'était disponible à l'écriture. */
const PREFIXE_CLAIR = 'clair:';

/**
 * Accès au coffre, résolu à chaque appel plutôt qu'au chargement du module.
 *
 * `isEncryptionAvailable()` exige qu'Electron soit initialisé ; l'interroger au
 * `require` renverrait faux au démarrage et condamnerait toute la session à
 * écrire en clair.
 */
function coffre() {
  if (!process.versions || !process.versions.electron) return null;
  try {
    const { safeStorage } = require('electron');
    if (safeStorage && safeStorage.isEncryptionAvailable()) return safeStorage;
  } catch (e) {
    // Electron indisponible : le repli en clair s'applique.
  }
  return null;
}

/** Indique si les secrets écrits maintenant seront réellement protégés. */
function coffreDisponible() {
  return coffre() !== null;
}

/**
 * Chiffre un secret en vue de son enregistrement.
 * Une valeur vide reste vide : elle ne représente pas un secret.
 */
function chiffrer(texte) {
  if (texte === null || texte === undefined || texte === '') return '';

  const s = coffre();
  if (s) {
    return PREFIXE_COFFRE + s.encryptString(String(texte)).toString('base64');
  }
  return PREFIXE_CLAIR + Buffer.from(String(texte), 'utf8').toString('base64');
}

/**
 * Déchiffre un secret enregistré.
 *
 * Renvoie une chaîne vide lorsque la valeur est illisible — base restaurée sur
 * une autre machine, ou sous un autre compte Windows. L'appelant traite alors
 * la configuration comme absente et invite à la ressaisir, ce qui est
 * préférable à une erreur incompréhensible au moment d'envoyer une facture.
 */
function dechiffrer(valeur) {
  if (!valeur) return '';
  const v = String(valeur);

  if (v.startsWith(PREFIXE_COFFRE)) {
    const s = coffre();
    if (!s) return '';
    try {
      return s.decryptString(Buffer.from(v.slice(PREFIXE_COFFRE.length), 'base64'));
    } catch (e) {
      return '';
    }
  }

  if (v.startsWith(PREFIXE_CLAIR)) {
    return Buffer.from(v.slice(PREFIXE_CLAIR.length), 'base64').toString('utf8');
  }

  // Aucun préfixe : valeur posée à la main dans la base. On la rend telle
  // quelle plutôt que de l'ignorer silencieusement.
  return v;
}

/** Indique si une valeur enregistrée est réellement protégée par le coffre. */
function estProtege(valeur) {
  return Boolean(valeur) && String(valeur).startsWith(PREFIXE_COFFRE);
}

module.exports = {
  chiffrer,
  dechiffrer,
  coffreDisponible,
  estProtege,
  PREFIXE_COFFRE,
  PREFIXE_CLAIR
};
