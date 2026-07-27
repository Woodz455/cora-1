/**
 * Routes des relances de paiement.
 */

const express = require('express');

const { envoyerRelancesDues, getRelancesDues, getRelances, parsePaliers } = require('../relanceService.js');
const { SMTP_NON_CONFIGURE } = require('../emailService.js');
const { anyRole, adminOrAccountant } = require('../authMiddleware.js');
const { asyncRoute, httpError } = require('../httpUtils.js');
const { parseId } = require('../validators.js');

module.exports = function relanceRoutes(getDb) {
  const router = express.Router();

  /** Journal des relances d'une facture. */
  router.get('/facture/:id', anyRole(), asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) throw httpError(400, 'Identifiant de facture invalide.');
    res.json(await getRelances(getDb(), id));
  }));

  /**
   * Relances qui partiraient au prochain passage.
   * Permet de vérifier le réglage des paliers avant d'activer l'envoi.
   */
  router.get('/dues', adminOrAccountant(), asyncRoute(async (req, res) => {
    const db = getDb();
    const settings = await db.get('SELECT relances_actives, relances_paliers FROM settings LIMIT 1');
    const paliers = parsePaliers(settings && settings.relances_paliers);
    const dues = await getRelancesDues(db, paliers);

    res.json({
      actives: Boolean(settings && settings.relances_actives),
      paliers,
      factures: dues.map((f) => ({
        id: f.id,
        numero_facture: f.numero_facture,
        client: f.client,
        email: f.email,
        date_echeance: f.date_echeance,
        retard: f.retard,
        palier: f.palier,
        solde_restant: f.solde_restant,
        devise: f.devise
      }))
    });
  }));

  /** Déclenche immédiatement l'envoi des relances dues. */
  router.post('/envoyer', adminOrAccountant(), asyncRoute(async (req, res) => {
    const resultat = await envoyerRelancesDues(getDb());

    if (resultat.inactif) {
      throw httpError(400, 'Les relances automatiques sont désactivées dans les paramètres.');
    }
    if (resultat.smtpManquant) {
      throw httpError(503, SMTP_NON_CONFIGURE);
    }

    res.json(resultat);
  }));

  return router;
};
