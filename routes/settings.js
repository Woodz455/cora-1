/**
 * Routes des paramètres d'entreprise.
 */

const express = require('express');

const { anyRole, adminOnly } = require('../authMiddleware.js');
const { journaliser, ecart, ACTIONS } = require('../auditService.js');
const { asyncRoute, httpError } = require('../httpUtils.js');
const { sanitizeText, isValidEmailList } = require('../validators.js');
const { parsePaliers: analyserPaliers } = require('../relanceService.js');
const { chiffrer, estProtege, coffreDisponible } = require('../secretStorage.js');
const { envoyerCourrielTest } = require('../emailService.js');

/** Taille maximale du logo, encodé en data-URI. */
const MAX_LOGO_CHARS = 3 * 1024 * 1024;

/** Champs jamais exposés par l'API, quel que soit le rôle. */
const CHAMPS_INTERNES = ['admin_username', 'admin_password', 'smtp_pass_chiffre'];

/**
 * Retire les champs internes et remplace le mot de passe d'envoi par deux
 * indicateurs.
 *
 * Le formulaire doit pouvoir afficher « un mot de passe est enregistré » sans
 * que ce mot de passe transite : une réponse d'API finit dans l'historique du
 * navigateur, dans les journaux d'un mandataire, dans une capture d'écran de
 * support. `smtp_pass_protege` dit en plus s'il est réellement chiffré par le
 * coffre du système — c'est faux hors Electron, et l'utilisateur mérite de le
 * savoir plutôt que de le supposer.
 */
function nettoyer(settings) {
  if (!settings) return {};
  const copie = { ...settings };

  copie.smtp_pass_defini = Boolean(settings.smtp_pass_chiffre);
  copie.smtp_pass_protege = estProtege(settings.smtp_pass_chiffre);
  copie.coffre_disponible = coffreDisponible();

  for (const champ of CHAMPS_INTERNES) delete copie[champ];
  return copie;
}

/** Valide un taux de taxe exprimé en fraction (0.05 pour 5 %). */
function parseTaux(valeur, libelle) {
  const n = Number(valeur);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw httpError(400, `${libelle} doit être une fraction entre 0 et 1 (0.05 pour 5 %).`);
  }
  return n;
}

/**
 * Normalise les paliers de relance en une liste de jours triée.
 * Réutilise l'analyse du service, pour que ce qui est enregistré soit
 * exactement ce que le planificateur appliquera.
 */
function parsePaliers(valeur) {
  if (valeur === undefined || valeur === null) return null;

  const paliers = analyserPaliers(String(valeur));
  if (paliers.length === 0) {
    throw httpError(400, 'Indiquez au moins un palier de relance, en jours après échéance (par exemple 7, 15, 30).');
  }
  return paliers.join(',');
}

/**
 * Interrupteur à trois états : activé, désactivé, ou absent.
 *
 * `body.x ? 1 : 0` transformait toute absence en désactivation. Un client qui
 * enregistrait les paramètres sans connaître `sauvegarde_active` — un script,
 * une version antérieure de l'interface — coupait donc les sauvegardes
 * automatiques sans que personne ne l'ait demandé. `null` signifie « ne touche
 * pas à ce réglage » et sort de la requête de mise à jour.
 */
function parseInterrupteur(valeur) {
  if (valeur === undefined || valeur === null) return null;
  return valeur ? 1 : 0;
}

/**
 * Nombre de sauvegardes conservées. Une valeur absente laisse le réglage
 * inchangé ; zéro effacerait chaque copie sitôt écrite et n'est pas accepté.
 */
function parseRetention(valeur) {
  if (valeur === undefined || valeur === null || valeur === '') return null;

  const n = Number(valeur);
  if (!Number.isInteger(n) || n < 1 || n > 365) {
    throw httpError(400, 'Le nombre de sauvegardes conservées doit être un entier entre 1 et 365.');
  }
  return n;
}

/**
 * Port du serveur d'envoi. Une valeur absente laisse le réglage inchangé ;
 * `emailService` retombe de lui-même sur 587 quand rien n'est enregistré.
 */
function parsePort(valeur) {
  if (valeur === undefined || valeur === null || valeur === '') return null;

  const n = Number(valeur);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw httpError(400, 'Le port du serveur d\'envoi doit être un entier entre 1 et 65535.');
  }
  return n;
}

/**
 * Champs dont la modification est consignée.
 *
 * Le logo en est volontairement absent : sa valeur est un data-URI massif, et
 * son changement n'a aucune portée comptable.
 */
const CHAMPS_SUIVIS = [
  'entreprise_nom', 'entreprise_adresse', 'entreprise_email',
  'taxe_1_nom', 'taxe_1_taux', 'taxe_1_numero',
  'taxe_2_nom', 'taxe_2_taux', 'taxe_2_numero',
  'payment_instructions', 'relances_actives', 'relances_paliers',
  'sauvegarde_active', 'sauvegarde_dossier', 'sauvegarde_retention',
  'verifier_maj',
  // Le serveur et le compte d'envoi sont suivis ; le mot de passe ne l'est
  // évidemment pas, et son absence de cette liste est la seule chose qui
  // l'empêche d'être recopié dans un journal conçu pour être inaltérable.
  'smtp_host', 'smtp_port', 'smtp_user'
];

module.exports = function settingsRoutes(getDb) {
  const router = express.Router();

  /**
   * Lecture accessible à tous les rôles.
   *
   * L'accès était réservé aux administrateurs, alors que le modèle d'impression
   * consomme cette route : les factures produites par un employé ou un
   * comptable sortaient sans logo, sans raison sociale et sans instructions de
   * paiement. Les colonnes techniques restent filtrées.
   */
  router.get('/', anyRole(), asyncRoute(async (req, res) => {
    const settings = await getDb().get('SELECT * FROM settings LIMIT 1');
    res.json(nettoyer(settings));
  }));

  router.put('/', adminOnly(), asyncRoute(async (req, res) => {
    const db = getDb();
    const body = req.body;

    const logo = body.entreprise_logo ? String(body.entreprise_logo) : '';
    if (logo && !logo.startsWith('data:image/')) {
      throw httpError(400, "Le logo doit être une image (data-URI 'data:image/...').");
    }
    if (logo.length > MAX_LOGO_CHARS) {
      throw httpError(400, 'Le logo dépasse la taille maximale de 2 Mo.');
    }

    const valeurs = {
      entreprise_nom: sanitizeText(body.entreprise_nom, 200),
      entreprise_adresse: sanitizeText(body.entreprise_adresse, 500),
      entreprise_email: sanitizeText(body.entreprise_email, 200),
      taxe_1_nom: sanitizeText(body.taxe_1_nom, 40),
      taxe_1_taux: parseTaux(body.taxe_1_taux ?? 0, 'Le taux de la taxe 1'),
      taxe_1_numero: sanitizeText(body.taxe_1_numero, 60),
      taxe_2_nom: sanitizeText(body.taxe_2_nom, 40),
      taxe_2_taux: parseTaux(body.taxe_2_taux ?? 0, 'Le taux de la taxe 2'),
      taxe_2_numero: sanitizeText(body.taxe_2_numero, 60),
      payment_instructions: sanitizeText(body.payment_instructions, 2000),
      entreprise_logo: logo,
      relances_actives: parseInterrupteur(body.relances_actives),
      relances_paliers: parsePaliers(body.relances_paliers),
      sauvegarde_active: parseInterrupteur(body.sauvegarde_active),
      sauvegarde_dossier: sanitizeText(body.sauvegarde_dossier, 500),
      sauvegarde_retention: parseRetention(body.sauvegarde_retention),
      verifier_maj: parseInterrupteur(body.verifier_maj),
      smtp_host: sanitizeText(body.smtp_host, 200),
      smtp_port: parsePort(body.smtp_port),
      smtp_user: sanitizeText(body.smtp_user, 200)
    };

    if (!valeurs.entreprise_nom) {
      throw httpError(400, "Le nom de l'entreprise est requis.");
    }

    // Le mot de passe n'est enregistré que lorsqu'il est réellement fourni : le
    // formulaire ne le renvoie jamais, et l'écrire à chaque sauvegarde des
    // paramètres l'effacerait dès la première modification d'un taux de taxe.
    //
    // Vider le serveur d'envoi efface en revanche le mot de passe : garder un
    // secret pour un compte qu'on vient de retirer n'aurait aucun usage, et le
    // laisserait dans chaque sauvegarde produite ensuite.
    const motDePasse = typeof body.smtp_pass === 'string' ? body.smtp_pass : '';
    if (motDePasse) {
      valeurs.smtp_pass_chiffre = chiffrer(motDePasse);
    } else if (!valeurs.smtp_host) {
      valeurs.smtp_pass_chiffre = '';
    }

    const avant = await db.get('SELECT * FROM settings LIMIT 1');
    const existant = avant ? { id: avant.id } : null;
    // Un champ absent de la requête garde sa valeur : ne pas filtrer reviendrait
    // à effacer un réglage que le formulaire n'a simplement pas envoyé.
    const colonnes = Object.keys(valeurs).filter((c) => valeurs[c] !== null);

    if (existant) {
      await db.run(
        `UPDATE settings SET ${colonnes.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
        [...colonnes.map((c) => valeurs[c]), existant.id]
      );
    } else {
      await db.run(
        `INSERT INTO settings (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`,
        colonnes.map((c) => valeurs[c])
      );
    }

    const settings = await db.get('SELECT * FROM settings LIMIT 1');

    // Le corps de requête n'est jamais journalisé tel quel : il transporte
    // `entreprise_logo`, un data-URI de plusieurs mégaoctets. Seul l'écart sur
    // les champs suivis est consigné — les taux de taxe au premier chef, dont
    // un changement discret fausserait toutes les factures suivantes.
    const changements = ecart(avant, settings, CHAMPS_SUIVIS);
    if (changements) {
      await journaliser(db, req, {
        action: ACTIONS.PARAMETRES_MODIFICATION,
        entite: 'parametres',
        entite_id: settings.id,
        details: { changements }
      });
    }

    res.json({ message: 'Paramètres mis à jour.', settings: nettoyer(settings) });
  }));

  /**
   * Envoie un courriel de contrôle.
   *
   * Sans cette route, la seule façon de savoir si la configuration tient était
   * d'envoyer une vraie facture à un vrai client et d'attendre de voir. Les
   * erreurs SMTP sont ici renvoyées telles que le serveur les formule — « 535
   * mot de passe d'application requis » guide bien mieux qu'un « échec de
   * l'envoi » poli.
   */
  router.post('/smtp/test', adminOnly(), asyncRoute(async (req, res) => {
    const db = getDb();
    const settings = await db.get('SELECT entreprise_nom, entreprise_email, smtp_user FROM settings LIMIT 1');

    const destinataire = sanitizeText(req.body && req.body.destinataire, 200)
      || (settings && settings.entreprise_email)
      || (settings && settings.smtp_user)
      || '';

    if (!isValidEmailList(destinataire)) {
      throw httpError(400, 'Indiquez une adresse de destination valide pour le courriel de test.');
    }

    // Volontairement absent du journal d'audit : celui-ci retrace ce qui engage
    // la comptabilité — un taux modifié, un encaissement annulé. Un courriel de
    // test n'engage rien, et l'y consigner diluerait ce que le journal sert à
    // prouver.
    const resultat = await envoyerCourrielTest(db, destinataire, settings || {});

    res.json({
      message: `Courriel de test envoyé à ${destinataire}.`,
      ...resultat
    });
  }));

  return router;
};
