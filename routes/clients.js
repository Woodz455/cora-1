/**
 * Routes du répertoire clients.
 */

const express = require('express');

const { getClients, createClient, updateClient } = require('../clientService.js');
const { anyRole } = require('../authMiddleware.js');
const { journaliser, ecart, ACTIONS } = require('../auditService.js');
const { asyncRoute, httpError } = require('../httpUtils.js');
const { parseId, sanitizeText, validateClient } = require('../validators.js');

/** Champs dont la modification mérite une trace. */
const CHAMPS_SUIVIS = [
  'nom_entreprise', 'nom_contact', 'email', 'adresse', 'langue', 'province',
  // Le terme conditionne l'échéance des factures à venir : le voir changer sans
  // savoir qui l'a fait poserait exactement le problème que le journal résout.
  'conditions_paiement'
];

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

    const avant = await getDb().get('SELECT * FROM clients WHERE id = ?', [id]);
    const modifie = await updateClient(getDb(), id, client);

    // Seuls les champs réellement modifiés sont consignés : recopier la fiche
    // entière à chaque enregistrement noierait le changement qu'on cherche.
    const changements = ecart(avant, modifie, CHAMPS_SUIVIS);
    if (changements) {
      await journaliser(getDb(), req, {
        action: ACTIONS.CLIENT_MODIFICATION,
        entite: 'client',
        entite_id: id,
        details: { nom: modifie.nom_entreprise, changements }
      });
    }

    res.json({ message: 'Client modifié avec succès.', client: modifie });
  }));

  return router;
};
