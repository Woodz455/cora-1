/**
 * Routes du catalogue de produits et services.
 */

const express = require('express');

const {
  getCatalogue, createCatalogueItem, updateCatalogueItem, deleteCatalogueItem
} = require('../catalogueService.js');
const { anyRole } = require('../authMiddleware.js');
const { asyncRoute, httpError } = require('../httpUtils.js');
const { parseId } = require('../validators.js');

function requireId(req) {
  const id = parseId(req.params.id);
  if (!id) throw httpError(400, "Identifiant d'article invalide.");
  return id;
}

module.exports = function catalogueRoutes(getDb) {
  const router = express.Router();
  router.use(anyRole());

  router.get('/', asyncRoute(async (req, res) => {
    res.json(await getCatalogue(getDb()));
  }));

  router.post('/', asyncRoute(async (req, res) => {
    res.status(201).json(await createCatalogueItem(getDb(), req.body));
  }));

  router.put('/:id', asyncRoute(async (req, res) => {
    res.json(await updateCatalogueItem(getDb(), requireId(req), req.body));
  }));

  router.delete('/:id', asyncRoute(async (req, res) => {
    res.json(await deleteCatalogueItem(getDb(), requireId(req)));
  }));

  return router;
};
