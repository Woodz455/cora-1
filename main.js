/**
 * Point d'entrée de l'application de bureau Electron.
 *
 * Le backend Express est démarré dans le processus principal et sert lui-même
 * l'interface compilée en production.
 */

const { app, BrowserWindow, dialog, nativeTheme, session, shell } = require('electron');
const path = require('path');
const { startServer } = require('./server.js');
const { sauvegardeSiNecessaire } = require('./backupService.js');
const { connexionsOuvertes, fermerTout } = require('./companyStore.js');
const { traduire } = require('./traductionServeur.js');
const { getDataDir } = require('./config.js');
const journalFichier = require('./journalFichier.js');

// Avant tout le reste : ce qui échoue au démarrage doit lui aussi laisser une
// trace. Seule l'application de bureau tient ce journal ; le serveur lancé
// seul et les tests gardent leur console.
journalFichier.installer(getDataDir());

/**
 * `CLORA_UI_COMPILEE=1` force le chemin de production sur une application non
 * empaquetée. C'est le seul moyen pour un test de piloter l'interface
 * réellement livrée sans passer par electron-builder — et les vérifications
 * faites au navigateur ont déjà laissé passer des défauts propres à Electron.
 */
const isDev = !app.isPackaged && process.env.CLORA_UI_COMPILEE !== '1';

/** Port de développement de Vite. */
const VITE_PORT = 5173;

/**
 * Chemin d'une image livrée avec l'application.
 *
 * `extraResources` dépose le dossier `image` à côté de l'archive `app.asar`,
 * et non dedans : une fois installée, l'application ne peut donc pas le
 * chercher à partir de `__dirname`.
 */
const cheminImage = (nom) => (app.isPackaged
  ? path.join(process.resourcesPath, 'image', nom)
  : path.join(__dirname, 'image', nom));

let mainWindow = null;

/**
 * Origines que la fenêtre a le droit d'afficher : le serveur local, et Vite en
 * développement. Renseignées au démarrage, quand le port est connu.
 */
const originesInternes = new Set();

/** Vrai pour une adresse servie par l'application elle-même. */
function estInterne(url) {
  try {
    return originesInternes.has(new URL(url).origin);
  } catch (e) {
    return false;
  }
}
let serverInstance = null;
let ecranDemarrage = null;
let ecranAfficheLe = null;

/**
 * Durée minimale de l'écran de démarrage, une fois apparu. Quand le service
 * démarre vite, il ne ferait que clignoter, ce qui se lit comme un défaut
 * plutôt que comme un accueil.
 */
const DUREE_MIN_ECRAN_MS = 600;

/** La langue du système : celle du compte n'est pas encore connue. */
const systemeEnAnglais = () => String(app.getLocale() || '').toLowerCase().startsWith('en');

/**
 * Petite fenêtre affichée dès le double-clic.
 *
 * La fenêtre principale reste cachée tant que l'interface n'est pas dessinée ;
 * pendant ces quelques secondes, rien n'apparaissait à l'écran et l'on pouvait
 * croire que Clora ne s'était pas lancé. Elle ne retarde rien : elle se ferme
 * dès que la fenêtre principale s'affiche.
 */
function ouvrirEcranDemarrage() {
  ecranDemarrage = new BrowserWindow({
    width: 420,
    height: 300,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    center: true,
    show: false,
    title: 'Clora',
    icon: cheminImage('logo.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f172a' : '#f8fafc',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
  });
  ecranDemarrage.once('ready-to-show', () => {
    if (ecranDemarrage && !ecranDemarrage.isDestroyed()) {
      ecranDemarrage.show();
      ecranAfficheLe = Date.now();
    }
  });
  ecranDemarrage.on('closed', () => { ecranDemarrage = null; });

  // Compilée, la page vit dans client/dist, à côté des logotypes ; en
  // développement, dans client/public, que Vite sert tel quel.
  const dossier = isDev ? path.join(__dirname, 'client', 'public') : path.join(__dirname, 'client', 'dist');
  ecranDemarrage.loadFile(path.join(dossier, 'ecran-demarrage.html'), { hash: systemeEnAnglais() ? 'en' : 'fr' })
    .catch((error) => console.error('[Electron] Écran de démarrage :', error.message));
}

function fermerEcranDemarrage() {
  if (ecranDemarrage && !ecranDemarrage.isDestroyed()) ecranDemarrage.close();
  ecranDemarrage = null;
}

/**
 * L'alerte de démarrage s'affiche avant l'interface, donc avant que la langue
 * du compte soit connue : elle suit celle du système, comme le premier écran
 * de connexion.
 */
function alerteDeDemarrage(message) {
  return systemeEnAnglais()
    ? ['Clora cannot start', `The internal service could not be started.\n\n${traduire(message, 'en')}`]
    : ['Clora ne peut pas démarrer', `Le service interne n'a pas pu être lancé.\n\n${message}`];
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    title: 'Clora',
    icon: cheminImage('logo.png'),
    // La fenêtre reste cachée le temps que le serveur démarre et que
    // l'interface soit dessinée : sans cela, l'utilisateur voit d'abord un
    // rectangle blanc, ce qui donne l'impression d'un logiciel figé.
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Aucun canal IPC n'est exposé : l'interface communique uniquement avec
      // l'API HTTP locale, il n'y a donc pas de script de préchargement.
      sandbox: true
    }
  });

  const montrer = () => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
      console.log('[Electron] Fenêtre affichée');
    }
    fermerEcranDemarrage();
  };

  // Un écran de démarrage pas encore apparu ne retient rien : la fenêtre
  // principale s'affiche aussitôt et il se ferme sans s'être montré.
  const afficherFenetre = () => {
    const reste = ecranAfficheLe ? DUREE_MIN_ECRAN_MS - (Date.now() - ecranAfficheLe) : 0;
    if (reste > 0) setTimeout(montrer, reste);
    else montrer();
  };

  mainWindow.once('ready-to-show', afficherFenetre);

  // Les liens externes (paiement en ligne, documentation) s'ouvrent dans le
  // navigateur du système plutôt que dans la fenêtre de l'application.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // La fenêtre ne quitte jamais l'application. Un lien ordinaire vers un autre
  // site y aurait chargé ce site, avec la session de Clora à portée : il
  // s'ouvre dans le navigateur du système, comme les fenêtres ci-dessus.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (estInterne(url)) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });

  try {
    // En développement le backend reste sur 3000 pour que le proxy de Vite le
    // trouve ; en production le système attribue un port libre.
    serverInstance = await startServer(isDev ? 3000 : 0);
    const backendPort = serverInstance.port;
    console.log(`[Electron] Backend démarré sur le port ${backendPort}`);

    originesInternes.add(`http://127.0.0.1:${backendPort}`);
    if (isDev) originesInternes.add(`http://localhost:${VITE_PORT}`);

    if (isDev) {
      await mainWindow.loadURL(`http://localhost:${VITE_PORT}`);
      mainWindow.webContents.openDevTools();
    } else {
      await mainWindow.loadURL(`http://127.0.0.1:${backendPort}`);
    }

    // `ready-to-show` a normalement déjà tout affiché. Ce second appel garantit
    // qu'un évènement manqué ne laisse pas l'utilisateur devant rien du tout,
    // ce qui serait pire que la fenêtre blanche qu'on vient de supprimer.
    afficherFenetre();
  } catch (error) {
    // Sans cette alerte, un échec de démarrage se traduisait par une fenêtre
    // blanche sans explication.
    console.error('[Electron] Erreur au démarrage du serveur :', error);
    // L'alerte ne doit pas s'ouvrir derrière un « Démarrage… » qui ne finira pas.
    fermerEcranDemarrage();
    dialog.showErrorBox(...alerteDeDemarrage(error.message));
    app.quit();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Une seule instance : deux processus écrivant dans la même base SQLite
// pourraient se gêner.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // Clora n'a besoin ni de la caméra, ni du micro, ni de la position, ni des
    // notifications : toute demande de permission est refusée d'office.
    session.defaultSession.setPermissionRequestHandler((webContents, permission, repondre) => repondre(false));

    ouvrirEcranDemarrage();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/**
 * Délai accordé au travail de fermeture. Un dossier de sauvegarde sur un
 * lecteur réseau injoignable ne doit pas retenir l'application indéfiniment :
 * passé ce délai, elle se ferme quand même.
 */
const DELAI_FERMETURE_MS = 15000;

/**
 * Sauvegarde de fin de journée et fermeture des bases.
 *
 * Sur un poste éteint chaque soir, le planificateur horaire n'a pas toujours
 * l'occasion d'atteindre son échéance de 24 h : la fermeture est alors la
 * seule occasion de sauvegarder.
 *
 * Tous les dossiers ouverts pendant la session y passent, pas seulement le
 * dernier consulté : un comptable qui a travaillé sur trois clients dans la
 * journée doit repartir avec trois copies, pas une.
 */
async function travailDeFermeture() {
  if (serverInstance.server) serverInstance.server.close();

  for (const { chemin, db } of connexionsOuvertes()) {
    try {
      await sauvegardeSiNecessaire(db);
    } catch (error) {
      console.error(`[Electron] Sauvegarde à la fermeture (${chemin}) :`, error.message);
    }
  }

  // Ferme proprement les bases pour que les journaux WAL soient consolidés.
  try {
    await fermerTout();
    if (serverInstance.comptesDb) await serverInstance.comptesDb.close();
  } catch (error) {
    console.error('[Electron] Fermeture des bases :', error.message);
  }
}

let fermetureEngagee = false;

/**
 * Electron n'attend pas un gestionnaire asynchrone : sans retenir la
 * fermeture, le processus s'arrêtait pendant que la sauvegarde démarrait. Elle
 * n'avait donc jamais lieu, les journaux WAL restaient en plan et la
 * bibliothèque SQLite, interrompue en plein travail, faisait planter la sortie.
 *
 * La fermeture est donc suspendue une fois, le temps du travail, puis relancée.
 */
app.on('before-quit', (event) => {
  if (fermetureEngagee || !serverInstance) return;
  fermetureEngagee = true;
  event.preventDefault();

  let minuterie = null;
  const delai = new Promise((resolve) => {
    minuterie = setTimeout(() => {
      console.error('[Electron] Fermeture : délai dépassé, arrêt sans attendre la fin du travail.');
      resolve();
    }, DELAI_FERMETURE_MS);
  });

  Promise.race([travailDeFermeture(), delai])
    .catch((error) => console.error('[Electron] Fermeture :', error.message))
    .finally(() => {
      clearTimeout(minuterie);
      app.quit();
    });
});
