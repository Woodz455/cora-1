/**
 * Routes de rapprochement bancaire.
 */

const express = require('express');

const {
  getTransactions, getTransaction, getImputations,
  importerTransactions, rapprocher, ignorer, STATUTS, MAX_LIGNES
} = require('../bankService.js');
const { adminOrAccountant } = require('../authMiddleware.js');
const { asyncRoute, httpError } = require('../httpUtils.js');
const { parseId, parsePositiveAmount, isValidDate, sanitizeText } = require('../validators.js');
const { journaliser, ACTIONS } = require('../auditService.js');

/** Normalise une ligne de relevé, ou retourne null si elle est illisible. */
function validerLigne(ligne) {
  const montant = Number(ligne.montant);
  const date = ligne.date_transaction;
  const description = sanitizeText(ligne.description, 300);

  if (!isValidDate(date) || !Number.isFinite(montant) || !description) return null;
  return { date, description, montant };
}

module.exports = function banqueRoutes(getDb) {
  const router = express.Router();
  router.use(adminOrAccountant());

  /**
   * Importe un relevé bancaire. Seuls les dépôts (montants positifs) sont
   * retenus, et les lignes déjà présentes sont ignorées.
   */
  router.post('/import', asyncRoute(async (req, res) => {
    const lignes = req.body;
    if (!Array.isArray(lignes)) {
      throw httpError(400, 'Le corps de la requête doit être un tableau de transactions.');
    }
    if (lignes.length > MAX_LIGNES) {
      throw httpError(400, `Un relevé ne peut pas comporter plus de ${MAX_LIGNES} lignes.`);
    }

    const resultat = await importerTransactions(getDb(), lignes, { valider: validerLigne });
    res.json({ success: true, ...resultat });
  }));

  /**
   * Sans paramètre, retourne les dépôts qu'il reste à traiter — en attente et
   * partiellement imputés : les uns comme les autres ont encore de l'argent à
   * affecter.
   */
  router.get('/transactions', asyncRoute(async (req, res) => {
    res.json(await getTransactions(getDb(), req.query.status));
  }));

  /** Détail des imputations d'un dépôt, annulées comprises. */
  router.get('/transactions/:id/imputations', asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) throw httpError(400, 'Identifiant de transaction invalide.');

    const transaction = await getTransaction(getDb(), id);
    if (!transaction) throw httpError(404, 'Transaction non trouvée.');

    res.json({ transaction, imputations: await getImputations(getDb(), id) });
  }));

  /**
   * Impute tout ou partie d'un dépôt sur une facture.
   *
   * `montant` est facultatif : à défaut, on impute le plus petit du reste du
   * dépôt et du solde de la facture.
   */
  router.post('/rapprocher/:id', asyncRoute(async (req, res) => {
    const transactionId = parseId(req.params.id);
    const factureId = parseId(req.body.facture_id);

    if (!transactionId) throw httpError(400, 'Identifiant de transaction invalide.');
    if (!factureId) throw httpError(400, 'Une facture doit être sélectionnée.');

    let montant = null;
    if (req.body.montant !== undefined && req.body.montant !== null && req.body.montant !== '') {
      montant = parsePositiveAmount(req.body.montant);
      if (!montant) throw httpError(400, 'Le montant à imputer est invalide.');
    }

    const avant = await getTransaction(getDb(), transactionId);
    const transaction = await rapprocher(getDb(), transactionId, factureId, montant);
    const facture = await getDb().get('SELECT numero_facture FROM factures WHERE id = ?', [factureId]);
    await journaliser(getDb(), req, {
      action: ACTIONS.BANQUE_RAPPROCHEMENT,
      entite: 'transaction_bancaire',
      entite_id: transactionId,
      details: {
        depot: transaction.description,
        date_transaction: transaction.date_transaction,
        facture: facture ? facture.numero_facture : factureId,
        montant_impute: Math.round(((transaction.montant_rapproche || 0) - ((avant && avant.montant_rapproche) || 0)) * 100) / 100
      }
    });
    res.json({
      success: true,
      message: transaction.statut === STATUTS.RAPPROCHE
        ? 'Dépôt entièrement imputé.'
        : 'Imputation enregistrée ; ce dépôt garde un reste à affecter.',
      transaction
    });
  }));

  router.post('/ignorer/:id', asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) throw httpError(400, 'Identifiant de transaction invalide.');

    const transaction = await getTransaction(getDb(), id);
    const resultat = await ignorer(getDb(), id);
    await journaliser(getDb(), req, {
      action: ACTIONS.BANQUE_DEPOT_IGNORE,
      entite: 'transaction_bancaire',
      entite_id: id,
      details: { depot: transaction.description, date_transaction: transaction.date_transaction, montant: transaction.montant }
    });
    res.json(resultat);
  }));

  return router;
};
