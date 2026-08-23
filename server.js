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
const { avecDossier, baseCourante } = require('./dbContext.js');
const { etatLicence, ETATS } = require('./licenceService.js');
const {
  ouvrirComptes, migrerSiNecessaire, ouvrirEntreprise, roleSur
} = require('./companyStore.js');

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
const sauvegardeRoutes = require('./routes/sauvegardes.js');
const auditRoutes = require('./routes/audit.js');
const entrepriseRoutes = require('./routes/entreprises.js');
const licenceRoutes = require('./routes/licence.js');
const importRoutes = require('./routes/import.js');

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
function createApp(db, options = {}) {
  const app = express();

  // Le registre est obligatoire : il n'existe qu'un seul comportement, celui
  // qui est livré. Un mode mono-entreprise de repli aurait fait tourner les
  // tests sur un chemin que personne n'emprunte en production.
  const comptesDb = options.comptesDb;
  if (!comptesDb) {
    throw new Error('createApp exige un registre de dossiers (options.comptesDb).');
  }

  /**
   * Base du dossier ouvert par la requête en cours.
   *
   * Les seize routeurs reçoivent cette fonction et l'appellent en 81 endroits,
   * sans argument. C'est `dbContext` qui porte le dossier, si bien qu'aucun de
   * ces appels n'a eu à changer : la bascule d'un dossier à l'autre se fait
   * ici, en un seul point.
   */
  const getDb = () => baseCourante();

  /** Base des comptes et du registre, commune à tous les dossiers. */
  const getComptesDb = () => comptesDb;

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
    // L'envoi de courriels transporte un PDF, l'import un tableur : les deux
    // dépassent la limite ordinaire, qui protège toutes les autres routes.
    req.path === '/api/emails/send' || req.path.startsWith('/api/import/')
      ? jsonVolumineux(req, res, next)
      : jsonStandard(req, res, next)
  ));

  app.use(cookieParser());

  // La licence se consulte et s'active sans session : un essai expiré bloque
  // l'application avant la connexion, et exiger d'être connecté pour saisir
  // une clé enfermerait l'utilisateur dehors.
  app.use('/api/licence', licenceRoutes(getComptesDb));

  /**
   * Refuse l'API quand l'installation n'est plus utilisable.
   *
   * Placé avant l'authentification : sans licence valable, il n'y a pas lieu de
   * se connecter. Le contrôle est inerte tant qu'aucune clé publique n'est
   * configurée — une version compilée avant que l'éditeur n'ait généré sa paire
   * ne doit pas se verrouiller d'elle-même au trentième jour.
   */
  async function licenceMiddleware(req, res, next) {
    try {
      const etat = await etatLicence(comptesDb);
      if (etat.utilisable) return next();

      return res.status(402).json({
        error: etat.etat === ETATS.MAINTENANCE_EXPIREE
          ? 'La maintenance de votre licence ne couvre pas cette version de Clora.'
          : "Votre période d'essai est terminée.",
        licence: etat
      });
    } catch (error) {
      return next(error);
    }
  }
  app.use('/api', licenceMiddleware);

  // L'authentification couvre toute l'API sauf les routes d'authentification
  // elles-mêmes ; chaque routeur applique ensuite ses contraintes de rôle.
  app.use('/api/auth', authRoutes(getComptesDb));
  app.use('/api', authMiddleware);

  /**
   * Ouvre le dossier désigné par la session et y résout le rôle.
   *
   * Le rôle est relu à chaque requête plutôt que d'être porté par le jeton :
   * retirer un accès à quelqu'un doit prendre effet immédiatement, et non à
   * l'expiration de sa session douze heures plus tard.
   */
  async function dossierMiddleware(req, res, next) {
    const id = req.user && req.user.entreprise;
    if (!id) {
      // Le choix d'un dossier passe par des routes qui, par définition, n'en
      // exigent pas ; tout le reste est refusé ici plutôt que plus bas. Laissé
      // à la vérification de rôle, l'appel aurait répondu « privilèges
      // insuffisants » — un message qui envoie chercher un problème de droits
      // là où il n'y a qu'un dossier à ouvrir.
      if (req.path.startsWith('/entreprises')) return next();
      return res.status(409).json({
        error: "Aucun dossier d'entreprise n'est ouvert. Choisissez-en un pour continuer."
      });
    }

    try {
      const entreprise = await comptesDb.get(
        'SELECT id, nom, chemin FROM entreprises WHERE id = ? AND archive = 0',
        [id]
      );
      const role = entreprise ? await roleSur(comptesDb, req.user.sub, id) : null;
      if (!entreprise || !role) {
        return res.status(403).json({ error: "Ce dossier ne vous est plus accessible." });
      }

      req.user.role = role;
      req.entreprise = entreprise;

      const base = await ouvrirEntreprise(entreprise.chemin);
      return avecDossier({ db: base, entreprise }, next);
    } catch (error) {
      return next(error);
    }
  }
  app.use('/api', dossierMiddleware);

  // Le choix d'un dossier doit rester possible quand aucun n'est ouvert : ce
  // routeur est donc monté avant tous ceux qui en exigent un.
  app.use('/api/entreprises', entrepriseRoutes(getComptesDb));

  app.use('/api/users', userRoutes(getDb, getComptesDb));
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
  app.use('/api/sauvegardes', sauvegardeRoutes(getDb));
  app.use('/api/audit', auditRoutes(getDb));
  app.use('/api/import', importRoutes(getDb));
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
  // Le registre est ouvert avant toute base d'entreprise : c'est lui qui dit
  // où elles se trouvent, et c'est lui qui fait basculer une installation
  // mono-entreprise vers le multi-dossier, sans rien déplacer ni supprimer.
  const comptesDb = await ouvrirComptes();
  await migrerSiNecessaire(comptesDb);

  const premier = await comptesDb.get('SELECT chemin FROM entreprises WHERE archive = 0 ORDER BY id LIMIT 1');
  const db = premier ? await ouvrirEntreprise(premier.chemin) : await initDb();

  const app = createApp(db, { comptesDb });

  startScheduler(comptesDb);

  return new Promise((resolve, reject) => {
    const server = app.listen(port, HOST, () => {
      const actualPort = server.address().port;
      console.log(`\nServeur Clora démarré sur http://${HOST}:${actualPort}`);
      resolve({ app, server, db, comptesDb, port: actualPort });
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
