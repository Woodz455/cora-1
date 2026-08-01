/**
 * Routes des sauvegardes de la base.
 *
 * Réservées à l'administrateur : ces fichiers contiennent l'intégralité de la
 * comptabilité, et la restauration écrase les données en place.
 */

const express = require('express');

const { adminOnly } = require('../authMiddleware.js');
const { asyncRoute, httpError } = require('../httpUtils.js');
const {
  lireReglages,
  listerSauvegardes,
  creerSauvegarde,
  demanderRestauration,
  dossierParDefaut
} = require('../backupService.js');

/**
 * Ouvre un sélecteur de dossier natif.
 *
 * Le serveur Express tourne dans le processus principal d'Electron : il peut
 * donc afficher une boîte de dialogue sans qu'on ait à percer le cloisonnement
 * de l'interface, qui n'expose volontairement aucun canal IPC. Hors Electron —
 * serveur lancé seul — la fonction rend `null` et l'interface s'en tient à son
 * champ de saisie.
 */
async function choisirDossier(depart) {
  if (!process.versions || !process.versions.electron) return null;

  let electron;
  try {
    electron = require('electron');
  } catch (e) {
    return null;
  }
  if (!electron || !electron.dialog) return null;

  const resultat = await electron.dialog.showOpenDialog({
    title: 'Dossier des sauvegardes',
    defaultPath: depart,
    properties: ['openDirectory', 'createDirectory']
  });

  return resultat.canceled || resultat.filePaths.length === 0 ? null : resultat.filePaths[0];
}

module.exports = function sauvegardeRoutes(getDb) {
  const router = express.Router();

  router.use(adminOnly());

  /** Réglages courants et sauvegardes disponibles. */
  router.get('/', asyncRoute(async (req, res) => {
    const reglages = await lireReglages(getDb());
    res.json({
      ...reglages,
      dossier_par_defaut: dossierParDefaut(),
      selecteur_disponible: Boolean(process.versions && process.versions.electron),
      sauvegardes: listerSauvegardes(reglages.dossier)
    });
  }));

  /** Sauvegarde immédiate, à la demande. */
  router.post('/', asyncRoute(async (req, res) => {
    const reglages = await lireReglages(getDb());
    try {
      const resultat = await creerSauvegarde(getDb(), reglages);
      res.status(201).json({ message: 'Sauvegarde créée.', ...resultat });
    } catch (error) {
      throw httpError(500, `La sauvegarde a échoué : ${error.message}`);
    }
  }));

  /** Sélecteur de dossier natif, lorsque l'application tourne dans Electron. */
  router.post('/dossier', asyncRoute(async (req, res) => {
    const reglages = await lireReglages(getDb());
    const choisi = await choisirDossier(reglages.dossier);
    res.json({ dossier: choisi });
  }));

  /**
   * Programme une restauration.
   *
   * Rien n'est remplacé pendant que la base est ouverte : la demande est
   * enregistrée et s'applique au redémarrage, que l'application déclenche
   * elle-même quand elle tourne dans Electron.
   */
  router.post('/restaurer', asyncRoute(async (req, res) => {
    const nom = String(req.body && req.body.nom ? req.body.nom : '');
    if (!nom) throw httpError(400, 'Indiquez la sauvegarde à restaurer.');

    const reglages = await lireReglages(getDb());
    const cible = listerSauvegardes(reglages.dossier).find((s) => s.nom === nom);
    if (!cible) throw httpError(404, 'Cette sauvegarde est introuvable.');

    await demanderRestauration(cible.chemin);

    res.json({
      message: "La restauration s'appliquera au redémarrage. La base actuelle sera conservée à côté, au cas où.",
      redemarrage: planifierRedemarrage()
    });
  }));

  return router;
};

/**
 * Redémarre l'application pour appliquer la restauration.
 * Laisse le temps à la réponse de partir avant de couper.
 */
function planifierRedemarrage() {
  if (!process.versions || !process.versions.electron) return false;

  let electron;
  try {
    electron = require('electron');
  } catch (e) {
    return false;
  }
  if (!electron || !electron.app) return false;

  setTimeout(() => {
    electron.app.relaunch();
    electron.app.exit(0);
  }, 1500);

  return true;
}
