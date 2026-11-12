/**
 * Routes d'envoi de courriels.
 */

const express = require('express');

const { sendEmailWithAttachment } = require('../emailService.js');
const { anyRole } = require('../authMiddleware.js');
const { asyncRoute, httpError } = require('../httpUtils.js');
const { isValidEmailList, sanitizeText, parseId } = require('../validators.js');
const { journaliser, ACTIONS } = require('../auditService.js');

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
    // L'absence de configuration n'est plus contrôlée ici : `sendEmailWithAttachment`
    // lève la même erreur 503 avec le même message, et l'interroger deux fois
    // relisait la base pour rien.

    // L'expéditeur affiché reprend la raison sociale des paramètres plutôt qu'un
    // nom d'entreprise codé en dur.
    const settings = await getDb().get('SELECT entreprise_nom FROM settings LIMIT 1');

    await sendEmailWithAttachment(getDb(), {
      to,
      cc,
      subject: sanitizeText(subject, 300),
      text: sanitizeText(text, 5000),
      attachmentBase64,
      filename: sanitizeText(filename, 150) || 'document.pdf'
    }, settings || {});

    // L'interface dit quelle facture part : l'envoi est daté sur la facture (le
    // premier seulement) et consigné au journal à chaque fois.
    const factureId = parseId(req.body.facture_id);
    if (factureId) {
      const facture = await getDb().get('SELECT id, numero_facture FROM factures WHERE id = ?', [factureId]);
      if (facture) {
        await getDb().run(
          'UPDATE factures SET envoyee_le = COALESCE(envoyee_le, ?) WHERE id = ?',
          [new Date().toISOString(), factureId]
        );
        await journaliser(getDb(), req, {
          action: ACTIONS.FACTURE_ENVOI,
          entite: 'facture',
          entite_id: factureId,
          details: { numero: facture.numero_facture, destinataire: sanitizeText(to, 300) }
        });
      }
    }

    res.json({ message: 'Courriel envoyé avec succès.' });
  }));

  return router;
};
