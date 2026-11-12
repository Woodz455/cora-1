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
const { journaliser, ecart, ACTIONS } = require('../auditService.js');

/** Champs d'une dépense dont un changement est consigné au journal. */
const CHAMPS_SUIVIS = [
  'fournisseur', 'description', 'date_depense', 'montant_ht', 'tps', 'tvq',
  'montant_ttc', 'categorie', 'kilometres', 'vehicule'
];

/** Ce qui identifie une dépense dans le journal, sans la recopier entière. */
const resume = (d) => ({
  fournisseur: d.fournisseur, date_depense: d.date_depense, montant_ttc: d.montant_ttc, categorie: d.categorie
});

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
    const creee = await createExpense(getDb(), req.body);
    await journaliser(getDb(), req, {
      action: ACTIONS.DEPENSE_CREATION, entite: 'depense', entite_id: creee.id, details: resume(creee)
    });
    res.status(201).json(creee);
  }));

  router.put('/:id', asyncRoute(async (req, res) => {
    const id = requireId(req);
    const avant = await getDb().get('SELECT * FROM depenses WHERE id = ?', [id]);
    const modifiee = await updateExpense(getDb(), id, req.body);

    const changements = ecart(avant, modifiee, CHAMPS_SUIVIS);
    if (changements) {
      await journaliser(getDb(), req, {
        action: ACTIONS.DEPENSE_MODIFICATION,
        entite: 'depense',
        entite_id: id,
        details: { fournisseur: modifiee.fournisseur, changements }
      });
    }
    res.json(modifiee);
  }));

  router.delete('/:id', asyncRoute(async (req, res) => {
    const id = requireId(req);
    // Lue avant d'être effacée : le journal est tout ce qu'il en restera.
    const avant = await getDb().get('SELECT * FROM depenses WHERE id = ?', [id]);
    const resultat = await deleteExpense(getDb(), id);
    await journaliser(getDb(), req, {
      action: ACTIONS.DEPENSE_SUPPRESSION,
      entite: 'depense',
      entite_id: id,
      details: { ...resume(avant), description: avant.description, montant_ht: avant.montant_ht, tps: avant.tps, tvq: avant.tvq }
    });
    res.json(resultat);
  }));

  return router;
};
