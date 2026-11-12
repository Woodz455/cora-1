/**
 * Téléchargement du rapport de diagnostic.
 */

const express = require('express');

const { adminOnly } = require('../authMiddleware.js');
const { asyncRoute } = require('../httpUtils.js');
const { composerDiagnostic } = require('../diagnosticService.js');
const { aujourdhui } = require('../dates.js');

module.exports = function diagnosticRoutes(getDb, getComptesDb) {
  const router = express.Router();

  // Réservé à l'administrateur : le rapport décrit l'installation entière.
  router.get('/', adminOnly(), asyncRoute(async (req, res) => {
    const texte = await composerDiagnostic(getDb(), getComptesDb(), req.entreprise);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="clora-diagnostic-${aujourdhui()}.txt"`);
    res.send(texte);
  }));

  return router;
};
