/**
 * Routes des rapports et du tableau de bord.
 */

const express = require('express');

const { getReportStats, getDashboardStats, getTaxReport } = require('../invoiceService.js');
const { anyRole, adminOrAccountant } = require('../authMiddleware.js');
const { asyncRoute, httpError } = require('../httpUtils.js');

module.exports = function rapportRoutes(getDb) {
  const router = express.Router();

  /** Indicateurs du tableau de bord d'accueil : visibles par tous les rôles. */
  router.get('/stats', anyRole(), asyncRoute(async (req, res) => {
    res.json(await getDashboardStats(getDb()));
  }));

  router.get('/rapports', adminOrAccountant(), asyncRoute(async (req, res) => {
    res.json(await getReportStats(getDb()));
  }));

  router.get('/rapports/taxes', adminOrAccountant(), asyncRoute(async (req, res) => {
    const { annee, mois } = req.query;

    if (annee !== undefined && !/^\d{4}$/.test(String(annee))) {
      throw httpError(400, "L'année doit être au format AAAA.");
    }
    if (mois !== undefined && !/^(0?[1-9]|1[0-2])$/.test(String(mois))) {
      throw httpError(400, 'Le mois doit être un nombre entre 1 et 12.');
    }

    res.json(await getTaxReport(getDb(), annee, mois));
  }));

  return router;
};
