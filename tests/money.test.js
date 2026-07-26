/**
 * Arithmétique monétaire : l'arrondi et la cohérence entre le calcul JavaScript
 * et le calcul SQL, dont dépend l'égalité entre le total imprimé sur la facture
 * et la somme de ses lignes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { roundCents, sumLignes, computeTaxes, computeTotals, sqlTotals } = require('../money.js');
const { createTestDb } = require('./helpers.js');

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

test('SQL et JavaScript produisent des montants identiques', async () => {
  const db = await createTestDb();
  try {
    const T = sqlTotals('t.sous_total', 'f');
    await db.exec(`
      CREATE TABLE t_sous (sous_total REAL);
      CREATE TABLE f_taux (taux_taxe_1 REAL, taux_taxe_2 REAL);
    `);

    // Un échantillon large de montants, dont les valeurs limites d'arrondi.
    const montants = [];
    for (let c = 1; c <= 5000; c++) montants.push(c / 100);
    for (const m of [0.015, 0.05, 1.005, 2.675, 9.995, 99.99, 1234.56, 19999.99]) montants.push(m);

    // Chaque combinaison de taux provinciaux est éprouvée sur tout l'échantillon.
    const jeuxDeTaux = [
      [0.05, 0.09975], // Québec
      [0.13, 0], // Ontario
      [0.15, 0], // Provinces maritimes
      [0.05, 0.07] // Colombie-Britannique
    ];

    await db.exec('BEGIN');
    for (const montant of montants) await db.run('INSERT INTO t_sous VALUES (?)', [montant]);
    await db.exec('COMMIT');

    for (const [taux1, taux2] of jeuxDeTaux) {
      await db.run('DELETE FROM f_taux');
      await db.run('INSERT INTO f_taux VALUES (?, ?)', [taux1, taux2]);

      const lignes = await db.all(`
        SELECT t.sous_total AS brut,
               ${T.sousTotal} AS sous_total, ${T.taxe1} AS taxe_1,
               ${T.taxe2} AS taxe_2, ${T.montantTotal} AS montant_total
        FROM t_sous t, f_taux f
      `);
      assert.equal(lignes.length, montants.length);

      for (const ligne of lignes) {
        const attendu = computeTotals([{ quantite: 1, prix_unitaire: ligne.brut }], taux1, taux2);
        const contexte = `${ligne.brut} à ${taux1}/${taux2}`;
        assert.equal(ligne.sous_total, attendu.sous_total, `sous-total pour ${contexte}`);
        assert.equal(ligne.taxe_1, attendu.taxe_1, `taxe 1 pour ${contexte}`);
        assert.equal(ligne.taxe_2, attendu.taxe_2, `taxe 2 pour ${contexte}`);
        assert.equal(ligne.montant_total, attendu.montant_total, `total pour ${contexte}`);
      }
    }
  } finally {
    await db.__cleanup();
  }
});
