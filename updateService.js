/**
 * Vérification des mises à jour.
 *
 * Volontairement limitée à « vérifier et prévenir ». L'application n'est pas
 * signée : `electron-updater` téléchargerait et exécuterait un binaire dont
 * rien ne vérifie l'origine, la vérification de signature étant précisément ce
 * qui est désactivé faute de certificat. Sur un logiciel qui détient la
 * comptabilité d'une entreprise, ce n'est pas un risque acceptable.
 *
 * L'utilisateur est donc informé qu'une version existe, et décide lui-même.
 */

const https = require('https');

/** Page des versions publiées, ouverte dans le navigateur du système. */
const PAGE_VERSIONS = 'https://github.com/Woodz455/cora-1/releases/latest';

/** Interrogé pour connaître la dernière version publiée. */
const API_VERSIONS = 'https://api.github.com/repos/Woodz455/cora-1/releases/latest';

/** Au-delà, on renonce : l'application ne doit pas attendre le réseau. */
const DELAI_MS = 5000;

/** Une vérification par jour suffit. */
const INTERVALLE_MS = 24 * 60 * 60 * 1000;

let cache = null;

/**
 * Compare deux versions sémantiques.
 * @returns {number} positif si `a` est plus récente que `b`
 */
function comparerVersions(a, b) {
  // Complété à trois composantes : une étiquette « v2.1 », que l'on publie
  // couramment, laissait autrement le troisième terme indéfini, la soustraction
  // rendait NaN, et aucune mise à jour n'aurait jamais été signalée.
  const decouper = (v) => {
    const morceaux = String(v || '').replace(/^v/, '').split('.').map((n) => Number(n) || 0);
    return [morceaux[0] || 0, morceaux[1] || 0, morceaux[2] || 0];
  };
  const [aMaj, aMin, aCor] = decouper(a);
  const [bMaj, bMin, bCor] = decouper(b);

  if (aMaj !== bMaj) return aMaj - bMaj;
  if (aMin !== bMin) return aMin - bMin;
  return aCor - bCor;
}

/**
 * Interroge la page des versions.
 *
 * Échoue en silence : hors ligne, derrière un pare-feu d'entreprise ou si
 * GitHub est indisponible, l'application ne doit rien signaler du tout.
 */
function derniereVersionPubliee() {
  return new Promise((resoudre) => {
    const requete = https.get(
      API_VERSIONS,
      { headers: { 'User-Agent': 'Clora', Accept: 'application/vnd.github+json' }, timeout: DELAI_MS },
      (reponse) => {
        if (reponse.statusCode !== 200) {
          reponse.resume();
          return resoudre(null);
        }

        let corps = '';
        reponse.setEncoding('utf8');
        reponse.on('data', (morceau) => { corps += morceau; });
        reponse.on('end', () => {
          try {
            const { tag_name: etiquette } = JSON.parse(corps);
            resoudre(etiquette ? String(etiquette).replace(/^v/, '') : null);
          } catch (e) {
            resoudre(null);
          }
        });
      }
    );

    requete.on('timeout', () => { requete.destroy(); resoudre(null); });
    requete.on('error', () => resoudre(null));
  });
}

/**
 * Version courante de l'application.
 *
 * Hors Electron — serveur lancé seul —, on retombe sur `package.json`.
 */
function versionCourante() {
  if (process.versions && process.versions.electron) {
    try {
      const { app } = require('electron');
      if (app && typeof app.getVersion === 'function') return app.getVersion();
    } catch (e) {
      // Electron indisponible : le repli ci-dessous s'applique.
    }
  }
  return require('./package.json').version;
}

/** Indique si l'application tourne empaquetée. */
function estEmpaquetee() {
  if (!process.versions || !process.versions.electron) return false;
  try {
    const { app } = require('electron');
    return Boolean(app && app.isPackaged);
  } catch (e) {
    return false;
  }
}

/**
 * État des mises à jour.
 *
 * @param {import('sqlite').Database} db
 * @param {{forcer?: boolean}} [options]
 */
async function verifierMiseAJour(db, options = {}) {
  const courante = versionCourante();
  const base = { courante, derniere: null, disponible: false, page: PAGE_VERSIONS };

  // En développement, la version installée n'a pas de sens à comparer, et
  // interroger le réseau à chaque rechargement serait inutilement bavard.
  if (!estEmpaquetee() && !options.forcer) {
    return { ...base, verifie: false, raison: 'developpement' };
  }

  let active = true;
  try {
    const reglages = await db.get('SELECT verifier_maj FROM settings LIMIT 1');
    active = !reglages || reglages.verifier_maj !== 0;
  } catch (e) {
    // Colonne absente sur une base ancienne : la vérification reste active.
  }

  // C'est le seul appel sortant de l'application : le couper doit rester
  // possible, et rien ne doit partir quand il l'est.
  if (!active) return { ...base, verifie: false, raison: 'desactivee' };

  if (cache && !options.forcer && Date.now() - cache.horodatage < INTERVALLE_MS) {
    return { ...base, ...cache.resultat };
  }

  const derniere = await derniereVersionPubliee();
  const resultat = {
    derniere,
    disponible: Boolean(derniere) && comparerVersions(derniere, courante) > 0,
    verifie: derniere !== null
  };

  if (derniere) cache = { horodatage: Date.now(), resultat };
  return { ...base, ...resultat };
}

/** Vide le cache. Réservé aux tests. */
function reinitialiser() {
  cache = null;
}

module.exports = {
  verifierMiseAJour,
  comparerVersions,
  derniereVersionPubliee,
  versionCourante,
  estEmpaquetee,
  reinitialiser,
  PAGE_VERSIONS,
  INTERVALLE_MS
};
