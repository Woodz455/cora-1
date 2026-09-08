/**
 * Routes des dépenses et achats.
 */

const express = require('express');

const {
  getExpenses, getVehicules, createExpense, updateExpense, deleteExpense
} = require('../expenseService.js');
const { adminOrAccountant } = require('../authMiddleware.js');
const { asyncRoute, httpError } = require('../httpUtils.js');
const { parseId } = require('../validators.js');

function requireId(req) {
  const id = parseId(req.params.id);
  if (!id) throw httpError(400, 'Identifiant de dépense invalide.');
  return id;
}

module.exports = function depenseRoutes(getDb) {
  const router = express.Router();
  router.use(adminOrAccountant());

  router.get('/', asyncRoute(async (req, res) => {
    res.json(await getExpenses(getDb()));
  }));

  // Véhicules déjà employés, proposés en complétion : un acteur qui n'a qu'une
  // voiture ne doit pas la retaper à chaque trajet.
  router.get('/vehicules', asyncRoute(async (req, res) => {
    res.json(await getVehicules(getDb()));
  }));

  router.post('/', asyncRoute(async (req, res) => {
    res.status(201).json(await createExpense(getDb(), req.body));
  }));

  router.put('/:id', asyncRoute(async (req, res) => {
    res.json(await updateExpense(getDb(), requireId(req), req.body));
  }));

  router.delete('/:id', asyncRoute(async (req, res) => {
    res.json(await deleteExpense(getDb(), requireId(req)));
  }));

  return router;
};
