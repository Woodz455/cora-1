/**
 * Validation et normalisation des données entrantes.
 *
 * Chaque route de l'API passe par ces fonctions plutôt que de faire confiance
 * au formulaire : les contrôles présents dans l'interface (champ `max`, `required`)
 * ne protègent que l'utilisateur distrait, pas la base de données.
 */

const { normaliserCondition } = require('./paymentTerms.js');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/** Convertit un paramètre d'URL en identifiant entier positif, ou null. */
function parseId(value) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Convertit une valeur en montant strictement positif, ou null. */
function parsePositiveAmount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Vérifie qu'une chaîne est une date calendaire réelle au format YYYY-MM-DD. */
function isValidDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Tronque et nettoie un champ texte libre. */
function sanitizeText(value, maxLength = 500) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, maxLength);
}

/** Valide une liste de destinataires séparés par des virgules ou points-virgules. */
function isValidEmailList(value) {
  if (typeof value !== 'string') return false;
  const parts = value.split(/[,;]/).map((p) => p.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((p) => EMAIL_RE.test(p));
}

/** Devises prises en charge par l'application. */
const DEVISES = ['CAD', 'USD'];

/** Provinces et territoires canadiens, pour la détermination des taxes. */
const PROVINCES = ['QC', 'ON', 'BC', 'AB', 'SK', 'MB', 'NB', 'NL', 'NS', 'PE', 'NT', 'NU', 'YT'];

/** Langues de facturation prises en charge. */
const LANGUES = ['fr', 'en'];

/**
 * Valide et normalise la fiche d'un client.
 *
 * @returns {{error: string} | {client: Object}}
 */
function validateClient(body) {
  const nom_entreprise = sanitizeText(body.nom_entreprise, 200);
  if (!nom_entreprise) {
    return { error: "Le nom de l'entreprise est requis." };
  }

  const email = sanitizeText(body.email, 200);
  if (!email || !EMAIL_RE.test(email)) {
    return { error: 'Une adresse courriel valide est requise.' };
  }

  const province = String(body.province || 'QC').toUpperCase();
  if (!PROVINCES.includes(province)) {
    return { error: `Province inconnue : ${province}.` };
  }

  const langue = LANGUES.includes(body.langue) ? body.langue : 'fr';

  return {
    client: {
      nom_entreprise,
      email,
      nom_contact: sanitizeText(body.nom_contact, 200),
      adresse: sanitizeText(body.adresse, 500),
      langue,
      province,
      // Un terme inconnu retombe sur le défaut plutôt que de faire échouer
      // l'enregistrement d'une fiche par ailleurs valide.
      conditions_paiement: normaliserCondition(body.conditions_paiement)
    }
  };
}

/**
 * Normalise devise et taux de change.
 * Une facture en CAD a toujours un taux de 1 : le laisser libre permettrait de
 * fausser les rapports consolidés.
 */
function normalizeCurrency(devise, tauxChange) {
  const code = DEVISES.includes(String(devise).toUpperCase()) ? String(devise).toUpperCase() : 'CAD';
  if (code === 'CAD') return { devise: 'CAD', taux_change: 1.0 };
  const taux = Number(tauxChange);
  if (!Number.isFinite(taux) || taux <= 0) {
    return { error: 'Le taux de change doit être un nombre strictement positif.' };
  }
  return { devise: code, taux_change: taux };
}

/**
 * Valide et normalise les lignes d'une facture ou d'un devis.
 *
 * @returns {{error: string} | {lignes: Array<{description: string, quantite: number, prix_unitaire: number}>}}
 */
function validateLignes(lignes) {
  if (!Array.isArray(lignes) || lignes.length === 0) {
    return { error: 'Au moins une ligne est requise.' };
  }
  if (lignes.length > 200) {
    return { error: 'Un document ne peut pas comporter plus de 200 lignes.' };
  }

  const normalized = [];
  for (const [i, ligne] of lignes.entries()) {
    const description = sanitizeText(ligne.description, 500);
    if (!description) {
      return { error: `Ligne ${i + 1} : la description est requise.` };
    }
    const quantite = Number(ligne.quantite);
    if (!Number.isFinite(quantite) || quantite <= 0) {
      return { error: `Ligne ${i + 1} : la quantité doit être un nombre strictement positif.` };
    }
    const prix = Number(ligne.prix_unitaire);
    if (!Number.isFinite(prix) || prix < 0) {
      return { error: `Ligne ${i + 1} : le prix unitaire doit être un nombre positif.` };
    }
    normalized.push({ description, quantite, prix_unitaire: prix });
  }
  return { lignes: normalized };
}

module.exports = {
  parseId,
  parsePositiveAmount,
  isValidDate,
  sanitizeText,
  isValidEmailList,
  normalizeCurrency,
  validateLignes,
  validateClient,
  DEVISES,
  PROVINCES,
  LANGUES
};
