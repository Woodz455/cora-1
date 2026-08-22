/**
 * Configuration centrale de l'application : emplacement des données,
 * secret de signature des jetons, hôte et port d'écoute.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Répertoire où sont stockées les données de l'utilisateur (base, secret).
 * En développement : la racine du projet. En application installée :
 * le dossier de données utilisateur d'Electron (%APPDATA%/Clora sous Windows).
 */
function getDataDir() {
  if (process.versions && process.versions.electron) {
    try {
      const { app } = require('electron');
      if (app && app.isPackaged) return app.getPath('userData');
    } catch (e) {
      // Electron indisponible (exécution du serveur hors application) : on retombe sur le projet.
    }
  }
  return __dirname;
}

/**
 * Chargement du fichier d'environnement.
 *
 * Il était lu depuis `__dirname` seulement — c'est-à-dire, une fois
 * l'application empaquetée, depuis l'intérieur de `app.asar` : une archive en
 * lecture seule, d'où le fichier est de surcroît explicitement exclu
 * (`"!.env"` dans package.json). Personne ne pouvait donc configurer l'envoi de
 * courriels sur une installation réelle, et le message d'erreur renvoyait vers
 * un fichier inatteignable.
 *
 * Le dossier de données passe en premier : c'est le seul emplacement
 * accessible à l'utilisateur. La racine du projet suit, pour le développement.
 * dotenv n'écrase jamais une variable déjà définie, donc les variables
 * d'environnement du système gardent la priorité sur les deux.
 *
 * Ce chemin reste un dépannage : la configuration normale passe par
 * Paramètres → Courriel, qui écrit dans la base.
 */
require('dotenv').config({ path: path.join(getDataDir(), '.env') });
require('dotenv').config({ path: path.join(__dirname, '.env') });

const DB_FILENAME = 'database.sqlite';
const SECRET_FILENAME = '.jwt-secret';

function getDbPath() {
  return path.join(getDataDir(), DB_FILENAME);
}

let cachedSecret = null;

/**
 * Retourne le secret de signature des jetons.
 *
 * Priorité à JWT_SECRET. À défaut, un secret aléatoire de 512 bits est généré
 * au premier lancement puis conservé dans le répertoire de données, en lecture
 * seule pour le propriétaire. Il n'existe volontairement aucune valeur par
 * défaut en dur : un secret présent dans le code source permettrait à quiconque
 * lit le dépôt de forger un jeton administrateur.
 */
function getJwtSecret() {
  if (cachedSecret) return cachedSecret;

  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv && fromEnv.trim().length >= 32) {
    cachedSecret = fromEnv.trim();
    return cachedSecret;
  }
  if (fromEnv && fromEnv.trim().length > 0) {
    throw new Error('JWT_SECRET est trop court : 32 caractères minimum sont requis.');
  }

  const secretPath = path.join(getDataDir(), SECRET_FILENAME);
  try {
    const existing = fs.readFileSync(secretPath, 'utf8').trim();
    if (existing.length >= 32) {
      cachedSecret = existing;
      return cachedSecret;
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  const generated = crypto.randomBytes(64).toString('hex');
  fs.writeFileSync(secretPath, generated, { mode: 0o600 });
  console.log(`Secret de signature généré : ${secretPath}`);
  cachedSecret = generated;
  return cachedSecret;
}

const PORT = Number(process.env.PORT) || 3000;

/**
 * L'application de bureau n'a aucune raison d'exposer son API comptable au
 * réseau : on écoute exclusivement sur la boucle locale, sauf demande explicite.
 */
const HOST = process.env.HOST || '127.0.0.1';

const isProduction = process.env.NODE_ENV === 'production';

/** Durée de validité d'une session, en heures. */
const SESSION_HOURS = Number(process.env.SESSION_HOURS) || 12;

module.exports = {
  getDataDir,
  getDbPath,
  getJwtSecret,
  PORT,
  HOST,
  isProduction,
  SESSION_HOURS,
  DB_FILENAME
};
