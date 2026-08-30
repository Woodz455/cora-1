/**
 * Routes du paiement de facture en ligne.
 *
 * La fabrication d'un lien est ouverte à tous les rôles : elle accompagne
 * l'envoi d'une facture, que l'employé qui l'a émise doit pouvoir faire. Le
 * relevé manuel et la liste des règlements non imputés touchent en revanche à
 * la trésorerie, et suivent le même partage que l'encaissement d'un paiement.
 */

const express = require('express');

const { anyRole, adminOrAccountant } = require('../authMiddleware.js');
const { asyncRoute, httpError } = require('../httpUtils.js');
const { parseId } = require('../validators.js');
const {
  lienPourFacture, relever, configuration, encaissementsEnSouffrance
} = require('../paiementEnLigneService.js');

module.exports = function paiementEnLigneRoutes(getDb) {
  const router = express.Router();

  /**
   * État du paiement en ligne pour le dossier ouvert.
   * La clé n'en fait évidemment pas partie : seul son mode est utile à
   * l'interface, qui doit signaler un compte en mode test.
   */
  router.get('/etat', anyRole(), asyncRoute(async (req, res) => {
    const config = await configuration(getDb());
    res.json({
      actif: config.actif,
      mode: config.mode,
      restreinte: config.restreinte,
      cle_illisible: config.cleIllisible
    });
  }));

  /**
   * Lien de paiement d'une facture, créé au besoin.
   *
   * Répond `{ lien: null }` — et non une erreur — lorsqu'il n'y a rien à
   * proposer : paiement en ligne désactivé, facture annulée ou déjà soldée.
   * L'appel part du simple affichage d'une facture, et une situation normale ne
   * doit pas s'afficher comme un échec.
   */
  router.post('/factures/:id/lien', anyRole(), asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) throw httpError(400, 'Identifiant de facture invalide.');

    const lien = await lienPourFacture(getDb(), id);
    if (!lien) return res.json({ lien: null });

    res.json({
      lien: {
        url: lien.url,
        montant: lien.montant,
        devise: lien.devise,
        mode: lien.mode
      }
    });
  }));

  /** Relève immédiatement les règlements, sans attendre le passage horaire. */
  router.post('/relever', adminOrAccountant(), asyncRoute(async (req, res) => {
    const bilan = await relever(getDb());
    res.json(bilan);
  }));

  /** Règlements reçus que Clora n'a pas pu imputer. */
  router.get('/en-souffrance', adminOrAccountant(), asyncRoute(async (req, res) => {
    res.json({ encaissements: await encaissementsEnSouffrance(getDb()) });
  }));

  return router;
};
