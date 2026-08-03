/**
 * Routes des notes de crédit.
 *
 * Émettre une note de crédit modifie ce qu'un client doit : c'est une opération
 * comptable, réservée à l'administration et à la comptabilité.
 */

const express = require('express');

const {
  getNotesCredit, getNoteCreditDetails, createNoteCredit, deleteNoteCredit
} = require('../noteCreditService.js');
const { anyRole, adminOnly, adminOrAccountant } = require('../authMiddleware.js');
const { journaliser, ACTIONS } = require('../auditService.js');
const { asyncRoute, httpError } = require('../httpUtils.js');
const { parseId, isValidDate, sanitizeText, validateLignes } = require('../validators.js');

function requireId(req) {
  const id = parseId(req.params.id);
  if (!id) throw httpError(400, 'Identifiant de note de crédit invalide.');
  return id;
}

module.exports = function noteCreditRoutes(getDb) {
  const router = express.Router();

  router.get('/', anyRole(), asyncRoute(async (req, res) => {
    res.json(await getNotesCredit(getDb()));
  }));

  router.get('/:id/details', anyRole(), asyncRoute(async (req, res) => {
    const note = await getNoteCreditDetails(getDb(), requireId(req));
    if (!note) throw httpError(404, 'Note de crédit non trouvée.');
    res.json(note);
  }));

  router.post('/', adminOrAccountant(), asyncRoute(async (req, res) => {
    const factureId = parseId(req.body.facture_id);
    if (!factureId) throw httpError(400, 'La facture à créditer doit être précisée.');

    if (!isValidDate(req.body.date_emission)) {
      throw httpError(400, "La date d'émission est requise (format AAAA-MM-JJ).");
    }

    const lignes = validateLignes(req.body.lignes);
    if (lignes.error) throw httpError(400, lignes.error);

    const note = await createNoteCredit(getDb(), factureId, {
      date_emission: req.body.date_emission,
      motif: sanitizeText(req.body.motif, 500)
    }, lignes.lignes);

    res.status(201).json(note);
  }));

  /** Suppression réservée à l'administration, et refusée dès qu'un paiement existe. */
  router.delete('/:id', adminOnly(), asyncRoute(async (req, res) => {
    const id = requireId(req);

    // Relevé avant la suppression : la note n'existera plus pour se nommer.
    const avant = await getDb().get(
      'SELECT numero_note, montant_total FROM notes_credit WHERE id = ?', [id]
    );
    const resultat = await deleteNoteCredit(getDb(), id);

    await journaliser(getDb(), req, {
      action: ACTIONS.NOTE_CREDIT_SUPPRESSION,
      entite: 'note_credit',
      entite_id: id,
      details: avant ? { numero: avant.numero_note, montant_total: avant.montant_total } : null
    });

    res.json(resultat);
  }));

  return router;
};
