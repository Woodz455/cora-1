/**
 * Cycle de vie d'une facture : statuts, paiements, rapports.
 * Chaque test correspond à un défaut constaté sur la version précédente.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createFacture, addPaiement, getSoldeFacture, getFactureDetails,
  getDashboardStats, getReportStats, getTaxReport,
  cancelFacture, deleteFacture, updateFacture,
  getTaxRatesForProvince, resolveStatut, STATUTS
} = require('../invoiceService.js');
const { createTestDb, insertClient } = require('./helpers.js');

const LIGNE_1000 = [{ description: 'Service', quantite: 1, prix_unitaire: 1000 }];

/** Prépare une base avec un client et une facture de 1000 $ HT. */
async function withFacture(t, options = {}) {
  const db = await createTestDb();
  t.after(() => db.__cleanup());

  const clientId = await insertClient(db, { province: options.province || 'QC' });
  const facture = await createFacture(db, {
    client_id: clientId,
    date_emission: options.dateEmission || '2026-07-01',
    date_echeance: options.dateEcheance || '2026-07-31',
    devise: options.devise || 'CAD',
    taux_change: options.tauxChange || 1.0
  }, options.lignes || LIGNE_1000);

  return { db, clientId, facture };
}

test('les taux de taxe suivent la province du client', () => {
  assert.deepEqual(getTaxRatesForProvince('QC'),
    { taxe_1_nom: 'TPS', taxe_1_taux: 0.05, taxe_2_nom: 'TVQ', taxe_2_taux: 0.09975 });
  assert.deepEqual(getTaxRatesForProvince('on'),
    { taxe_1_nom: 'TVH', taxe_1_taux: 0.13, taxe_2_nom: '', taxe_2_taux: 0 });
  assert.equal(getTaxRatesForProvince('AB').taxe_1_taux, 0.05);
  assert.equal(getTaxRatesForProvince('NS').taxe_1_taux, 0.15);
  assert.equal(getTaxRatesForProvince(undefined).taxe_1_taux, 0);
});

test('resolveStatut découle uniquement des montants', () => {
  assert.equal(resolveStatut(STATUTS.EN_ATTENTE, 1000, 0), STATUTS.EN_ATTENTE);
  assert.equal(resolveStatut(STATUTS.EN_ATTENTE, 700, 300), STATUTS.PARTIELLE);
  assert.equal(resolveStatut(STATUTS.EN_ATTENTE, 0, 1000), STATUTS.PAYEE);
  // Une facture annulée le reste, quels que soient les montants.
  assert.equal(resolveStatut(STATUTS.ANNULEE, 1000, 0), STATUTS.ANNULEE);
});

test('un acompte fait passer la facture en « Partiellement payée »', async (t) => {
  const { db, facture } = await withFacture(t);
  assert.equal(facture.statut, STATUTS.EN_ATTENTE);
  assert.equal(facture.montant_total, 1149.75);

  const apres = await addPaiement(db, facture.id, 300, 'acompte', '2026-07-05');

  // L'ancien code testait un statut « Envoyée » que rien ne produisait : la
  // facture restait indéfiniment « En attente » après un acompte.
  assert.equal(apres.statut, STATUTS.PARTIELLE);
  assert.equal(apres.montant_paye, 300);
  assert.equal(apres.solde_restant, 849.75);
});

test('le solde nul fait passer la facture en « Payée »', async (t) => {
  const { db, facture } = await withFacture(t);
  const apres = await addPaiement(db, facture.id, 1149.75, 'solde', '2026-07-05');
  assert.equal(apres.statut, STATUTS.PAYEE);
  assert.equal(apres.solde_restant, 0);
});

test('un paiement supérieur au solde est refusé', async (t) => {
  const { db, facture } = await withFacture(t);
  await addPaiement(db, facture.id, 300, '', '2026-07-05');

  await assert.rejects(
    () => addPaiement(db, facture.id, 5000, '', '2026-07-06'),
    (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /dépasse le solde restant/);
      return true;
    }
  );

  // Aucun paiement fantôme, et le solde reste positif.
  const etat = await getSoldeFacture(db, facture.id);
  assert.equal(etat.montant_paye, 300);
  assert.equal(etat.solde_restant, 849.75);
});

test('un paiement négatif ou nul est refusé', async (t) => {
  const { db, facture } = await withFacture(t);
  await assert.rejects(() => addPaiement(db, facture.id, 0), /strictement positif/);
  await assert.rejects(() => addPaiement(db, facture.id, -50), /strictement positif/);
});

test('une facture soldée ou annulée n\'accepte plus de paiement', async (t) => {
  const { db, facture } = await withFacture(t);
  await addPaiement(db, facture.id, 1149.75, '', '2026-07-05');
  await assert.rejects(() => addPaiement(db, facture.id, 10), /déjà soldée/);

  const { db: db2, facture: f2 } = await withFacture(t);
  await cancelFacture(db2, f2.id);
  await assert.rejects(() => addPaiement(db2, f2.id, 10), /annulée/);
});

test('le tableau de bord compte tout ce qui est encaissé', async (t) => {
  const { db, facture } = await withFacture(t);
  await addPaiement(db, facture.id, 300, 'acompte', '2026-07-05');

  const stats = await getDashboardStats(db);

  // L'ancien calcul filtrait sur le statut de la facture : un acompte sur une
  // facture « En attente » n'apparaissait nulle part.
  assert.equal(stats.chiffreAffaires, 300);
  assert.equal(stats.facturesEnAttente + stats.facturesEnRetard, 849.75);
  assert.deepEqual(stats.chartData, [{ name: '2026-07', revenu: 300 }]);
});

test('les rapports convertissent aussi les paiements en dollars canadiens', async (t) => {
  const { db, facture } = await withFacture(t, { devise: 'USD', tauxChange: 1.4 });
  // Facture de 1000 USD HT, soit 1149,75 USD taxes comprises, réglée intégralement.
  await addPaiement(db, facture.id, 1149.75, 'paiement USD', '2026-07-11');

  const rapport = await getReportStats(db);
  const attenduCad = Number((1149.75 * 1.4).toFixed(2));

  // Le taux de change n'était appliqué qu'au facturé : l'encaissé dépassait le
  // facturé et le solde à percevoir devenait négatif.
  assert.equal(rapport.revenu_total, attenduCad);
  assert.equal(rapport.total_encaisse, attenduCad);
  assert.equal(rapport.solde_a_percevoir, 0);
});

test('le rapport de taxes ventile chaque régime séparément', async (t) => {
  const db = await createTestDb();
  t.after(() => db.__cleanup());

  const qc = await insertClient(db, { province: 'QC', nom: 'Client QC' });
  const on = await insertClient(db, { province: 'ON', nom: 'Client ON' });

  await createFacture(db, { client_id: qc, date_emission: '2026-07-01', date_echeance: '2026-07-31' }, LIGNE_1000);
  await createFacture(db, { client_id: on, date_emission: '2026-07-02', date_echeance: '2026-08-01' }, LIGNE_1000);

  const rapport = await getTaxReport(db, '2026', '07');
  const parNom = Object.fromEntries(rapport.parRegime.map((r) => [r.nom, r.montant]));

  // TPS, TVQ et TVH doivent être déclarées séparément : les additionner en un
  // seul chiffre rendait le rapport inutilisable pour une déclaration.
  assert.deepEqual(Object.keys(parNom).sort(), ['TPS', 'TVH', 'TVQ']);
  assert.equal(parNom.TPS, 50);
  assert.equal(parNom.TVQ, 99.75);
  assert.equal(parNom.TVH, 130);
  assert.equal(rapport.taxes_facturees, 279.75);
});

test('le rapport de taxes retient les taxes payées sur les dépenses', async (t) => {
  const { db } = await withFacture(t);
  await db.run(
    `INSERT INTO depenses (fournisseur, description, date_depense, montant_ht, tps, tvq, montant_ttc, categorie)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ['Fournisseur', 'Matériel', '2026-07-15', 100, 5, 9.98, 114.98, 'Matériel']
  );

  const rapport = await getTaxReport(db, '2026', '07');
  assert.equal(rapport.taxes_facturees, 149.75);
  assert.equal(rapport.taxes_payees, 14.98);
  assert.equal(rapport.taxes_nettes, 134.77);
});

test('les rapports distinguent dépenses hors taxes et toutes taxes comprises', async (t) => {
  const { db } = await withFacture(t);
  await db.run(
    `INSERT INTO depenses (fournisseur, description, date_depense, montant_ht, tps, tvq, montant_ttc, categorie)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ['Fournisseur', 'Matériel', '2026-07-15', 100, 5, 9.98, 114.98, 'Matériel']
  );

  const rapport = await getReportStats(db);
  // Le bénéfice net doit se calculer sur le hors taxes, les taxes étant récupérables.
  assert.equal(rapport.total_depenses_ht, 100);
  assert.equal(rapport.total_taxes_recuperables, 14.98);
  assert.equal(rapport.total_depenses, 114.98);
});

test('une facture payée ne peut être ni annulée, ni modifiée, ni supprimée', async (t) => {
  const { db, clientId, facture } = await withFacture(t);
  await addPaiement(db, facture.id, 300, '', '2026-07-05');

  await assert.rejects(() => cancelFacture(db, facture.id), /note de crédit/);
  await assert.rejects(() => deleteFacture(db, facture.id), /ne peut pas être supprimée/);
  await assert.rejects(
    () => updateFacture(db, facture.id, { client_id: clientId, date_echeance: '2026-08-31' }, LIGNE_1000),
    /peuvent être modifiées|ne peut pas être modifiée/
  );

  // Le paiement est toujours là : rien n'a été effacé en cascade.
  const etat = await getSoldeFacture(db, facture.id);
  assert.equal(etat.montant_paye, 300);
});

test('une facture sans paiement reste supprimable', async (t) => {
  const { db, facture } = await withFacture(t);
  const resultat = await deleteFacture(db, facture.id);
  assert.match(resultat.message, /supprimée/);
  assert.equal(await getSoldeFacture(db, facture.id), undefined);
});

test('la numérotation ne réattribue jamais un numéro déjà émis', async (t) => {
  const db = await createTestDb();
  t.after(() => db.__cleanup());
  const clientId = await insertClient(db);

  const f1 = await createFacture(db, { client_id: clientId, date_emission: '2026-07-01', date_echeance: '2026-07-31' }, LIGNE_1000);
  const f2 = await createFacture(db, { client_id: clientId, date_emission: '2026-07-02', date_echeance: '2026-08-01' }, LIGNE_1000);
  const f3 = await createFacture(db, { client_id: clientId, date_emission: '2026-07-03', date_echeance: '2026-08-02' }, LIGNE_1000);

  assert.equal(f1.numero_facture, 'SHT-202607-0001');
  assert.equal(f2.numero_facture, 'SHT-202607-0002');
  assert.equal(f3.numero_facture, 'SHT-202607-0003');

  // Après suppression de la dernière, la séquence ne revient pas en arrière.
  await deleteFacture(db, f3.id);
  const f4 = await createFacture(db, { client_id: clientId, date_emission: '2026-07-04', date_echeance: '2026-08-03' }, LIGNE_1000);
  assert.equal(f4.numero_facture, 'SHT-202607-0004');

  // Le mois suivant repart à 1.
  const f5 = await createFacture(db, { client_id: clientId, date_emission: '2026-08-01', date_echeance: '2026-08-31' }, LIGNE_1000);
  assert.equal(f5.numero_facture, 'SHT-202608-0001');
});

test('les détails de facture exposent des totaux cohérents pour le PDF', async (t) => {
  const { db, facture } = await withFacture(t, {
    lignes: [{ description: 'Arrondi', quantite: 3, prix_unitaire: 33.33 }]
  });

  const details = await getFactureDetails(db, facture.id);

  // Le PDF affiche sous-total, taxes et total : les trois doivent balancer.
  assert.equal(details.sous_total, 99.99);
  assert.equal(
    Number((details.sous_total + details.montant_taxe_1 + details.montant_taxe_2).toFixed(2)),
    details.montant_total
  );
  assert.equal(details.lignes.length, 1);
  assert.ok(details.client_details);
  assert.ok(details.settings);
});

test('une facture émise conserve ses taux même si le client change de province', async (t) => {
  const { db, clientId, facture } = await withFacture(t, { province: 'QC' });
  await db.run('UPDATE clients SET province = ? WHERE id = ?', ['ON', clientId]);

  const etat = await getSoldeFacture(db, facture.id);
  assert.equal(etat.taux_taxe_1, 0.05);
  assert.equal(etat.taxe_2_nom, 'TVQ');
  assert.equal(etat.montant_total, 1149.75);
});

test('la création échoue si le client est inconnu', async (t) => {
  const db = await createTestDb();
  t.after(() => db.__cleanup());

  await assert.rejects(
    () => createFacture(db, { client_id: 999, date_emission: '2026-07-01', date_echeance: '2026-07-31' }, LIGNE_1000),
    /Client introuvable/
  );
  // La transaction est annulée : aucune facture partielle ne subsiste.
  const { count } = await db.get('SELECT COUNT(*) AS count FROM factures');
  assert.equal(count, 0);
});
