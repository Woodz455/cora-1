/**
 * Arithmétique monétaire.
 *
 * Les montants sont manipulés en dollars mais tous les résultats destinés à être
 * affichés, stockés ou additionnés passent par `roundCents`. Cela évite qu'une
 * facture affiche un sous-total et des taxes qui ne s'additionnent pas au total :
 * le total est *par construction* la somme des lignes arrondies, jamais un
 * produit recalculé sur des valeurs non arrondies.
 */

/**
 * Arrondit au cent, en écartant les artefacts de représentation binaire
 * (2.675 est stocké comme 2.67499999... : un Math.round naïf donnerait 2.67).
 *
 * @param {number} value
 * @returns {number} valeur arrondie à 2 décimales
 */
function roundCents(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const scaled = n * 100;
  // Correction d'epsilon relative : ramène 267.49999999999997 sur 267.5
  const corrected = scaled + (scaled >= 0 ? 1 : -1) * Math.abs(scaled) * Number.EPSILON * 4;
  return Math.round(corrected) / 100;
}

/**
 * Somme des lignes d'un document (quantité × prix unitaire), arrondie au cent.
 *
 * @param {Array<{quantite: number, prix_unitaire: number}>} lignes
 * @returns {number}
 */
function sumLignes(lignes) {
  if (!Array.isArray(lignes)) return 0;
  const raw = lignes.reduce((acc, l) => {
    const q = Number(l.quantite) || 0;
    const p = Number(l.prix_unitaire) || 0;
    return acc + q * p;
  }, 0);
  return roundCents(raw);
}

/**
 * Calcule les montants de taxes sur un sous-total.
 *
 * Chaque taxe est calculée sur le sous-total hors taxes et arrondie
 * indépendamment — c'est la méthode applicable au Canada depuis 2013 (la TVQ
 * n'est plus calculée sur un montant incluant la TPS).
 *
 * @param {number} sousTotal
 * @param {number} taux1
 * @param {number} taux2
 * @returns {{taxe_1: number, taxe_2: number}}
 */
function computeTaxes(sousTotal, taux1, taux2) {
  const base = roundCents(sousTotal);
  return {
    taxe_1: roundCents(base * (Number(taux1) || 0)),
    taxe_2: roundCents(base * (Number(taux2) || 0))
  };
}

/**
 * Totaux complets d'un document à partir de ses lignes.
 *
 * @param {Array} lignes
 * @param {number} taux1
 * @param {number} taux2
 * @returns {{sous_total: number, taxe_1: number, taxe_2: number, montant_total: number}}
 */
function computeTotals(lignes, taux1, taux2) {
  const sous_total = sumLignes(lignes);
  const { taxe_1, taxe_2 } = computeTaxes(sous_total, taux1, taux2);
  return {
    sous_total,
    taxe_1,
    taxe_2,
    montant_total: roundCents(sous_total + taxe_1 + taxe_2)
  };
}

/*
 * Les montants ne sont plus calculés en SQL. Ils sont arrêtés en JavaScript au
 * moment de l'émission d'un document, puis stockés — voir `invoiceService.js`.
 * Les anciens fragments SQL qui reproduisaient `computeTotals` ont donc été
 * retirés : les conserver aurait invité à recalculer un total déjà arrêté.
 */

module.exports = { roundCents, sumLignes, computeTaxes, computeTotals };
