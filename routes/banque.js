/**
 * Routes de rapprochement bancaire.
 */

const express = require('express');

const { addPaiement } = require('../invoiceService.js');
const { adminOrAccountant } = require('../authMiddleware.js');
const { withTransaction } = require('../dbUtils.js');
const { asyncRoute, httpError } = require('../httpUtils.js');
const { parseId, isValidDate, sanitizeText } = require('../validators.js');

/** Statuts d'une transaction importée. */
const STATUTS = { EN_ATTENTE: 'En attente', RAPPROCHE: 'Rapproché', IGNORE: 'Ignoré' };

/** Nombre maximal de lignes acceptées dans un relevé. */
const MAX_LIGNES = 5000;

module.exports = function banqueRoutes(getDb) {
  const router = express.Router();
  router.use(adminOrAccountant());

  /**
   * Importe un relevé bancaire. Seuls les dépôts (montants positifs) sont
   * retenus, et les lignes déjà présentes sont ignorées : réimporter le même
   * relevé dupliquait auparavant toutes ses transactions.
   */
  router.post('/import', asyncRoute(async (req, res) => {
    const transactions = req.body;
    if (!Array.isArray(transactions)) {
      throw httpError(400, 'Le corps de la requête doit être un tableau de transactions.');
    }
    if (transactions.length > MAX_LIGNES) {
      throw httpError(400, `Un relevé ne peut pas comporter plus de ${MAX_LIGNES} lignes.`);
    }

    const db = getDb();
    const resultat = await withTransaction(db, async () => {
      let inserted = 0;
      let ignored = 0;
      let invalid = 0;

      for (const t of transactions) {
        const montant = Number(t.montant);
        const date = t.date_transaction;
        const description = sanitizeText(t.description, 300);

        if (!isValidDate(date) || !Number.isFinite(montant) || !description) {
          invalid += 1;
          continue;
        }
        if (montant <= 0) {
          ignored += 1; // Retrait ou frais : hors périmètre du rapprochement de factures.
          continue;
        }

        const doublon = await db.get(
          `SELECT id FROM transactions_bancaires
           WHERE date_transaction = ? AND description = ? AND ABS(montant - ?) < 0.005`,
          [date, description, montant]
        );
        if (doublon) {
          ignored += 1;
          continue;
        }

        await db.run(
          'INSERT INTO transactions_bancaires (date_transaction, description, montant, statut) VALUES (?, ?, ?, ?)',
          [date, description, montant, STATUTS.EN_ATTENTE]
        );
        inserted += 1;
      }

      return { inserted, ignored, invalid };
    });

    res.json({ success: true, ...resultat });
  }));

  router.get('/transactions', asyncRoute(async (req, res) => {
    const statut = Object.values(STATUTS).includes(req.query.status)
      ? req.query.status
      : STATUTS.EN_ATTENTE;

    res.json(await getDb().all(
      'SELECT * FROM transactions_bancaires WHERE statut = ? ORDER BY date_transaction DESC, id DESC',
      [statut]
    ));
  }));

  /**
   * Rattache un dépôt à une facture et enregistre le paiement correspondant.
   *
   * Deux garde-fous absents jusqu'ici : le dépôt ne peut pas excéder le solde de
   * la facture (ce qui produisait un solde négatif), et une facture libellée en
   * devise étrangère est refusée, faute de quoi un dépôt en dollars canadiens
   * serait imputé tel quel sur un solde exprimé en dollars américains.
   */
  router.post('/rapprocher/:id', asyncRoute(async (req, res) => {
    const db = getDb();
    const transactionId = parseId(req.params.id);
    const factureId = parseId(req.body.facture_id);

    if (!transactionId) throw httpError(400, 'Identifiant de transaction invalide.');
    if (!factureId) throw httpError(400, 'Une facture doit être sélectionnée.');

    const transaction = await db.get('SELECT * FROM transactions_bancaires WHERE id = ?', [transactionId]);
    if (!transaction) throw httpError(404, 'Transaction non trouvée.');
    if (transaction.statut !== STATUTS.EN_ATTENTE) {
      throw httpError(400, 'Cette transaction est déjà traitée.');
    }

    const facture = await db.get('SELECT id, numero_facture, devise FROM factures WHERE id = ?', [factureId]);
    if (!facture) throw httpError(404, 'Facture non trouvée.');
    if ((facture.devise || 'CAD') !== 'CAD') {
      throw httpError(400,
        `La facture ${facture.numero_facture} est libellée en ${facture.devise} : saisissez le paiement manuellement dans sa devise.`);
    }

    // Paiement et marquage de la transaction dans une seule transaction, pour
    // qu'un dépôt ne puisse jamais être encaissé sans être marqué rapproché.
    await withTransaction(db, async () => {
      // addPaiement valide le solde, refuse le dépassement et met le statut à jour.
      // La transaction d'origine est mémorisée sur le paiement : annuler celui-ci
      // doit pouvoir la remettre en attente, sans deviner d'où il venait.
      await addPaiement(
        db, factureId, transaction.montant,
        `Rapprochement bancaire : ${transaction.description}`,
        transaction.date_transaction,
        transactionId
      );

      await db.run(
        'UPDATE transactions_bancaires SET statut = ?, facture_id = ? WHERE id = ?',
        [STATUTS.RAPPROCHE, factureId, transactionId]
      );
    });

    res.json({ success: true, message: 'Transaction rapprochée avec succès.' });
  }));

  router.post('/ignorer/:id', asyncRoute(async (req, res) => {
    const db = getDb();
    const id = parseId(req.params.id);
    if (!id) throw httpError(400, 'Identifiant de transaction invalide.');

    const transaction = await db.get('SELECT id, statut FROM transactions_bancaires WHERE id = ?', [id]);
    if (!transaction) throw httpError(404, 'Transaction non trouvée.');
    if (transaction.statut === STATUTS.RAPPROCHE) {
      throw httpError(400, 'Une transaction déjà rapprochée ne peut pas être ignorée.');
    }

    await db.run('UPDATE transactions_bancaires SET statut = ? WHERE id = ?', [STATUTS.IGNORE, id]);
    res.json({ success: true });
  }));

  return router;
};
