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
const { journaliser, ecart, ACTIONS } = require('../auditService.js');

/** Champs d'un abonnement dont un changement est consigné au journal. */
const CHAMPS_SUIVIS = ['titre', 'cycle', 'date_prochaine_generation', 'statut', 'devise', 'lignes_json'];

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
    await journaliser(getDb(), req, {
      action: ACTIONS.ABONNEMENT_CREATION,
      entite: 'abonnement',
      entite_id: sub.id,
      details: { titre: sub.titre, cycle: sub.cycle, date_prochaine_generation: sub.date_prochaine_generation }
    });
    res.status(201).json(sub);
  }));

  router.put('/:id', adminOrAccountant(), asyncRoute(async (req, res) => {
    if (req.body.date_prochaine_generation !== undefined && !isValidDate(req.body.date_prochaine_generation)) {
      throw httpError(400, 'La date de prochaine génération est invalide (format AAAA-MM-JJ).');
    }
    const id = requireId(req);
    const avant = await getDb().get('SELECT * FROM abonnements WHERE id = ?', [id]);
    const modifie = await updateSubscription(getDb(), id, req.body);

    const changements = ecart(avant, modifie, CHAMPS_SUIVIS);
    if (changements) {
      // Les lignes sont un bloc JSON : dire qu'elles ont changé suffit, les
      // recopier deux fois noierait le reste.
      if (changements.lignes_json) changements.lignes_json = { avant: 'lignes précédentes', apres: 'lignes modifiées' };
      await journaliser(getDb(), req, {
        action: ACTIONS.ABONNEMENT_MODIFICATION,
        entite: 'abonnement',
        entite_id: id,
        details: { titre: modifie.titre, changements }
      });
    }
    res.json(modifie);
  }));

  router.delete('/:id', adminOrAccountant(), asyncRoute(async (req, res) => {
    const id = requireId(req);
    const avant = await getDb().get('SELECT * FROM abonnements WHERE id = ?', [id]);
    const resultat = await deleteSubscription(getDb(), id);
    await journaliser(getDb(), req, {
      action: ACTIONS.ABONNEMENT_SUPPRESSION,
      entite: 'abonnement',
      entite_id: id,
      details: { titre: avant.titre, cycle: avant.cycle, statut: avant.statut }
    });
    res.json(resultat);
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
