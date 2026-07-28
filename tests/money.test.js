/**
 * Arithmétique monétaire : la règle d'arrondi dont dépend l'égalité entre le
 * total imprimé sur une facture et la somme de ses lignes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { roundCents, sumLignes, computeTaxes, computeTotals, formatMontant } = require('../money.js');

test('roundCents corrige les artefacts de représentation binaire', () => {
  assert.equal(roundCents(2.675), 2.68);
  assert.equal(roundCents(1.005), 1.01);
  assert.equal(roundCents(0.615), 0.62);
  assert.equal(roundCents(-2.675), -2.68);
  assert.equal(roundCents(100), 100);
  assert.equal(roundCents('12.344'), 12.34);
  assert.equal(roundCents(undefined), 0);
});

test('sumLignes additionne quantités et prix au cent', () => {
  assert.equal(sumLignes([{ quantite: 3, prix_unitaire: 33.33 }]), 99.99);
  assert.equal(sumLignes([
    { quantite: 1, prix_unitaire: 1000 },
    { quantite: 8, prix_unitaire: 90 }
  ]), 1720);
  assert.equal(sumLignes([]), 0);
  assert.equal(sumLignes(null), 0);
});

test('les taxes sont calculées séparément sur le sous-total hors taxes', () => {
  const { taxe_1, taxe_2 } = computeTaxes(100, 0.05, 0.09975);
  assert.equal(taxe_1, 5);
  // La TVQ porte sur le montant hors TPS depuis 2013 : 100 × 9,975 %, pas 105 × 9,975 %.
  assert.equal(taxe_2, 9.98);
});

test('le total est toujours la somme exacte des lignes affichées', () => {
  // Le total était calculé sous_total × (1 + t1 + t2) tandis que la facture
  // imprimait chaque taxe arrondie : un quart des montants ne balançait pas.
  for (let cents = 1; cents <= 200000; cents++) {
    const sousTotal = cents / 100;
    const { taxe_1, taxe_2, montant_total } = computeTotals(
      [{ quantite: 1, prix_unitaire: sousTotal }], 0.05, 0.09975
    );
    assert.equal(
      montant_total,
      roundCents(sousTotal + taxe_1 + taxe_2),
      `écart pour un sous-total de ${sousTotal}`
    );
  }
});

test('un sous-total de 100 $ au Québec donne 114,98 $', () => {
  const totaux = computeTotals([{ quantite: 1, prix_unitaire: 100 }], 0.05, 0.09975);
  assert.deepEqual(totaux, { sous_total: 100, taxe_1: 5, taxe_2: 9.98, montant_total: 114.98 });
});

test('formatMontant suit les conventions canadiennes', () => {
  // Français : virgule décimale, espace insécable en séparateur de milliers,
  // symbole après le nombre.
  assert.equal(formatMontant(1149.75), '1 149,75 $');
  assert.equal(formatMontant(0), '0,00 $');
  assert.equal(formatMontant(1234567.5), '1 234 567,50 $');
  assert.equal(formatMontant(-226), '-226,00 $');

  // Anglais : point décimal, virgule en séparateur, symbole devant.
  assert.equal(formatMontant(1149.75, 'CAD', 'en'), '$1,149.75');
  assert.equal(formatMontant(1130, 'CAD', 'en'), '$1,130.00');

  // La devise étrangère reste distinguable du dollar canadien.
  assert.match(formatMontant(919.8, 'USD'), /919,80/);
  assert.notEqual(formatMontant(919.8, 'USD'), formatMontant(919.8, 'CAD'));

  // Entrées douteuses : jamais « NaN $ » sur une facture.
  assert.equal(formatMontant(null), '0,00 $');
  assert.equal(formatMontant(undefined), '0,00 $');
  assert.equal(formatMontant('abc'), '0,00 $');
  assert.equal(formatMontant(12.5, ''), '12,50 $', 'devise vide : CAD par défaut');
});

test('les deux copies de formatMontant restent alignées', () => {
  // La fonction est dupliquée dans client/src/api.js, faute de module partagé
  // entre le serveur et l'interface. Une divergence ferait afficher deux
  // écritures différentes du même montant dans une même facture.
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'client', 'src', 'api.js'), 'utf8');

  const bloc = source.slice(source.indexOf('export function formatMontant'));
  assert.match(bloc, /langue === 'en' \? 'en-CA' : 'fr-CA'/, 'mêmes locales');
  assert.match(bloc, /style: 'currency'/, 'même style');
  assert.match(bloc, /currency: devise \|\| 'CAD'/, 'même devise par défaut');
  assert.match(bloc, /Number\(valeur\) \|\| 0/, 'même garde sur les entrées douteuses');
  assert.match(bloc, /catch \{/, 'même repli sur une devise inconnue');
});
