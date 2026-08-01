/**
 * Routes de facturation.
 *
 * Chaque route porte une contrainte de rôle explicite. Auparavant, seules les
 * routes « Rapports », « Dépenses » et « Banque » étaient protégées : un compte
 * `employe` pouvait notamment supprimer définitivement une facture payée, ses
 * paiements partant en cascade.
 */

const express = require('express');

const {
  getFacturesAvecSoldes, getSoldeFacture, getFactureDetails,
  addPaiement, annulerPaiement, createFacture, updateFacture, cancelFacture, deleteFacture
} = require('../invoiceService.js');
const { anyRole, adminOnly, adminOrAccountant } = require('../authMiddleware.js');
const { journaliser, ACTIONS } = require('../auditService.js');
const { asyncRoute, httpError } = require('../httpUtils.js');
const {
  parseId, parsePositiveAmount, isValidDate,
  sanitizeText, normalizeCurrency, validateLignes
} = require('../validators.js');

/** Extrait un identifiant de facture valide, ou lève une 400. */
function requireId(req) {
  const id = parseId(req.params.id);
  if (!id) throw httpError(400, 'Identifiant de facture invalide.');
  return id;
}

/** Valide le corps d'une création ou d'une modification de facture. */
function parseFacturePayload(body, { requireDateEmission }) {
  const client_id = parseId(body.client_id);
  if (!client_id) throw httpError(400, 'Un client doit être sélectionné.');

  if (requireDateEmission && !isValidDate(body.date_emission)) {
    throw httpError(400, "La date d'émission est requise (format AAAA-MM-JJ).");
  }
  if (!isValidDate(body.date_echeance)) {
    throw httpError(400, "La date d'échéance est requise (format AAAA-MM-JJ).");
  }
  if (requireDateEmission && body.date_echeance < body.date_emission) {
    throw httpError(400, "La date d'échéance ne peut pas précéder la date d'émission.");
  }

  const devise = normalizeCurrency(body.devise, body.taux_change);
  if (devise.error) throw httpError(400, devise.error);

  const lignes = validateLignes(body.lignes);
  if (lignes.error) throw httpError(400, lignes.error);

  return {
    client_id,
    date_emission: body.date_emission,
    date_echeance: body.date_echeance,
    devise: devise.devise,
    taux_change: devise.taux_change,
    lignes: lignes.lignes
  };
}

module.exports = function factureRoutes(getDb) {
  const router = express.Router();

  router.get('/', anyRole(), asyncRoute(async (req, res) => {
    res.json(await getFacturesAvecSoldes(getDb()));
  }));

  router.get('/:id/solde', anyRole(), asyncRoute(async (req, res) => {
    const facture = await getSoldeFacture(getDb(), requireId(req));
    if (!facture) throw httpError(404, 'Facture non trouvée.');
    res.json(facture);
  }));

  router.get('/:id/details', anyRole(), asyncRoute(async (req, res) => {
    const details = await getFactureDetails(getDb(), requireId(req));
    if (!details) throw httpError(404, 'Facture non trouvée.');
    res.json(details);
  }));

  router.post('/', anyRole(), asyncRoute(async (req, res) => {
    const payload = parseFacturePayload(req.body, { requireDateEmission: true });
    const facture = await createFacture(getDb(), payload, payload.lignes);
    res.status(201).json({ message: 'Facture créée avec succès.', facture });
  }));

  router.put('/:id', anyRole(), asyncRoute(async (req, res) => {
    const payload = parseFacturePayload(req.body, { requireDateEmission: false });
    const facture = await updateFacture(getDb(), requireId(req), payload, payload.lignes);
    res.json(facture);
  }));

  router.put('/:id/cancel', adminOrAccountant(), asyncRoute(async (req, res) => {
    const id = requireId(req);
    const facture = await cancelFacture(getDb(), id);

    await journaliser(getDb(), req, {
      action: ACTIONS.FACTURE_ANNULATION,
      entite: 'facture',
      entite_id: id,
      details: { numero: facture.numero_facture, montant_total: facture.montant_total }
    });

    res.json(facture);
  }));

  /**
   * Suppression définitive : réservée à l'administration, et refusée par le
   * service dès qu'un paiement est rattaché à la facture.
   */
  /**
   * Annule un encaissement saisi à tort.
   *
   * Réservé à l'administrateur : le comptable enregistre les encaissements,
   * revenir sur l'un d'eux touche à un montant déjà porté aux comptes.
   *
   * Déclarée avant `/:id`, sinon Express ferait correspondre « paiements » à un
   * identifiant de facture et refuserait la requête.
   */
  router.delete('/paiements/:paiementId', adminOnly(), asyncRoute(async (req, res) => {
    const paiementId = parseId(req.params.paiementId);
    if (!paiementId) throw httpError(400, 'Identifiant de paiement invalide.');

    const motif = sanitizeText(req.body && req.body.motif, 300);
    const facture = await annulerPaiement(getDb(), paiementId, {
      motif,
      utilisateur: req.user && req.user.username
    });

    await journaliser(getDb(), req, {
      action: ACTIONS.PAIEMENT_ANNULATION,
      entite: 'paiement',
      entite_id: paiementId,
      details: { facture: facture.numero_facture, facture_id: facture.id, motif: motif || null }
    });

    res.json({ message: 'Paiement annulé.', facture });
  }));

  router.delete('/:id', adminOnly(), asyncRoute(async (req, res) => {
    const id = requireId(req);

    // Le numéro est relevé avant la suppression : après, il n'existe plus rien
    // à nommer, et une trace sans numéro de facture n'aide personne.
    const avant = await getDb().get('SELECT numero_facture FROM factures WHERE id = ?', [id]);
    const resultat = await deleteFacture(getDb(), id);

    await journaliser(getDb(), req, {
      action: ACTIONS.FACTURE_SUPPRESSION,
      entite: 'facture',
      entite_id: id,
      details: { numero: avant ? avant.numero_facture : null }
    });

    res.json(resultat);
  }));

  /** Encaissement d'un paiement : opération de trésorerie, hors périmètre d'un employé. */
  router.post('/:id/paiements', adminOrAccountant(), asyncRoute(async (req, res) => {
    const montant = parsePositiveAmount(req.body.montant);
    if (!montant) throw httpError(400, 'Le montant du paiement est invalide.');

    const date = req.body.date_paiement;
    if (date !== undefined && date !== null && date !== '' && !isValidDate(date)) {
      throw httpError(400, 'La date du paiement est invalide (format AAAA-MM-JJ).');
    }

    const facture = await addPaiement(
      getDb(), requireId(req), montant, sanitizeText(req.body.note, 300), date || null
    );
    res.json({ message: 'Paiement ajouté avec succès.', facture });
  }));

  /** Incrémente le compteur de relances après l'envoi d'un rappel. */
  router.post('/:id/relance/marquer', anyRole(), asyncRoute(async (req, res) => {
    const db = getDb();
    const id = requireId(req);

    const facture = await db.get('SELECT id FROM factures WHERE id = ?', [id]);
    if (!facture) throw httpError(404, 'Facture non trouvée.');

    await db.run(
      'UPDATE factures SET relances_envoyees = relances_envoyees + 1, date_derniere_relance = ? WHERE id = ?',
      [new Date().toISOString().split('T')[0], id]
    );
    res.json({ success: true });
  }));

  return router;
};
