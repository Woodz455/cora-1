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
 *
 * Tout ce module est asynchrone. Electron 45 déclare obsolètes les fonctions
 * synchrones du coffre (`isEncryptionAvailable`, `encryptString`,
 * `decryptString`) et la 46 les retire ; leurs remplaçantes rendent des
 * promesses. Elles relisent ce que les anciennes ont chiffré : une installation
 * existante garde ses secrets.
 */

/** Valeur protégée par le coffre du système. */
const PREFIXE_COFFRE = 'coffre:';

/** Valeur simplement encodée : aucun coffre n'était disponible à l'écriture. */
const PREFIXE_CLAIR = 'clair:';

/**
 * Colonnes de `settings` qui portent un secret. Liste fermée : `lireSecret`
 * compose une requête avec le nom de la colonne, qui ne doit donc jamais venir
 * d'ailleurs que d'ici.
 */
const COLONNES_SECRETES = ['smtp_pass_chiffre', 'stripe_cle_chiffree', 'sauvegarde_cle'];

/** Coffre substitué par les tests. `undefined` : celui d'Electron. */
let coffreImpose;

/**
 * Remplace le coffre d'Electron. Réservé aux tests, qui tournent hors Electron
 * et n'exerceraient sinon que le repli en clair.
 *
 * @param {Object|null|undefined} faux un objet de même forme que `safeStorage`,
 *   `null` pour simuler l'absence de coffre, `undefined` pour rendre la main
 */
function utiliserCoffre(faux) {
  coffreImpose = faux;
}

/** Le module `safeStorage`, sans présumer qu'il sait chiffrer. */
function moduleDuCoffre() {
  if (coffreImpose !== undefined) return coffreImpose;
  if (!process.versions || !process.versions.electron) return null;
  try {
    const { safeStorage } = require('electron');
    return safeStorage || null;
  } catch (e) {
    // Electron indisponible : le repli en clair s'applique.
    return null;
  }
}

/**
 * Accès au coffre, résolu à chaque appel plutôt qu'au chargement du module.
 *
 * La disponibilité exige qu'Electron soit initialisé ; l'interroger au
 * `require` renverrait faux au démarrage et condamnerait toute la session à
 * écrire en clair.
 *
 * Les fonctions asynchrones sont préférées dès qu'elles existent. Les
 * anciennes ne servent plus qu'à un Electron qui ne les connaîtrait pas.
 *
 * @returns {Promise<Object|null>}
 */
async function coffre() {
  const s = moduleDuCoffre();
  if (!s) return null;
  try {
    if (typeof s.isAsyncEncryptionAvailable === 'function') {
      return (await s.isAsyncEncryptionAvailable()) ? s : null;
    }
    return s.isEncryptionAvailable() ? s : null;
  } catch (e) {
    return null;
  }
}

/** Indique si les secrets écrits maintenant seront réellement protégés. */
async function coffreDisponible() {
  return (await coffre()) !== null;
}

/**
 * Chiffre un secret en vue de son enregistrement.
 * Une valeur vide reste vide : elle ne représente pas un secret.
 *
 * @returns {Promise<string>}
 */
async function chiffrer(texte) {
  if (texte === null || texte === undefined || texte === '') return '';

  const s = await coffre();
  if (s) {
    const bloc = typeof s.encryptStringAsync === 'function'
      ? await s.encryptStringAsync(String(texte))
      : s.encryptString(String(texte));
    return PREFIXE_COFFRE + Buffer.from(bloc).toString('base64');
  }
  return PREFIXE_CLAIR + Buffer.from(String(texte), 'utf8').toString('base64');
}

/**
 * Déchiffre un secret enregistré, et dit si le coffre demande à le rechiffrer.
 *
 * Electron signale (`shouldReEncrypt`) qu'une valeur a été lue avec une clé
 * ancienne et qu'une plus récente est disponible. Le texte est rendu dans tous
 * les cas ; c'est à l'appelant qui détient la ligne de la réécrire.
 *
 * @returns {Promise<{texte: string, aRechiffrer: boolean}>}
 */
async function dechiffrerEnDetail(valeur) {
  const illisible = { texte: '', aRechiffrer: false };
  if (!valeur) return illisible;
  const v = String(valeur);

  if (v.startsWith(PREFIXE_COFFRE)) {
    const s = await coffre();
    if (!s) return illisible;
    const bloc = Buffer.from(v.slice(PREFIXE_COFFRE.length), 'base64');
    try {
      if (typeof s.decryptStringAsync === 'function') {
        const { result, shouldReEncrypt } = await s.decryptStringAsync(bloc);
        return { texte: typeof result === 'string' ? result : '', aRechiffrer: Boolean(shouldReEncrypt) };
      }
      return { texte: s.decryptString(bloc), aRechiffrer: false };
    } catch (e) {
      return illisible;
    }
  }

  if (v.startsWith(PREFIXE_CLAIR)) {
    return { texte: Buffer.from(v.slice(PREFIXE_CLAIR.length), 'base64').toString('utf8'), aRechiffrer: false };
  }

  // Aucun préfixe : valeur posée à la main dans la base. On la rend telle
  // quelle plutôt que de l'ignorer silencieusement.
  return { texte: v, aRechiffrer: false };
}

/**
 * Déchiffre un secret enregistré.
 *
 * Renvoie une chaîne vide lorsque la valeur est illisible — base restaurée sur
 * une autre machine, ou sous un autre compte Windows. L'appelant traite alors
 * la configuration comme absente et invite à la ressaisir, ce qui est
 * préférable à une erreur incompréhensible au moment d'envoyer une facture.
 *
 * @returns {Promise<string>}
 */
async function dechiffrer(valeur) {
  return (await dechiffrerEnDetail(valeur)).texte;
}

/**
 * Lit un secret des paramètres, et le rechiffre si le coffre le demande.
 *
 * Sans cette réécriture, une valeur chiffrée par une clé que le système a
 * remplacée resterait lisible jusqu'au jour où Electron cesserait de
 * reconnaître l'ancienne : le secret serait alors perdu d'un coup, lors d'une
 * mise à jour sans rapport. La rechiffrer à la première lecture évite cette
 * échéance.
 *
 * La réécriture ne touche la ligne que si la valeur n'a pas changé entre la
 * lecture et l'écriture, pour ne jamais piétiner un secret que l'utilisateur
 * vient de remplacer. Elle ne fait jamais échouer la lecture.
 *
 * @param {import('sqlite').Database} db
 * @param {string} colonne l'une de `COLONNES_SECRETES`
 * @param {string} valeur la valeur enregistrée, telle que lue dans `settings`
 * @returns {Promise<string>} le secret, ou une chaîne vide s'il est illisible
 */
async function lireSecret(db, colonne, valeur) {
  if (!COLONNES_SECRETES.includes(colonne)) {
    throw new Error('colonne de secret inconnue');
  }

  const { texte, aRechiffrer } = await dechiffrerEnDetail(valeur);
  if (texte && aRechiffrer && db) {
    try {
      const nouvelle = await chiffrer(texte);
      if (nouvelle && nouvelle !== valeur) {
        await db.run(`UPDATE settings SET ${colonne} = ? WHERE ${colonne} = ?`, [nouvelle, valeur]);
      }
    } catch (error) {
      console.error(`Coffre : rechiffrement de ${colonne} impossible.`, error.message);
    }
  }
  return texte;
}

/** Indique si une valeur enregistrée est réellement protégée par le coffre. */
function estProtege(valeur) {
  return Boolean(valeur) && String(valeur).startsWith(PREFIXE_COFFRE);
}

module.exports = {
  chiffrer,
  dechiffrer,
  lireSecret,
  coffreDisponible,
  estProtege,
  utiliserCoffre,
  PREFIXE_COFFRE,
  PREFIXE_CLAIR,
  COLONNES_SECRETES
};
