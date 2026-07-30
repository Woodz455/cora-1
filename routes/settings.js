/**
 * Routes des paramètres d'entreprise.
 */

const express = require('express');

const { anyRole, adminOnly } = require('../authMiddleware.js');
const { asyncRoute, httpError } = require('../httpUtils.js');
const { sanitizeText } = require('../validators.js');
const { parsePaliers: analyserPaliers } = require('../relanceService.js');

/** Taille maximale du logo, encodé en data-URI. */
const MAX_LOGO_CHARS = 3 * 1024 * 1024;

/** Champs jamais exposés par l'API, quel que soit le rôle. */
const CHAMPS_INTERNES = ['admin_username', 'admin_password'];

function nettoyer(settings) {
  if (!settings) return {};
  const copie = { ...settings };
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
      relances_actives: body.relances_actives ? 1 : 0,
      relances_paliers: parsePaliers(body.relances_paliers)
    };

    if (!valeurs.entreprise_nom) {
      throw httpError(400, "Le nom de l'entreprise est requis.");
    }

    const existant = await db.get('SELECT id FROM settings LIMIT 1');
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
    res.json({ message: 'Paramètres mis à jour.', settings: nettoyer(settings) });
  }));

  return router;
};
