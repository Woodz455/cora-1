/**
 * Point d'entrée de l'application de bureau Electron.
 *
 * Le backend Express est démarré dans le processus principal et sert lui-même
 * l'interface compilée en production.
 */

const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('path');
const { startServer } = require('./server.js');
const { sauvegardeSiNecessaire } = require('./backupService.js');
const { connexionsOuvertes, fermerTout } = require('./companyStore.js');

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
let serverInstance = null;

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

  const afficherFenetre = () => {
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
      console.log('[Electron] Fenêtre affichée');
    }
  };

  mainWindow.once('ready-to-show', afficherFenetre);

  // Les liens externes (paiement en ligne, documentation) s'ouvrent dans le
  // navigateur du système plutôt que dans la fenêtre de l'application.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  try {
    // En développement le backend reste sur 3000 pour que le proxy de Vite le
    // trouve ; en production le système attribue un port libre.
    serverInstance = await startServer(isDev ? 3000 : 0);
    const backendPort = serverInstance.port;
    console.log(`[Electron] Backend démarré sur le port ${backendPort}`);

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
    dialog.showErrorBox(
      'Clora ne peut pas démarrer',
      `Le service interne n'a pas pu être lancé.\n\n${error.message}`
    );
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
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  if (serverInstance) {
    if (serverInstance.server) serverInstance.server.close();

    // Sauvegarde de fin de journée, avant fermeture : sur un poste éteint
    // chaque soir, le planificateur horaire n'a pas toujours l'occasion
    // d'atteindre son échéance de 24 h.
    //
    // Tous les dossiers ouverts pendant la session y passent, pas seulement le
    // dernier consulté : un comptable qui a travaillé sur trois clients dans la
    // journée doit repartir avec trois copies, pas une.
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
});
