/**
 * Production des registres au format CSV.
 *
 * Le comptable de l'entreprise travaille dans un autre logiciel — Acomba, Sage,
 * QuickBooks. Ces exports sont le point de passage entre Clora et son bilan de
 * fin d'année.
 */

const { roundCents } = require('./money.js');

/**
 * Séparateur point-virgule.
 *
 * L'Excel francophone attend le point-virgule comme séparateur de liste : avec
 * une virgule, il empile la ligne entière dans une seule colonne, et le fichier
 * est inutilisable pour son destinataire.
 */
const SEPARATEUR = ';';

/**
 * Marque d'ordre des octets.
 *
 * Sans elle, Excel lit l'UTF-8 comme de l'ANSI : « Bélanger » devient
 * « BÃ©langer ». Deux caractères invisibles décident donc de la lisibilité de
 * tout le fichier.
 */
const BOM = '﻿';

/**
 * Échappe une valeur selon la RFC 4180.
 *
 * Un nom d'entreprise contenant un point-virgule, un guillemet ou un retour à
 * la ligne casserait la structure du fichier sans cette mise entre guillemets.
 */
function echapper(valeur) {
  if (valeur === null || valeur === undefined) return '';

  const texte = String(valeur);
  if (!/["\r\n]|;/.test(texte)) return texte;

  return `"${texte.replace(/"/g, '""')}"`;
}

/**
 * Écrit un montant à la façon d'un tableur francophone : virgule décimale.
 *
 * Le point décimal oblige le destinataire à reformater chaque colonne avant de
 * pouvoir additionner quoi que ce soit.
 */
function montant(valeur) {
  // `Number(null)` vaut zéro : sans ce garde, une valeur absente serait écrite
  // « 0,00 ». Or dans un registre comptable, une case vide et un montant nul ne
  // disent pas la même chose.
  if (valeur === null || valeur === undefined || valeur === '') return '';

  const n = Number(valeur);
  if (!Number.isFinite(n)) return '';
  return roundCents(n).toFixed(2).replace('.', ',');
}

/**
 * Assemble un CSV.
 *
 * @param {Array<{cle: string, titre: string, type?: 'montant'}>} colonnes
 * @param {Array<Object>} lignes
 * @returns {string}
 */
function versCSV(colonnes, lignes) {
  const entete = colonnes.map((c) => echapper(c.titre)).join(SEPARATEUR);

  const corps = lignes.map((ligne) => colonnes
    .map((c) => echapper(c.type === 'montant' ? montant(ligne[c.cle]) : ligne[c.cle]))
    .join(SEPARATEUR));

  // Fin de ligne Windows : c'est ce qu'attendent Excel et les logiciels
  // comptables auxquels ces fichiers sont destinés.
  return BOM + [entete, ...corps].join('\r\n') + '\r\n';
}

/**
 * Nom de fichier daté, sans caractère que Windows refuse.
 * @param {string} base
 * @param {Object} periode
 */
function nomFichier(base, periode = {}) {
  const morceaux = [base];
  if (periode.annee) morceaux.push(String(periode.annee));
  if (periode.trimestre) morceaux.push(`T${periode.trimestre}`);
  if (periode.mois) morceaux.push(String(periode.mois).padStart(2, '0'));
  return `${morceaux.join('-')}.csv`;
}

module.exports = { versCSV, echapper, montant, nomFichier, SEPARATEUR, BOM };
