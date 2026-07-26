/**
 * Routes du répertoire clients.
 */

const express = require('express');

const { getClients, createClient, updateClient } = require('../clientService.js');
const { anyRole } = require('../authMiddleware.js');
const { asyncRoute, httpError } = require('../httpUtils.js');
const { parseId, sanitizeText, validateClient } = require('../validators.js');

module.exports = function clientRoutes(getDb) {
  const router = express.Router();
  router.use(anyRole());

  router.get('/', asyncRoute(async (req, res) => {
    res.json(await getClients(getDb(), sanitizeText(req.query.q, 100)));
  }));

  router.post('/', asyncRoute(async (req, res) => {
    const { error, client } = validateClient(req.body);
    if (error) throw httpError(400, error);

    const cree = await createClient(getDb(), client);
    res.status(201).json({ message: 'Client créé avec succès.', client: cree });
  }));

  router.put('/:id', asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) throw httpError(400, 'Identifiant de client invalide.');

    const { error, client } = validateClient(req.body);
    if (error) throw httpError(400, error);

    const modifie = await updateClient(getDb(), id, client);
    res.json({ message: 'Client modifié avec succès.', client: modifie });
  }));

  return router;
};
