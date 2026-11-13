/**
 * Fabrication des PDF (voir pdfService.js).
 *
 * Deux temps : l'interface dépose le document et reçoit le PDF ; entre les
 * deux, une fenêtre cachée vient lire le document déposé, sous un jeton à
 * usage unique.
 */

const express = require('express');

const { anyRole } = require('../authMiddleware.js');
const { asyncRoute, httpError } = require('../httpUtils.js');
const { sanitizeText } = require('../validators.js');
const {
  deposerPage, prendrePage, imprimer, fabricationDisponible
} = require('../pdfService.js');

/** Taille maximale d'un document : le logo en data-URI en fait l'essentiel. */
const MAX_HTML = 8 * 1024 * 1024;

/**
 * La page déposée. Montée avant l'authentification : la fenêtre cachée qui la
 * lit partage la session de l'application, mais le jeton, tiré au hasard,
 * valable une minute et une seule fois, suffit à la protéger.
 */
function pagePdfRoutes() {
  const router = express.Router();
  router.get('/page/:jeton', (req, res) => {
    const document = prendrePage(req.params.jeton);
    if (!document) return res.status(404).type('text/plain').send('Page introuvable.');
    res.set('Cache-Control', 'no-store');
    return res.type('html').send(document);
  });
  return router;
}

/** Fabrication d'un PDF à partir du document affiché. */
function pdfRoutes(dossierClient) {
  const router = express.Router();

  router.post('/', anyRole(), asyncRoute(async (req, res) => {
    if (!fabricationDisponible()) {
      throw httpError(501, "La fabrication des PDF n'est possible que dans l'application de bureau.");
    }
    const html = req.body && req.body.html;
    if (typeof html !== 'string' || html.trim() === '') throw httpError(400, 'Le document à imprimer est vide.');
    if (html.length > MAX_HTML) throw httpError(413, 'Le document à imprimer est trop volumineux.');

    const jeton = deposerPage(html, {
      titre: sanitizeText(req.body.titre, 200),
      langue: req.body.langue === 'en' ? 'en' : 'fr',
      dossierClient
    });
    const pdf = await imprimer(`http://${req.get('host')}/api/pdf/page/${jeton}`);
    res.json({ pdf: `data:application/pdf;base64,${Buffer.from(pdf).toString('base64')}` });
  }));

  return router;
}

module.exports = { pagePdfRoutes, pdfRoutes };
