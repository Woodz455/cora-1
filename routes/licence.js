/**
 * État et activation de la licence.
 *
 * Monté avant la garde de licence, comme le routeur des dossiers l'est avant
 * celle des dossiers : on ne peut pas exiger une licence valide pour atteindre
 * l'écran qui sert justement à en saisir une.
 *
 * La consultation de l'état ne demande aucune session. Un essai expiré bloque
 * l'application **avant** la connexion — refuser l'information à quelqu'un qui
 * ne peut pas se connecter le laisserait devant un écran muet.
 */

const express = require('express');

const { asyncRoute, httpError } = require('../httpUtils.js');
const { etatLicence, activer } = require('../licenceService.js');

module.exports = function licenceRoutes(getComptesDb) {
  const router = express.Router();

  router.get('/', asyncRoute(async (req, res) => {
    res.json(await etatLicence(getComptesDb()));
  }));

  router.post('/activer', asyncRoute(async (req, res) => {
    const cle = req.body && req.body.cle;
    if (typeof cle !== 'string' || !cle.trim()) {
      throw httpError(400, 'Saisissez votre clé de licence.');
    }

    // `activer` lève une 400 explicite si la clé n'est pas authentique ou si sa
    // maintenance ne couvre pas la version installée.
    res.json(await activer(getComptesDb(), cle));
  }));

  return router;
};
