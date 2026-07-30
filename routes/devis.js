/**
 * Routes des devis (soumissions).
 */

const express = require('express');

const {
  getDevis, getDevisDetails, createDevis,
  updateDevis, cancelDevis, convertDevisToFacture
} = require('../devisService.js');
const { anyRole, adminOrAccountant } = require('../authMiddleware.js');
const { asyncRoute, httpError } = require('../httpUtils.js');
const { parseId, isValidDate, normalizeCurrency, validateLignes } = require('../validators.js');

function requireId(req) {
  const id = parseId(req.params.id);
  if (!id) throw httpError(400, 'Identifiant de devis invalide.');
  return id;
}

function parseDevisPayload(body, { requireDateEmission }) {
  const client_id = parseId(body.client_id);
  if (!client_id) throw httpError(400, 'Un client doit être sélectionné.');

  if (requireDateEmission && !isValidDate(body.date_emission)) {
    throw httpError(400, "La date d'émission est requise (format AAAA-MM-JJ).");
  }
  if (!isValidDate(body.date_validite)) {
    throw httpError(400, 'La date de validité est requise (format AAAA-MM-JJ).');
  }
  if (requireDateEmission && body.date_validite < body.date_emission) {
    throw httpError(400, "La date de validité ne peut pas précéder la date d'émission.");
  }

  const devise = normalizeCurrency(body.devise, body.taux_change);
  if (devise.error) throw httpError(400, devise.error);

  const lignes = validateLignes(body.lignes);
  if (lignes.error) throw httpError(400, lignes.error);

  return {
    client_id,
    date_emission: body.date_emission,
    date_validite: body.date_validite,
    devise: devise.devise,
    taux_change: devise.taux_change,
    lignes: lignes.lignes
  };
}

module.exports = function devisRoutes(getDb) {
  const router = express.Router();

  router.get('/', anyRole(), asyncRoute(async (req, res) => {
    res.json(await getDevis(getDb()));
  }));

  router.get('/:id/details', anyRole(), asyncRoute(async (req, res) => {
    const devis = await getDevisDetails(getDb(), requireId(req));
    if (!devis) throw httpError(404, 'Devis non trouvé.');
    res.json(devis);
  }));

  router.post('/', anyRole(), asyncRoute(async (req, res) => {
    const payload = parseDevisPayload(req.body, { requireDateEmission: true });
    const devis = await createDevis(getDb(), payload, payload.lignes);
    res.status(201).json(devis);
  }));

  router.put('/:id', anyRole(), asyncRoute(async (req, res) => {
    const payload = parseDevisPayload(req.body, { requireDateEmission: false });
    res.json(await updateDevis(getDb(), requireId(req), payload, payload.lignes));
  }));

  router.put('/:id/cancel', anyRole(), asyncRoute(async (req, res) => {
    res.json(await cancelDevis(getDb(), requireId(req)));
  }));

  /** La conversion crée une pièce comptable : elle relève de la comptabilité. */
  router.post('/:id/convert', adminOrAccountant(), asyncRoute(async (req, res) => {
    res.status(201).json(await convertDevisToFacture(getDb(), requireId(req)));
  }));

  return router;
};
