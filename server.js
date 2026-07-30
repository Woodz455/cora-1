/**
 * Serveur HTTP de Clora : assemblage des middlewares et des routes.
 *
 * La logique métier vit dans les services (`*Service.js`) et le découpage des
 * points d'entrée dans `routes/`. Ce fichier ne fait que câbler l'ensemble.
 */

const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');

const { initDb } = require('./database.js');
const { authMiddleware } = require('./authMiddleware.js');
const { startScheduler } = require('./scheduler.js');
const { apiNotFound, errorHandler } = require('./httpUtils.js');
const { PORT, HOST } = require('./config.js');

const authRoutes = require('./routes/auth.js');
const userRoutes = require('./routes/users.js');
const clientRoutes = require('./routes/clients.js');
const factureRoutes = require('./routes/factures.js');
const devisRoutes = require('./routes/devis.js');
const catalogueRoutes = require('./routes/catalogue.js');
const depenseRoutes = require('./routes/depenses.js');
const abonnementRoutes = require('./routes/abonnements.js');
const banqueRoutes = require('./routes/banque.js');
const emailRoutes = require('./routes/emails.js');
const settingsRoutes = require('./routes/settings.js');
const rapportRoutes = require('./routes/rapports.js');
const noteCreditRoutes = require('./routes/notesCredit.js');
const relanceRoutes = require('./routes/relances.js');

/** Limite de corps par défaut. */
const LIMITE_CORPS = '1mb';

/** Limite réservée à l'envoi de courriels, qui transporte un PDF en base64. */
const LIMITE_CORPS_COURRIEL = '25mb';

/**
 * En-têtes de sécurité minimaux, sans dépendance supplémentaire.
 * L'interface et l'API sont servies par la même origine : aucun en-tête CORS
 * n'est nécessaire, et le précédent `cors()` ouvert répondait
 * `Access-Control-Allow-Origin: *` à n'importe quel site.
 */
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  next();
}

/**
 * Construit l'application Express.
 *
 * @param {import('sqlite').Database} db
 * @returns {import('express').Express}
 */
function createApp(db) {
  const app = express();
  const getDb = () => db;

  app.set('trust proxy', false);
  app.disable('x-powered-by');

  app.use(securityHeaders);

  // L'envoi de courriels transporte un PDF encodé en base64 et a donc besoin
  // d'une limite plus large. Elle lui est réservée : la limite de 50 Mo
  // s'appliquait auparavant à toutes les routes, offrant un levier de
  // saturation mémoire sur n'importe quel point d'entrée.
  const jsonStandard = express.json({ limit: LIMITE_CORPS });
  const jsonVolumineux = express.json({ limit: LIMITE_CORPS_COURRIEL });
  app.use((req, res, next) => (
    req.path === '/api/emails/send' ? jsonVolumineux(req, res, next) : jsonStandard(req, res, next)
  ));

  app.use(cookieParser());

  // L'authentification couvre toute l'API sauf les routes d'authentification
  // elles-mêmes ; chaque routeur applique ensuite ses contraintes de rôle.
  app.use('/api/auth', authRoutes(getDb));
  app.use('/api', authMiddleware);

  app.use('/api/users', userRoutes(getDb));
  app.use('/api/clients', clientRoutes(getDb));
  app.use('/api/factures', factureRoutes(getDb));
  app.use('/api/devis', devisRoutes(getDb));
  app.use('/api/catalogue', catalogueRoutes(getDb));
  app.use('/api/depenses', depenseRoutes(getDb));
  app.use('/api/abonnements', abonnementRoutes(getDb));
  app.use('/api/banque', banqueRoutes(getDb));
  app.use('/api/emails', emailRoutes(getDb));
  app.use('/api/notes-credit', noteCreditRoutes(getDb));
  app.use('/api/relances', relanceRoutes(getDb));
  app.use('/api/settings', settingsRoutes(getDb));
  app.use('/api', rapportRoutes(getDb));

  // Toute autre route d'API répond en JSON, et non par la page d'accueil React.
  app.use('/api', apiNotFound);

  // Interface React compilée. En développement, c'est Vite qui sert l'interface
  // et proxifie /api : ce répertoire n'existe alors pas encore.
  const clientDir = path.join(__dirname, 'client', 'dist');
  const indexHtml = path.join(clientDir, 'index.html');
  app.use(express.static(clientDir));
  app.use((req, res) => {
    if (!fs.existsSync(indexHtml)) {
      return res.status(503).type('text/plain').send(
        "L'interface n'est pas compilée. Lancez « npm run build:client », ou « npm start » pour le mode développement."
      );
    }
    res.sendFile(indexHtml);
  });

  app.use(errorHandler);

  return app;
}

/**
 * Initialise la base, démarre le planificateur et met le serveur en écoute.
 *
 * L'écoute est restreinte à la boucle locale (voir `config.HOST`) : une
 * application de bureau n'a pas à publier son API comptable sur le réseau local.
 *
 * @param {number} [port] 0 pour un port libre attribué par le système
 * @returns {Promise<{app: import('express').Express, server: import('http').Server, port: number}>}
 */
async function startServer(port = PORT) {
  const db = await initDb();
  const app = createApp(db);

  startScheduler(db);

  return new Promise((resolve, reject) => {
    const server = app.listen(port, HOST, () => {
      const actualPort = server.address().port;
      console.log(`\nServeur Clora démarré sur http://${HOST}:${actualPort}`);
      resolve({ app, server, db, port: actualPort });
    });
    server.on('error', reject);
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Impossible de démarrer le serveur :', error.message);
    process.exit(1);
  });
}

module.exports = { createApp, startServer };
