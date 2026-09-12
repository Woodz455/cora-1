/**
 * Premiers pas du dossier : la liste que le tableau de bord montre tant qu'il
 * reste quelque chose à régler.
 *
 * Réservée à l'administration : presque toutes les étapes mènent aux
 * paramètres, qu'un employé ou un comptable ne peut pas modifier. Leur montrer
 * une liste de choses à faire qu'ils ne peuvent pas faire n'aiderait personne.
 */

const express = require('express');

const { adminOnly } = require('../authMiddleware.js');
const { asyncRoute } = require('../httpUtils.js');
const { etatDemarrage } = require('../profils.js');

module.exports = function demarrageRoutes(getDb, getComptesDb) {
  const router = express.Router();
  router.use(adminOnly());

  router.get('/', asyncRoute(async (req, res) => {
    res.json(await etatDemarrage(getDb(), getComptesDb(), req.entreprise.id));
  }));

  /**
   * Masque la liste. Elle réapparaît si le profil du dossier change : qui
   * choisit un autre profil veut voir le chemin qui va avec.
   */
  router.post('/masquer', asyncRoute(async (req, res) => {
    await getDb().run('UPDATE settings SET demarrage_masque = 1');
    res.json({ masque: true });
  }));

  return router;
};
