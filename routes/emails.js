/**
 * Routes d'envoi de courriels.
 */

const express = require('express');

const { sendEmailWithAttachment, isConfigured } = require('../emailService.js');
const { anyRole } = require('../authMiddleware.js');
const { asyncRoute, httpError } = require('../httpUtils.js');
const { isValidEmailList, sanitizeText } = require('../validators.js');

module.exports = function emailRoutes(getDb) {
  const router = express.Router();

  // La limite de corps élargie pour cette route est appliquée dans server.js,
  // avant l'analyse du JSON.
  router.post('/send', anyRole(), asyncRoute(async (req, res) => {
    const { to, cc, subject, text, attachmentBase64, filename } = req.body;

    if (!isValidEmailList(to)) {
      throw httpError(400, 'Le destinataire est invalide.');
    }
    if (cc && !isValidEmailList(cc)) {
      throw httpError(400, "L'adresse en copie est invalide.");
    }
    if (typeof attachmentBase64 !== 'string' || attachmentBase64.length === 0) {
      throw httpError(400, 'La pièce jointe est requise.');
    }
    if (!isConfigured()) {
      throw httpError(503, "L'envoi de courriels n'est pas configuré : renseignez SMTP_HOST, SMTP_USER et SMTP_PASS dans le fichier .env.");
    }

    // L'expéditeur affiché reprend la raison sociale des paramètres plutôt qu'un
    // nom d'entreprise codé en dur.
    const settings = await getDb().get('SELECT entreprise_nom FROM settings LIMIT 1');

    await sendEmailWithAttachment({
      to,
      cc,
      subject: sanitizeText(subject, 300),
      text: sanitizeText(text, 5000),
      attachmentBase64,
      filename: sanitizeText(filename, 150) || 'document.pdf'
    }, settings || {});

    res.json({ message: 'Courriel envoyé avec succès.' });
  }));

  return router;
};
