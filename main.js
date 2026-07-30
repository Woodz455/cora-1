/**
 * Point d'entrée de l'application de bureau Electron.
 *
 * Le backend Express est démarré dans le processus principal et sert lui-même
 * l'interface compilée en production.
 */

const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('path');
const { startServer } = require('./server.js');

const isDev = !app.isPackaged;

/** Port de développement de Vite. */
const VITE_PORT = 5173;

let mainWindow = null;
let serverInstance = null;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    title: 'Clora',
    icon: path.join(__dirname, 'image', 'logo.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Aucun canal IPC n'est exposé : l'interface communique uniquement avec
      // l'API HTTP locale, il n'y a donc pas de script de préchargement.
      sandbox: true
    }
  });

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
    // Ferme proprement la base pour que le journal WAL soit consolidé.
    if (serverInstance.db) {
      try {
        await serverInstance.db.close();
      } catch (error) {
        console.error('[Electron] Fermeture de la base :', error.message);
      }
    }
  }
});
