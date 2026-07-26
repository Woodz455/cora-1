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

/**
 * Biais appliqué avant l'arrondi SQL.
 *
 * `ROUND` de SQLite arrondit la valeur binaire réelle : 0,015 est stocké
 * 0,014999999… et donne 0,01, là où `roundCents` — et la convention comptable —
 * donne 0,02. Un biais de 1e-9 ramène les demi-cents exacts du bon côté sans
 * jamais déplacer un montant qui n'est pas sur la frontière, l'application ne
 * manipulant que des dollars à deux ou trois décimales.
 */
const SQL_BIAIS = '1e-9';

/** Arrondi SQL au cent, aligné sur `roundCents`. */
function sqlRound(expr) {
  return `ROUND(${expr} + (CASE WHEN (${expr}) >= 0 THEN ${SQL_BIAIS} ELSE -${SQL_BIAIS} END), 2)`;
}

/**
 * Fragments SQL partagés par toutes les requêtes de calcul de solde.
 *
 * Ils reproduisent exactement `computeTotals` afin que la base et le PDF
 * n'affichent jamais deux totaux différents pour la même facture. Une seule
 * définition du « montant total » existe dans l'application, et c'est celle-ci.
 * Le test `money.test.js` vérifie l'égalité des deux implémentations sur
 * l'ensemble des montants au cent jusqu'à 50 $, plus les valeurs limites.
 *
 * @param {string} sousTotalExpr expression SQL donnant le sous-total brut
 * @param {string} tauxPrefix    alias de la table portant taux_taxe_1/2
 */
function sqlTotals(sousTotalExpr, tauxPrefix = 'f') {
  const sousTotal = sqlRound(`COALESCE(${sousTotalExpr}, 0)`);
  const taxe1 = sqlRound(`${sousTotal} * COALESCE(${tauxPrefix}.taux_taxe_1, 0)`);
  const taxe2 = sqlRound(`${sousTotal} * COALESCE(${tauxPrefix}.taux_taxe_2, 0)`);
  return {
    sousTotal,
    taxe1,
    taxe2,
    // L'addition finale est arrondie : la somme de trois flottants déjà arrondis
    // redonne sinon des valeurs comme 0.06999999999999999.
    montantTotal: `ROUND(${sousTotal} + ${taxe1} + ${taxe2}, 2)`
  };
}

module.exports = { roundCents, sumLignes, computeTaxes, computeTotals, sqlTotals, sqlRound };
