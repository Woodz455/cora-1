/**
 * Utilitaires HTTP partagés par les routes.
 */

/** Message des déclencheurs de verrouillage (voir verrouillage.js, qui dépend de ce module). */
const MARQUE_VERROU = 'CLORA_PERIODE_VERROUILLEE';

/**
 * Encapsule un gestionnaire asynchrone pour que toute exception parte vers le
 * middleware d'erreur.
 *
 * Chaque route portait auparavant son propre try/catch, souvent avec un message
 * générique qui masquait la cause réelle et un code de statut arbitraire.
 */
function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

/** Répond en JSON aux routes d'API inconnues, plutôt qu'en HTML. */
function apiNotFound(req, res) {
  res.status(404).json({ error: `Route inconnue : ${req.method} ${req.originalUrl}` });
}

/**
 * Middleware d'erreur unique.
 *
 * Les services attachent un `status` à leurs erreurs métier ; tout le reste est
 * une anomalie serveur, journalisée intégralement mais renvoyée sans détail
 * technique au client.
 *
 * Une erreur 5xx délibérée (`expose`) fait exception : « SMTP n'est pas
 * configuré » dit à l'utilisateur quoi faire, alors que « Erreur interne du
 * serveur » l'envoie chercher dans les journaux d'un logiciel de bureau.
 */
function errorHandler(err, req, res, next) {
  // Une réponse déjà commencée (une archive en cours d'envoi) ne peut plus
  // devenir un message d'erreur : Express coupe alors la connexion, et le
  // téléchargement échoue plutôt que de livrer un fichier tronqué pour bon.
  if (res.headersSent) {
    console.error(`[${req.method} ${req.originalUrl}] interrompu :`, err.message);
    return next(err);
  }

  // Un déclencheur de verrouillage a refusé l'écriture : ce n'est pas une
  // anomalie, mais une règle que l'utilisateur doit comprendre. Les routes
  // vérifient d'ordinaire avant d'écrire ; ceci couvre les chemins indirects,
  // comme un recalcul d'indemnités kilométriques.
  if (err && String(err.message).includes(MARQUE_VERROU)) {
    return res.status(409).json({
      error: 'Cette opération toucherait une période verrouillée. Un administrateur peut la déverrouiller dans Paramètres.'
    });
  }

  const status = Number.isInteger(err.status) ? err.status : 500;

  if (status >= 500) {
    console.error(`[${req.method} ${req.originalUrl}]`, err);
    return res.status(status).json({ error: err.expose ? err.message : 'Erreur interne du serveur.' });
  }

  res.status(status).json({ error: err.message });
}

/**
 * Crée une erreur métier portant un code de statut HTTP.
 *
 * Le message est ici choisi pour être lu par l'utilisateur : il est donc
 * transmis tel quel, quel que soit le statut.
 */
function httpError(status, message) {
  return Object.assign(new Error(message), { status, expose: true });
}

module.exports = { asyncRoute, apiNotFound, errorHandler, httpError, MARQUE_VERROU };
