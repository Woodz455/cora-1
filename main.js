const { app, BrowserWindow } = require('electron');
const path = require('path');
const { startServer } = require('./server.js');

const isDev = !app.isPackaged;

let mainWindow;
let serverInstance;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // preload: path.join(__dirname, 'preload.js') // Optionnel si on a besoin de preload
    },
    title: 'Clora',
  });

  try {
    // Démarrer le backend Express sur un port dynamique (0 = port libre aléatoire)
    // En développement, on peut forcer le port 3000 si on veut que Vite proxy fonctionne bien,
    // mais ici on va s'assurer que le backend sert aussi le dev ou prod.
    // L'idéal en dev est de démarrer le backend sur 3000, et en prod sur 0.
    const portToUse = isDev ? 3000 : 0;
    serverInstance = await startServer(portToUse);
    const backendPort = serverInstance.port;
    console.log(`[Electron] Backend démarré sur le port ${backendPort}`);

    if (isDev) {
      // En mode développement, on charge l'URL de Vite (par défaut 5173)
      mainWindow.loadURL('http://localhost:5173');
      mainWindow.webContents.openDevTools();
    } else {
      // En mode production, le serveur Express sert lui-même le frontend React
      // On demande simplement à la fenêtre Electron de charger l'URL racine de notre backend
      mainWindow.loadURL(`http://localhost:${backendPort}`);
    }
  } catch (error) {
    console.error('[Electron] Erreur au démarrage du serveur:', error);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // Fermer proprement le serveur Express si l'application s'arrête
  if (serverInstance && serverInstance.server) {
    serverInstance.server.close();
  }
});
