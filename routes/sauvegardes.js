/**
 * Routes des sauvegardes de la base.
 *
 * Réservées à l'administrateur : ces fichiers contiennent l'intégralité de la
 * comptabilité, et la restauration écrase les données en place.
 */

const express = require('express');
const bcrypt = require('bcryptjs');

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
  memeChemin,
  lireProtection,
  enregistrerCle,
  rechiffrerSerie,
  anciennesEnClair,
  etatDesSauvegardes,
  CLE_ILLISIBLE
} = require('../backupService.js');
const { genererCle, normaliserCle, formater } = require('../codesSecours.js');
const { empreinteDe } = require('../chiffrementSauvegardes.js');

/**
 * Lit la clé saisie dans une requête.
 * @returns {?string} forme brute, ou `null` si aucune n'a été saisie
 */
function cleSaisie(body, champ = 'cle') {
  const saisie = body && body[champ];
  if (saisie === undefined || saisie === null || String(saisie).trim() === '') return null;
  const brute = normaliserCle(saisie);
  if (!brute) throw httpError(400, "Cette clé n'a pas la bonne forme : 24 caractères, en 6 groupes de 4.");
  return brute;
}

/** Vérifie le mot de passe du compte connecté. */
async function verifierMotDePasse(comptesDb, req) {
  const compte = comptesDb && await comptesDb.get('SELECT password FROM users WHERE id = ?', [req.user.sub]);
  const motDePasse = req.body && req.body.motDePasse;
  const valide = compte && typeof motDePasse === 'string' && await bcrypt.compare(motDePasse, compte.password);
  if (!valide) throw httpError(401, 'Mot de passe incorrect.');
}

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
    const { active, lisible, empreinte } = await lireProtection(getDb());
    res.json({
      ...reglages,
      // Jamais la clé elle-même : son empreinte suffit à dire qu'elle existe.
      protection: { active, lisible, empreinte },
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
    const { cle } = await lireProtection(getDb());
    const contenu = await examinerSauvegarde(
      sauvegarde.chemin, req.entreprise.chemin, reglages.uid, { cleDuDossier: cle, cleSaisie: cleSaisie(req.body) }
    );
    res.json({ nom: sauvegarde.nom, date: sauvegarde.date, taille: sauvegarde.taille, ...contenu });
  }));

  /** Sauvegarde immédiate, à la demande. */
  router.post('/', asyncRoute(async (req, res) => {
    const reglages = await lireReglages(getDb());
    try {
      const resultat = await creerSauvegarde(getDb(), reglages);
      res.status(201).json({ message: 'Sauvegarde créée.', ...resultat });
    } catch (error) {
      if (error.code === CLE_ILLISIBLE) {
        throw httpError(409, "La clé des sauvegardes n'est plus lisible sur cet ordinateur : saisissez-la de nouveau.");
      }
      throw httpError(500, `La sauvegarde a échoué : ${error.message}`);
    }
  }));

  /**
   * Ce que le tableau de bord doit signaler : une clé illisible, une dernière
   * copie trop ancienne, ou aucune copie réussie.
   */
  router.get('/etat', asyncRoute(async (req, res) => {
    const comptesDb = getComptesDb();
    const dossier = comptesDb
      ? await comptesDb.get('SELECT cree_le FROM entreprises WHERE id = ?', [req.entreprise.id])
      : null;
    res.json(await etatDesSauvegardes(getDb(), { creeLe: dossier && dossier.cree_le }));
  }));

  /**
   * Une clé neuve, tirée au hasard. Rien n'est enregistré : elle ne le sera
   * qu'une fois ressaisie, preuve qu'elle a bien été notée.
   */
  router.post('/cle/generer', asyncRoute(async (req, res) => {
    res.json({ cle: formater(genererCle()) });
  }));

  /**
   * Active la protection, ou remplace la clé.
   *
   * La clé doit être saisie deux fois : à l'écran, puis recopiée depuis la
   * feuille imprimée. Remplacer une clé existante demande en plus le mot de
   * passe. Les copies de la série sont chiffrées avec la nouvelle clé : les
   * copies en clair, si on le demande, et celles chiffrées avec l'ancienne.
   */
  router.post('/cle', asyncRoute(async (req, res) => {
    const db = getDb();
    const cle = cleSaisie(req.body);
    const confirmation = cleSaisie(req.body, 'confirmation');
    if (!cle || !confirmation) throw httpError(400, 'Saisissez la clé, puis recopiez-la depuis la feuille de secours.');
    if (cle !== confirmation) throw httpError(400, 'Les deux saisies de la clé ne concordent pas.');

    const avant = await lireProtection(db);
    if (avant.active) await verifierMotDePasse(getComptesDb(), req);

    await enregistrerCle(db, cle);
    const reglages = await lireReglages(db);
    const { rechiffrees, laissees } = rechiffrerSerie(reglages.dossier, serieDe(reglages.uid), {
      ancienne: avant.cle,
      nouvelle: cle,
      inclureClaires: !req.body || req.body.chiffrer_existantes !== false
    });

    await journaliser(db, req, {
      action: ACTIONS.SAUVEGARDE_PROTECTION,
      entite: 'sauvegarde',
      details: { empreinte: empreinteDe(cle), remplacement: avant.active, rechiffrees }
    });

    res.json({
      message: avant.active ? 'Clé des sauvegardes remplacée.' : 'Les sauvegardes de ce dossier sont désormais chiffrées.',
      empreinte: empreinteDe(cle),
      rechiffrees,
      laissees,
      anciennes_en_clair: anciennesEnClair(reglages.dossier)
    });
  }));

  /** Montre la clé, pour réimprimer la feuille de secours. Le mot de passe est demandé. */
  router.post('/cle/afficher', asyncRoute(async (req, res) => {
    await verifierMotDePasse(getComptesDb(), req);
    const protection = await lireProtection(getDb());
    if (!protection.active) throw httpError(404, "Les sauvegardes de ce dossier ne sont pas protégées par une clé.");
    if (!protection.cle) {
      throw httpError(409, "La clé n'est plus lisible sur cet ordinateur : saisissez-la de nouveau depuis la feuille de secours.");
    }
    res.json({ cle: formater(protection.cle) });
  }));

  /**
   * Ressaisie de la clé, quand ce poste ne sait plus la lire (profil Windows
   * recréé, base restaurée sur un autre ordinateur). Elle doit être celle en
   * vigueur : son empreinte le vérifie.
   */
  router.post('/cle/ressaisir', asyncRoute(async (req, res) => {
    const db = getDb();
    const cle = cleSaisie(req.body);
    const protection = await lireProtection(db);
    if (!cle) throw httpError(400, 'Saisissez la clé imprimée sur la feuille de secours.');
    if (!protection.active || empreinteDe(cle) !== protection.empreinte) {
      throw httpError(400, 'Cette clé ne correspond pas à celle des sauvegardes de ce dossier.');
    }
    await enregistrerCle(db, cle);
    res.json({ message: 'Clé enregistrée : les sauvegardes reprennent.' });
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
      `SELECT sauvegarde_active, sauvegarde_dossier, sauvegarde_retention, sauvegarde_cle, sauvegarde_cle_empreinte
       FROM settings ORDER BY id LIMIT 1`
    );
    const { cle } = await lireProtection(db);
    await demanderRestauration(cible.chemin, req.entreprise.chemin, {
      uid: reglages.uid,
      poste,
      cles: { cleDuDossier: cle, cleSaisie: cleSaisie(req.body) },
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
