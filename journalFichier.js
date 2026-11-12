/**
 * Journal de fonctionnement, dans un fichier.
 *
 * Tout ce que Clora signale passe par `console`. Dans l'application installée,
 * personne ne lit la console : une sauvegarde qui échoue, un courriel refusé,
 * une erreur au démarrage ne laissaient aucune trace, et le soutien n'avait que
 * le récit de l'utilisateur.
 *
 * Ce module recopie la console dans `journaux/clora.log`, dans le dossier de
 * données. Le fichier reste sur le poste : rien n'est envoyé nulle part. Il
 * tourne à 1 Mo et garde deux fichiers précédents, pour ne jamais grossir sans
 * fin.
 *
 * Il ne contient que ce que le code écrit déjà dans la console, où aucun secret
 * n'est jamais consigné. Écrire dans le journal ne fait jamais échouer
 * l'application.
 */

const fs = require('fs');
const path = require('path');

const NOM = 'clora.log';
const TAILLE_MAX = 1024 * 1024;
const ANCIENS = 2;

let fichier = null;

function chemin() {
  return fichier;
}

/** Fait tourner les fichiers quand le courant dépasse la taille permise. */
function tournerSiBesoin() {
  let taille = 0;
  try {
    taille = fs.statSync(fichier).size;
  } catch (e) {
    return;
  }
  if (taille < TAILLE_MAX) return;

  const base = fichier.slice(0, -'.log'.length);
  for (let i = ANCIENS; i >= 1; i -= 1) {
    const source = i === 1 ? fichier : `${base}.${i - 1}.log`;
    try {
      if (fs.existsSync(source)) fs.renameSync(source, `${base}.${i}.log`);
    } catch (e) {
      // Un fichier verrouillé ne doit pas empêcher d'écrire la suite.
    }
  }
}

/** Met en forme ce que `console` aurait affiché. */
function enTexte(args) {
  return args.map((a) => {
    if (a instanceof Error) return a.stack || a.message;
    if (typeof a === 'string') return a;
    try {
      return JSON.stringify(a);
    } catch (e) {
      return String(a);
    }
  }).join(' ');
}

function ecrire(niveau, args) {
  if (!fichier) return;
  try {
    tournerSiBesoin();
    fs.appendFileSync(fichier, `${new Date().toISOString()} [${niveau}] ${enTexte(args)}\n`);
  } catch (e) {
    // Disque plein ou dossier retiré : la console reste, le fichier se tait.
  }
}

/**
 * Commence à recopier la console dans le fichier.
 *
 * @param {string} dossierDeDonnees
 * @returns {string|null} le chemin du journal, ou null s'il n'a pas pu être ouvert
 */
function installer(dossierDeDonnees) {
  if (fichier) return fichier;
  try {
    const dossier = path.join(dossierDeDonnees, 'journaux');
    fs.mkdirSync(dossier, { recursive: true });
    fichier = path.join(dossier, NOM);
  } catch (e) {
    fichier = null;
    return null;
  }

  for (const [methode, niveau] of [['log', 'info'], ['warn', 'attention'], ['error', 'erreur']]) {
    const origine = console[methode].bind(console);
    console[methode] = (...args) => {
      origine(...args);
      ecrire(niveau, args);
    };
  }

  // Ce qui échappe à tout le reste. `uncaughtExceptionMonitor` observe sans
  // rien changer au sort de l'erreur.
  process.on('uncaughtExceptionMonitor', (erreur) => ecrire('fatale', [erreur]));
  process.on('unhandledRejection', (raison) => ecrire('erreur', ['Promesse rejetée sans suite :', raison]));

  return fichier;
}

/**
 * Dernières lignes du journal, les plus anciennes d'abord.
 *
 * @param {number} [nombre]
 * @returns {string[]}
 */
function dernieresLignes(nombre = 300) {
  if (!fichier) return [];
  try {
    const lignes = fs.readFileSync(fichier, 'utf8').split('\n').filter(Boolean);
    return lignes.slice(-nombre);
  } catch (e) {
    return [];
  }
}

/** Cesse d'écrire. Réservé aux tests. */
function fermer() {
  fichier = null;
}

module.exports = { installer, dernieresLignes, chemin, fermer, TAILLE_MAX, NOM };
