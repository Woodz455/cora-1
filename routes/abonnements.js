/**
 * Routes de facturation récurrente (abonnements).
 */

const express = require('express');

const {
  getSubscriptions, createSubscription, updateSubscription, deleteSubscription
} = require('../subscriptionService.js');
const { runOnce } = require('../scheduler.js');
const { anyRole, adminOrAccountant } = require('../authMiddleware.js');
const { asyncRoute, httpError } = require('../httpUtils.js');
const { parseId, isValidDate, sanitizeText } = require('../validators.js');

function requireId(req) {
  const id = parseId(req.params.id);
  if (!id) throw httpError(400, "Identifiant d'abonnement invalide.");
  return id;
}

module.exports = function abonnementRoutes(getDb) {
  const router = express.Router();

  router.get('/', anyRole(), asyncRoute(async (req, res) => {
    res.json(await getSubscriptions(getDb()));
  }));

  router.post('/', adminOrAccountant(), asyncRoute(async (req, res) => {
    const titre = sanitizeText(req.body.titre, 200);
    if (!titre) throw httpError(400, "Le titre de l'abonnement est requis.");
    if (!isValidDate(req.body.date_prochaine_generation)) {
      throw httpError(400, 'La date de prochaine génération est requise (format AAAA-MM-JJ).');
    }

    const sub = await createSubscription(getDb(), { ...req.body, titre });
    res.status(201).json(sub);
  }));

  router.put('/:id', adminOrAccountant(), asyncRoute(async (req, res) => {
    if (req.body.date_prochaine_generation !== undefined && !isValidDate(req.body.date_prochaine_generation)) {
      throw httpError(400, 'La date de prochaine génération est invalide (format AAAA-MM-JJ).');
    }
    res.json(await updateSubscription(getDb(), requireId(req), req.body));
  }));

  router.delete('/:id', adminOrAccountant(), asyncRoute(async (req, res) => {
    res.json(await deleteSubscription(getDb(), requireId(req)));
  }));

  /**
   * Déclenche immédiatement la génération des factures dues, sans attendre le
   * passage périodique du planificateur.
   */
  router.post('/generer', adminOrAccountant(), asyncRoute(async (req, res) => {
    await runOnce(getDb());
    res.json({ success: true, message: 'Vérification des abonnements effectuée.' });
  }));

  return router;
};
