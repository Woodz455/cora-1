/**
 * Choix et création des dossiers d'entreprise.
 *
 * Ce routeur est le seul de l'API à répondre sans dossier ouvert : c'est lui
 * qui permet d'en ouvrir un. Il est donc monté avant tous les autres.
 */

const express = require('express');

const { asyncRoute, httpError } = require('../httpUtils.js');
const { sanitizeText } = require('../validators.js');
const {
  listerPourUtilisateur, listerArchivesPourUtilisateur, creerEntreprise,
  renommerEntreprise, archiverEntreprise, roleSur
} = require('../companyStore.js');
const { parseProfil } = require('../profils.js');
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
    const archives = await listerArchivesPourUtilisateur(getComptesDb(), req.user.sub);
    res.json({
      entreprises: dossiers.map(({ id, nom, role, cree_le }) => ({ id, nom, role, cree_le })),
      archives,
      ouvert: req.entreprise ? { id: req.entreprise.id, nom: req.entreprise.nom } : null
    });
  }));

  /**
   * Seul un administrateur du dossier le renomme ou l'archive : ces gestes
   * changent ce que voient tous ceux qui y ont accès.
   */
  async function exigerAdministrateur(req) {
    const id = Number.parseInt(req.params.id, 10);
    const role = Number.isInteger(id) ? await roleSur(getComptesDb(), req.user.sub, id) : null;
    if (!role) throw httpError(404, "Ce dossier n'existe pas ou ne vous est pas accessible.");
    if (role !== 'admin') throw httpError(403, 'Accès refusé. Privilèges insuffisants.');
    return id;
  }

  router.put('/:id', asyncRoute(async (req, res) => {
    const id = await exigerAdministrateur(req);
    const nom = sanitizeText(req.body && req.body.nom, 200);
    if (!nom) throw httpError(400, "Le nom de l'entreprise est requis.");
    await renommerEntreprise(getComptesDb(), id, nom);
    res.json({ message: 'Dossier renommé.', entreprise: { id, nom } });
  }));

  router.put('/:id/archive', asyncRoute(async (req, res) => {
    const id = await exigerAdministrateur(req);
    const archiver = Boolean(req.body && req.body.archive);
    // Archiver le dossier où l'on travaille couperait la session en plein
    // geste : on en ouvre un autre d'abord.
    if (archiver && req.entreprise && req.entreprise.id === id) {
      throw httpError(409, "Ce dossier est ouvert : ouvrez-en un autre avant de l'archiver.");
    }
    await archiverEntreprise(getComptesDb(), id, archiver);
    res.json({ message: archiver ? 'Dossier archivé.' : 'Dossier réactivé.' });
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
    const profil = parseProfil(req.body && req.body.profil);

    const cree = await creerEntreprise(getComptesDb(), { nom, userId: req.user.sub, profil });

    emettreSession(res, { id: req.user.sub, username: req.user.username, entreprise: cree.id });
    res.status(201).json({ entreprise: { id: cree.id, nom: cree.nom, role: 'admin' } });
  }));

  return router;
};
