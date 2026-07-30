/**
 * Utilitaires HTTP partagés par les routes.
 */

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
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
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

module.exports = { asyncRoute, apiNotFound, errorHandler, httpError };
