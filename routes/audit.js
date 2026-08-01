/**
 * Consultation du journal d'audit.
 *
 * Lecture seule : le journal est en ajout seul, et aucune route n'expose de
 * modification ni de suppression. La base elle-même les refuserait de toute
 * façon (déclencheurs de `database.js`).
 */

const express = require('express');

const { adminOrAccountant } = require('../authMiddleware.js');
const { asyncRoute, httpError } = require('../httpUtils.js');
const { sanitizeText } = require('../validators.js');
const { lireJournal, auteursDuJournal, ACTIONS, LIBELLES } = require('../auditService.js');

/** Valide une date de filtre au format AAAA-MM-JJ. */
function parseDate(valeur, libelle) {
  if (valeur === undefined || valeur === null || valeur === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(valeur))) {
    throw httpError(400, `${libelle} doit être au format AAAA-MM-JJ.`);
  }
  return String(valeur);
}

module.exports = function auditRoutes(getDb) {
  const router = express.Router();

  // Même niveau que les rapports : le comptable a besoin de voir ce qui a
  // bougé, c'est précisément le public visé par cette fonctionnalité.
  router.use(adminOrAccountant());

  router.get('/', asyncRoute(async (req, res) => {
    const action = sanitizeText(req.query.action, 60);
    if (action && !Object.values(ACTIONS).includes(action)) {
      throw httpError(400, `Action inconnue : ${action}.`);
    }

    const resultat = await lireJournal(getDb(), {
      action: action || null,
      utilisateur: sanitizeText(req.query.utilisateur, 60) || null,
      entite: sanitizeText(req.query.entite, 40) || null,
      depuis: parseDate(req.query.depuis, 'La date de début'),
      jusqu: parseDate(req.query.jusqu, 'La date de fin'),
      page: req.query.page,
      parPage: req.query.parPage
    });

    res.json(resultat);
  }));

  /** Valeurs disponibles pour alimenter les filtres de l'écran. */
  router.get('/filtres', asyncRoute(async (req, res) => {
    res.json({
      actions: Object.values(ACTIONS).map((a) => ({ valeur: a, libelle: LIBELLES[a] })),
      auteurs: await auteursDuJournal(getDb())
    });
  }));

  return router;
};
