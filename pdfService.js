/**
 * Fabrication des PDF : factures, devis, notes de crédit, compte rendu.
 *
 * Les PDF étaient des photographies : html2canvas dessinait le document dans
 * une image, que jsPDF enveloppait. Le texte n'était ni sélectionnable, ni
 * cherchable, ni lisible par un logiciel comptable qui extrait les montants ;
 * l'image, en JPEG, bavait à l'impression ; et les deux bibliothèques pesaient
 * près d'un mégaoctet dans le paquet.
 *
 * Chromium sait imprimer une page en PDF, avec son vrai texte et ses polices.
 * L'interface envoie le document déjà mis en page ; il est déposé sous un jeton
 * à usage unique, ouvert dans une fenêtre cachée sur la même origine (les
 * feuilles de style et les polices s'y chargent comme dans l'application), puis
 * imprimé au format lettre.
 *
 * Hors d'Electron (serveur lancé seul, tests), il n'y a pas de Chromium à qui
 * le demander : la fabrication est refusée, et l'interface le dit.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { httpError } = require('./httpUtils.js');

/** Durée de vie d'une page déposée : le temps de l'ouvrir, pas davantage. */
const DUREE_PAGE_MS = 60 * 1000;

/** Délai au-delà duquel la fabrication est abandonnée. */
const DELAI_FABRICATION_MS = 30 * 1000;

/** Pages en attente d'impression, par jeton. */
const pages = new Map();

/** Feuilles de style de l'interface compilée, lues une fois par dossier. */
const feuilles = new Map();

/**
 * Les feuilles de style que charge l'interface. Le document les reprend :
 * polices et classes y sont définies. En développement, Vite les injecte par
 * script et il n'y en a pas ; les styles en ligne du document suffisent.
 */
function feuillesDeStyle(dossierClient) {
  if (!feuilles.has(dossierClient)) {
    let liens = [];
    try {
      const index = fs.readFileSync(path.join(dossierClient, 'index.html'), 'utf8');
      liens = [...index.matchAll(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
    } catch (e) {
      // Interface non compilée : les styles en ligne du document suffiront.
    }
    feuilles.set(dossierClient, liens);
  }
  return feuilles.get(dossierClient);
}

const echapper = (texte) => String(texte).replace(/[&<>"]/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
})[c]);

/**
 * Dépose un document et rend son jeton.
 *
 * @param {string} html le document, tel que l'interface l'affiche
 * @param {{titre?: string, langue?: string, dossierClient: string}} options
 */
function deposerPage(html, { titre = '', langue = 'fr', dossierClient }) {
  const maintenant = Date.now();
  for (const [jeton, page] of pages) {
    if (page.expire < maintenant) pages.delete(jeton);
  }

  const liens = feuillesDeStyle(dossierClient)
    .map((href) => `<link rel="stylesheet" href="${echapper(href)}">`).join('\n');

  // Le thème sombre de l'application ne doit pas déteindre sur un document
  // remis à un client : il s'imprime toujours en noir sur blanc.
  const document = `<!doctype html>
<html lang="${langue === 'en' ? 'en' : 'fr'}" data-theme="light">
<head>
<meta charset="utf-8">
<title>${echapper(titre)}</title>
${liens}
<style>
  html, body { background: #fff !important; color: #000; margin: 0; }
  .print-only { display: block !important; position: static !important; width: 100%;
    max-width: none !important; margin: 0 !important; padding: 0 !important;
    box-shadow: none !important; border-radius: 0 !important; }
  .no-print { display: none !important; }
</style>
</head>
<body>${html}</body>
</html>`;

  const jeton = crypto.randomBytes(24).toString('hex');
  pages.set(jeton, { document, expire: maintenant + DUREE_PAGE_MS });
  return jeton;
}

/** Rend une page déposée, une seule fois. */
function prendrePage(jeton) {
  const page = pages.get(String(jeton));
  if (!page) return null;
  pages.delete(String(jeton));
  return page.expire >= Date.now() ? page.document : null;
}

/** Vrai si un Chromium est là pour imprimer. */
function fabricationDisponible() {
  return Boolean(process.versions && process.versions.electron);
}

/**
 * Imprime une page en PDF, au format lettre.
 *
 * La fenêtre est cachée, sans accès à Node, et ne peut ni naviguer ailleurs ni
 * ouvrir d'autre fenêtre : elle ne fait qu'afficher le document et l'imprimer.
 *
 * @param {string} url adresse de la page déposée
 * @returns {Promise<Buffer>}
 */
async function imprimer(url) {
  const { BrowserWindow } = require('electron');
  const fenetre = new BrowserWindow({
    show: false,
    width: 816,
    height: 1056,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
  });
  const contenu = fenetre.webContents;
  contenu.setWindowOpenHandler(() => ({ action: 'deny' }));
  contenu.on('will-navigate', (event) => event.preventDefault());

  let minuterie = null;
  const delai = new Promise((resolve, reject) => {
    minuterie = setTimeout(() => reject(httpError(504, 'La fabrication du PDF a pris trop de temps.')), DELAI_FABRICATION_MS);
  });

  try {
    return await Promise.race([delai, (async () => {
      await fenetre.loadURL(url);
      // Les polices se chargent après l'événement `load` : imprimer avant les
      // aurait remplacées par celles du système.
      await contenu.executeJavaScript('document.fonts.ready.then(() => true)');
      return contenu.printToPDF({
        pageSize: 'Letter',
        printBackground: true,
        margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
        // Le document devient navigable : titres et texte balisés pour les
        // lecteurs d'écran et l'extraction.
        generateTaggedPDF: true
      });
    })()]);
  } finally {
    clearTimeout(minuterie);
    if (!fenetre.isDestroyed()) fenetre.destroy();
  }
}

module.exports = {
  deposerPage,
  prendrePage,
  imprimer,
  fabricationDisponible,
  DUREE_PAGE_MS
};
