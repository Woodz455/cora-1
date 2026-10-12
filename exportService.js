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
 *
 * L'Excel anglophone attend l'inverse : la virgule entre les colonnes, le point
 * dans les nombres. Le fichier d'un utilisateur anglophone suit donc sa langue,
 * pour la même raison.
 */
const SEPARATEUR = ';';
const SEPARATEUR_EN = ',';

const separateurDe = (langue) => (langue === 'en' ? SEPARATEUR_EN : SEPARATEUR);

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
 * Un nom d'entreprise contenant le séparateur (le point-virgule, ou la virgule
 * en anglais), un guillemet ou un retour à la ligne casserait la structure du
 * fichier sans cette mise entre guillemets.
 */
function echapper(valeur, separateur = SEPARATEUR) {
  if (valeur === null || valeur === undefined) return '';

  const texte = String(valeur);
  if (!/["\r\n]/.test(texte) && !texte.includes(separateur)) return texte;

  return `"${texte.replace(/"/g, '""')}"`;
}

/**
 * Écrit un montant à la façon d'un tableur francophone : virgule décimale.
 *
 * Le point décimal oblige le destinataire à reformater chaque colonne avant de
 * pouvoir additionner quoi que ce soit. En anglais, c'est l'inverse.
 */
function montant(valeur, langue = 'fr') {
  // `Number(null)` vaut zéro : sans ce garde, une valeur absente serait écrite
  // « 0,00 ». Or dans un registre comptable, une case vide et un montant nul ne
  // disent pas la même chose.
  if (valeur === null || valeur === undefined || valeur === '') return '';

  const n = Number(valeur);
  if (!Number.isFinite(n)) return '';
  const texte = roundCents(n).toFixed(2);
  return langue === 'en' ? texte : texte.replace('.', ',');
}

/**
 * Assemble un CSV.
 *
 * @param {Array<{cle: string, titre: string, titreEn?: string, type?: 'montant'}>} colonnes
 * @param {Array<Object>} lignes
 * @param {'fr'|'en'} [langue] langue de l'utilisateur : titres, séparateur et
 *   virgule ou point décimal
 * @returns {string}
 */
function versCSV(colonnes, lignes, langue = 'fr') {
  const sep = separateurDe(langue);
  const titre = (c) => (langue === 'en' && c.titreEn ? c.titreEn : c.titre);
  const entete = colonnes.map((c) => echapper(titre(c), sep)).join(sep);

  const corps = lignes.map((ligne) => colonnes
    .map((c) => echapper(c.type === 'montant' ? montant(ligne[c.cle], langue) : ligne[c.cle], sep))
    .join(sep));

  // Fin de ligne Windows : c'est ce qu'attendent Excel et les logiciels
  // comptables auxquels ces fichiers sont destinés.
  return BOM + [entete, ...corps].join('\r\n') + '\r\n';
}

/**
 * Nom de fichier daté, sans caractère que Windows refuse.
 * @param {string} base
 * @param {Object} periode
 * @param {'fr'|'en'} [langue] « T3 » ou « Q3 » pour un trimestre
 */
function nomFichier(base, periode = {}, langue = 'fr') {
  const morceaux = [base];
  if (periode.annee) morceaux.push(String(periode.annee));
  if (periode.trimestre) morceaux.push(`${langue === 'en' ? 'Q' : 'T'}${periode.trimestre}`);
  if (periode.mois) morceaux.push(String(periode.mois).padStart(2, '0'));
  return `${morceaux.join('-')}.csv`;
}

module.exports = { versCSV, echapper, montant, nomFichier, SEPARATEUR, SEPARATEUR_EN, BOM };
