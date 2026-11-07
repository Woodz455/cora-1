/**
 * Routes des sauvegardes de la base.
 *
 * Réservées à l'administrateur : ces fichiers contiennent l'intégralité de la
 * comptabilité, et la restauration écrase les données en place.
 */

const express = require('express');

const { adminOnly } = require('../authMiddleware.js');
const { journaliser, ACTIONS } = require('../auditService.js');
const { asyncRoute, httpError } = require('../httpUtils.js');
const {
  lireReglages,
  lireIdentifiant,
  serieDe,
  listerSauvegardes,
  creerSauvegarde,
  examinerSauvegarde,
  demanderRestauration,
  dossierParDefaut,
  memeChemin
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

/**
 * Retrouve une sauvegarde par son nom dans le dossier de destination.
 *
 * Le nom est confronté à la liste réelle du dossier, jamais concaténé à un
 * chemin : une remontée d'arborescence ne désigne donc rien.
 */
function trouverSauvegarde(reglages, nom) {
  if (!nom) throw httpError(400, 'Indiquez la sauvegarde à restaurer.');
  const trouvee = listerSauvegardes(reglages.dossier).find((s) => s.nom === nom);
  if (!trouvee) throw httpError(404, 'Cette sauvegarde est introuvable.');
  return trouvee;
}

/**
 * Identifiants des autres dossiers de ce poste, archivés compris.
 *
 * Une copie qui porte l'identifiant de l'un d'eux, restaurée ici, en reçoit un
 * nouveau : deux dossiers ne doivent jamais partager une série de sauvegardes.
 */
async function identifiantsDesAutresDossiers(comptesDb, cheminCourant) {
  if (!comptesDb) return [];
  const dossiers = await comptesDb.all('SELECT chemin FROM entreprises');
  const identifiants = [];
  for (const { chemin } of dossiers) {
    if (memeChemin(chemin, cheminCourant)) continue;
    const uid = await lireIdentifiant(chemin);
    if (uid) identifiants.push(uid);
  }
  return identifiants;
}

module.exports = function sauvegardeRoutes(getDb, getComptesDb = () => null) {
  const router = express.Router();

  router.use(adminOnly());

  /**
   * Réglages courants et sauvegardes disponibles.
   *
   * `sauvegardes` ne contient que celles de ce dossier. Les autres présentes
   * dans le dossier de destination (un autre dossier d'entreprise, un autre
   * ordinateur, une version antérieure à la 1.9.1) sont rendues à part : on
   * peut les restaurer, par exemple sur un nouvel ordinateur, mais jamais en
   * les confondant avec les siennes.
   */
  router.get('/', asyncRoute(async (req, res) => {
    const { uid, ...reglages } = await lireReglages(getDb());
    const serie = serieDe(uid);
    const toutes = listerSauvegardes(reglages.dossier);
    res.json({
      ...reglages,
      dossier_par_defaut: dossierParDefaut(),
      selecteur_disponible: Boolean(process.versions && process.versions.electron),
      sauvegardes: toutes.filter((s) => serie && s.serie === serie),
      autres: toutes.filter((s) => !serie || s.serie !== serie)
    });
  }));

  /**
   * Ce que contient une sauvegarde : l'entreprise, le nombre de factures et de
   * clients, et si elle vient de ce dossier. L'interface le montre avant de
   * demander confirmation.
   */
  router.post('/examiner', asyncRoute(async (req, res) => {
    const reglages = await lireReglages(getDb());
    const sauvegarde = trouverSauvegarde(reglages, String((req.body && req.body.nom) || ''));
    const contenu = await examinerSauvegarde(sauvegarde.chemin, req.entreprise.chemin, reglages.uid);
    res.json({ nom: sauvegarde.nom, date: sauvegarde.date, taille: sauvegarde.taille, ...contenu });
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
    const db = getDb();
    const reglages = await lireReglages(db);
    const cible = trouverSauvegarde(reglages, String((req.body && req.body.nom) || ''));

    // Valeurs brutes, et non celles de `lireReglages` : un dossier de
    // destination resté vide doit le rester, plutôt que de figer le chemin par
    // défaut de cette installation-ci.
    const poste = await db.get(
      'SELECT sauvegarde_active, sauvegarde_dossier, sauvegarde_retention FROM settings ORDER BY id LIMIT 1'
    );
    await demanderRestauration(cible.chemin, req.entreprise.chemin, {
      uid: reglages.uid,
      poste,
      uidsAilleurs: await identifiantsDesAutresDossiers(getComptesDb(), req.entreprise.chemin)
    });

    // Consigné avant le redémarrage : après restauration, la base ne contiendra
    // plus que ce que la sauvegarde portait, et cette ligne disparaîtrait. La
    // trace subsiste donc dans la base de secours conservée à côté.
    await journaliser(db, req, {
      action: ACTIONS.SAUVEGARDE_RESTAURATION,
      entite: 'sauvegarde',
      details: { sauvegarde: cible.nom, datee_du: cible.date }
    });

    // Les dernières écritures, dont cette trace, rejoignent le fichier
    // principal : la base de secours les contiendra même si l'application est
    // coupée net pour redémarrer.
    await db.exec('PRAGMA wal_checkpoint(TRUNCATE)').catch(() => {});

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
