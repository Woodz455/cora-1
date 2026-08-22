/**
 * Choix et création des dossiers d'entreprise.
 *
 * Ce routeur est le seul de l'API à répondre sans dossier ouvert : c'est lui
 * qui permet d'en ouvrir un. Il est donc monté avant tous les autres.
 */

const express = require('express');

const { asyncRoute, httpError } = require('../httpUtils.js');
const { sanitizeText } = require('../validators.js');
const { listerPourUtilisateur, creerEntreprise } = require('../companyStore.js');
const { emettreSession } = require('./auth.js');

module.exports = function entrepriseRoutes(getComptesDb) {
  const router = express.Router();

  /**
   * Dossiers accessibles à l'utilisateur connecté.
   *
   * Le rôle accompagne chaque dossier : l'interface doit pouvoir prévenir
   * qu'on entre quelque part en simple lecture, plutôt que de laisser
   * découvrir la restriction au premier bouton grisé.
   */
  router.get('/', asyncRoute(async (req, res) => {
    const dossiers = await listerPourUtilisateur(getComptesDb(), req.user.sub);
    res.json({
      entreprises: dossiers.map(({ id, nom, role, cree_le }) => ({ id, nom, role, cree_le })),
      ouvert: req.entreprise ? { id: req.entreprise.id, nom: req.entreprise.nom } : null
    });
  }));

  /**
   * Ouvre un dossier : la session est réémise en le désignant.
   *
   * Réémettre le jeton plutôt que de conserver le dossier côté serveur évite
   * toute session partagée entre deux fenêtres — deux onglets ouverts sur deux
   * clients différents resteraient sinon liés, et une facture partirait dans le
   * mauvais dossier.
   */
  router.post('/:id/ouvrir', asyncRoute(async (req, res) => {
    const comptesDb = getComptesDb();
    const id = Number.parseInt(req.params.id, 10);

    const dossiers = await listerPourUtilisateur(comptesDb, req.user.sub);
    const cible = dossiers.find((d) => d.id === id);
    if (!cible) throw httpError(404, "Ce dossier n'existe pas ou ne vous est pas accessible.");

    emettreSession(res, { id: req.user.sub, username: req.user.username, entreprise: cible.id });
    res.json({ ouvert: { id: cible.id, nom: cible.nom, role: cible.role } });
  }));

  /**
   * Crée un dossier vierge, dont le créateur devient administrateur.
   *
   * Aucune restriction de rôle : les rôles sont attachés à un dossier, et
   * exiger d'être administrateur *ailleurs* pour créer un dossier neuf n'aurait
   * pas de sens.
   */
  router.post('/', asyncRoute(async (req, res) => {
    const nom = sanitizeText(req.body && req.body.nom, 200);
    if (!nom) throw httpError(400, "Le nom de l'entreprise est requis.");

    const cree = await creerEntreprise(getComptesDb(), { nom, userId: req.user.sub });

    emettreSession(res, { id: req.user.sub, username: req.user.username, entreprise: cree.id });
    res.status(201).json({ entreprise: { id: cree.id, nom: cree.nom, role: 'admin' } });
  }));

  return router;
};
