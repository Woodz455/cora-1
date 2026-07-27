/**
 * Notes de crédit : émission, effet sur le solde, sur les rapports et sur la
 * déclaration de taxes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createFacture, addPaiement, getSoldeFacture, getFactureDetails,
  updateFacture, cancelFacture, deleteFacture, getReportStats, getTaxReport,
  resolveStatut, STATUTS
} = require('../invoiceService.js');
const {
  createNoteCredit, deleteNoteCredit, getNotesCredit, getNoteCreditDetails
} = require('../noteCreditService.js');
const { createTestDb, insertClient } = require('./helpers.js');

const LIGNES = [{ description: 'Service', quantite: 1, prix_unitaire: 1000 }];

/** Facture québécoise de 1000 $ HT, soit 1149,75 $ taxes comprises. */
async function avecFacture(t, province = 'QC') {
  const db = await createTestDb();
  t.after(() => db.__cleanup());
  const clientId = await insertClient(db, { province });
  const facture = await createFacture(db, {
    client_id: clientId, date_emission: '2026-07-01', date_echeance: '2026-07-31'
  }, LIGNES);
  return { db, clientId, facture };
}

test('une note de crédit diminue le montant dû', async (t) => {
  const { db, facture } = await avecFacture(t);
  assert.equal(facture.montant_total, 1149.75);

  const note = await createNoteCredit(db, facture.id, {
    date_emission: '2026-07-10', motif: 'Remise commerciale'
  }, [{ description: 'Remise', quantite: 1, prix_unitaire: 200 }]);

  assert.match(note.numero_note, /^NC-202607-\d{4}$/);
  assert.equal(note.sous_total, 200);
  assert.equal(note.montant_total, 229.95);

  const apres = await getSoldeFacture(db, facture.id);
  assert.equal(apres.montant_total, 1149.75, 'la facture d\'origine ne bouge pas');
  assert.equal(apres.montant_credite, 229.95);
  assert.equal(apres.montant_net, 919.80);
  assert.equal(apres.solde_restant, 919.80);
});

test('la note reprend les taxes de la facture d\'origine', async (t) => {
  const { db, facture } = await avecFacture(t, 'ON');

  const note = await createNoteCredit(db, facture.id, { date_emission: '2026-07-10' },
    [{ description: 'Retour', quantite: 1, prix_unitaire: 100 }]);

  // Facture ontarienne : la note doit annuler de la TVH, pas de la TPS/TVQ.
  assert.equal(note.taxe_1_nom, 'TVH');
  assert.equal(note.taux_taxe_1, 0.13);
  assert.equal(note.montant_taxe_1, 13);
  assert.equal(note.montant_total, 113);
});

test('créditer plus que la facture est refusé', async (t) => {
  const { db, facture } = await avecFacture(t);

  await assert.rejects(
    () => createNoteCredit(db, facture.id, { date_emission: '2026-07-10' },
      [{ description: 'Trop', quantite: 1, prix_unitaire: 5000 }]),
    (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /dépasse le montant créditable/);
      return true;
    }
  );

  const apres = await getSoldeFacture(db, facture.id);
  assert.equal(apres.montant_credite, 0);
});

test('le cumul des notes est plafonné au total de la facture', async (t) => {
  const { db, facture } = await avecFacture(t);

  await createNoteCredit(db, facture.id, { date_emission: '2026-07-10' },
    [{ description: 'Premier crédit', quantite: 1, prix_unitaire: 600 }]);

  await assert.rejects(
    () => createNoteCredit(db, facture.id, { date_emission: '2026-07-11' },
      [{ description: 'Second crédit', quantite: 1, prix_unitaire: 600 }]),
    /dépasse le montant créditable/
  );

  // Le solde disponible restant passe, lui, sans problème.
  await createNoteCredit(db, facture.id, { date_emission: '2026-07-11' },
    [{ description: 'Second crédit', quantite: 1, prix_unitaire: 400 }]);

  const apres = await getSoldeFacture(db, facture.id);
  assert.equal(apres.montant_credite, 1149.75);
  assert.equal(apres.solde_restant, 0);
});

test('une facture entièrement créditée est « Créditée », pas « Payée »', async (t) => {
  const { db, facture } = await avecFacture(t);

  await createNoteCredit(db, facture.id, { date_emission: '2026-07-10' },
    [{ description: 'Annulation totale', quantite: 1, prix_unitaire: 1000 }]);

  const apres = await getSoldeFacture(db, facture.id);
  // Aucun argent n'est entré : afficher « Payée » ferait croire à un encaissement.
  assert.equal(apres.statut, STATUTS.CREDITEE);
  assert.equal(apres.montant_paye, 0);
  assert.equal(apres.solde_restant, 0);
});

test('resolveStatut distingue créditée, payée et partielle', () => {
  assert.equal(resolveStatut(STATUTS.EN_ATTENTE, 0, 0, 1149.75, 1149.75), STATUTS.CREDITEE);
  assert.equal(resolveStatut(STATUTS.EN_ATTENTE, 0, 1149.75, 0, 1149.75), STATUTS.PAYEE);
  assert.equal(resolveStatut(STATUTS.EN_ATTENTE, 500, 300, 349.75, 1149.75), STATUTS.PARTIELLE);
  // Un crédit partiel sans paiement laisse la facture en attente du solde.
  assert.equal(resolveStatut(STATUTS.EN_ATTENTE, 900, 0, 249.75, 1149.75), STATUTS.EN_ATTENTE);
  assert.equal(resolveStatut(STATUTS.ANNULEE, 0, 0, 1149.75, 1149.75), STATUTS.ANNULEE);
});

test('un crédit après paiement fait apparaître un montant à rembourser', async (t) => {
  const { db, facture } = await avecFacture(t);
  await addPaiement(db, facture.id, 1149.75, 'règlement intégral', '2026-07-05');

  await createNoteCredit(db, facture.id, { date_emission: '2026-07-20', motif: 'Marchandise retournée' },
    [{ description: 'Retour', quantite: 1, prix_unitaire: 200 }]);

  const apres = await getSoldeFacture(db, facture.id);
  assert.equal(apres.montant_net, 919.80);
  assert.equal(apres.montant_paye, 1149.75);
  assert.equal(apres.montant_a_rembourser, 229.95);
  assert.equal(apres.solde_restant, -229.95);
});

test('le paiement est plafonné au montant net des crédits', async (t) => {
  const { db, facture } = await avecFacture(t);
  await createNoteCredit(db, facture.id, { date_emission: '2026-07-10' },
    [{ description: 'Remise', quantite: 1, prix_unitaire: 200 }]);

  await assert.rejects(
    () => addPaiement(db, facture.id, 1149.75, '', '2026-07-15'),
    /dépasse le solde restant/
  );

  const apres = await addPaiement(db, facture.id, 919.80, '', '2026-07-15');
  assert.equal(apres.statut, STATUTS.PAYEE);
  assert.equal(apres.solde_restant, 0);
});

test('les rapports retranchent les notes de crédit du revenu', async (t) => {
  const { db, facture } = await avecFacture(t);
  await createNoteCredit(db, facture.id, { date_emission: '2026-07-10' },
    [{ description: 'Remise', quantite: 1, prix_unitaire: 200 }]);

  const rapport = await getReportStats(db);
  assert.equal(rapport.revenu_total, 919.80);
  assert.equal(rapport.total_credite, 229.95);
  assert.equal(rapport.solde_a_percevoir, 919.80);
});

test('le rapport de taxes déduit la taxe annulée', async (t) => {
  const { db, facture } = await avecFacture(t);

  const avant = await getTaxReport(db, '2026', '07');
  assert.equal(avant.summary.total_taxe_1, 50);
  assert.equal(avant.summary.total_taxe_2, 99.75);

  await createNoteCredit(db, facture.id, { date_emission: '2026-07-10' },
    [{ description: 'Remise', quantite: 1, prix_unitaire: 200 }]);

  const apres = await getTaxReport(db, '2026', '07');
  // 1000 $ facturés moins 200 $ crédités : la taxe à remettre suit.
  assert.equal(apres.summary.total_revenus_taxables, 800);
  assert.equal(apres.summary.total_taxe_1, 40);
  assert.equal(apres.summary.total_taxe_2, 79.80);

  const parNom = Object.fromEntries(apres.parRegime.map((r) => [r.nom, r.montant]));
  assert.equal(parNom.TPS, 40);
  assert.equal(parNom.TVQ, 79.80);
  assert.equal(apres.taxes_facturees, 119.80);
});

test('la note de crédit compte sur la période de sa propre émission', async (t) => {
  const { db, facture } = await avecFacture(t);
  // Facture émise en juillet, crédit accordé en août.
  await createNoteCredit(db, facture.id, { date_emission: '2026-08-05' },
    [{ description: 'Geste commercial', quantite: 1, prix_unitaire: 200 }]);

  const juillet = await getTaxReport(db, '2026', '07');
  assert.equal(juillet.summary.total_taxe_1, 50, 'juillet garde la taxe facturée');

  const aout = await getTaxReport(db, '2026', '08');
  assert.equal(aout.summary.total_taxe_1, -10, 'août porte la taxe annulée, en négatif');

  const annee = await getTaxReport(db, '2026');
  assert.equal(annee.summary.total_taxe_1, 40, 'sur l\'année, les deux se compensent');
});

test('une facture créditée ne peut être ni modifiée, ni annulée, ni supprimée', async (t) => {
  const { db, clientId, facture } = await avecFacture(t);
  await createNoteCredit(db, facture.id, { date_emission: '2026-07-10' },
    [{ description: 'Remise', quantite: 1, prix_unitaire: 200 }]);

  await assert.rejects(
    () => updateFacture(db, facture.id, { client_id: clientId, date_echeance: '2026-08-31' }, LIGNES),
    /note de crédit/
  );
  await assert.rejects(() => cancelFacture(db, facture.id), /note de crédit/);
  await assert.rejects(() => deleteFacture(db, facture.id), /note de crédit/);
});

test('une note peut être retirée tant qu\'aucun paiement n\'est enregistré', async (t) => {
  const { db, facture } = await avecFacture(t);
  const note = await createNoteCredit(db, facture.id, { date_emission: '2026-07-10' },
    [{ description: 'Erreur de saisie', quantite: 1, prix_unitaire: 200 }]);

  await deleteNoteCredit(db, note.id);

  const apres = await getSoldeFacture(db, facture.id);
  assert.equal(apres.montant_credite, 0);
  assert.equal(apres.solde_restant, 1149.75);
  assert.equal(apres.statut, STATUTS.EN_ATTENTE);
});

test('une note rattachée à une facture encaissée n\'est plus supprimable', async (t) => {
  const { db, facture } = await avecFacture(t);
  const note = await createNoteCredit(db, facture.id, { date_emission: '2026-07-10' },
    [{ description: 'Remise', quantite: 1, prix_unitaire: 200 }]);
  await addPaiement(db, facture.id, 500, '', '2026-07-15');

  await assert.rejects(() => deleteNoteCredit(db, note.id), /comporte un paiement/);
});

test('la numérotation des notes suit le mois d\'émission', async (t) => {
  const { db, facture } = await avecFacture(t);

  const n1 = await createNoteCredit(db, facture.id, { date_emission: '2026-07-10' },
    [{ description: 'A', quantite: 1, prix_unitaire: 100 }]);
  const n2 = await createNoteCredit(db, facture.id, { date_emission: '2026-07-11' },
    [{ description: 'B', quantite: 1, prix_unitaire: 100 }]);
  const n3 = await createNoteCredit(db, facture.id, { date_emission: '2026-08-01' },
    [{ description: 'C', quantite: 1, prix_unitaire: 100 }]);

  assert.equal(n1.numero_note, 'NC-202607-0001');
  assert.equal(n2.numero_note, 'NC-202607-0002');
  assert.equal(n3.numero_note, 'NC-202608-0001');
});

test('les détails exposent la note et sa facture d\'origine', async (t) => {
  const { db, facture } = await avecFacture(t);
  const note = await createNoteCredit(db, facture.id, { date_emission: '2026-07-10', motif: 'Retour partiel' },
    [{ description: 'Article retourné', quantite: 2, prix_unitaire: 50 }]);

  const details = await getNoteCreditDetails(db, note.id);
  assert.equal(details.numero_facture, facture.numero_facture);
  assert.equal(details.motif, 'Retour partiel');
  assert.equal(details.lignes.length, 1);
  assert.ok(details.client_details);
  assert.ok(details.settings);
  assert.equal(
    Number((details.sous_total + details.montant_taxe_1 + details.montant_taxe_2).toFixed(2)),
    details.montant_total
  );

  // La facture porte la liste de ses notes, pour l'affichage et l'impression.
  const factureDetails = await getFactureDetails(db, facture.id);
  assert.equal(factureDetails.notes_credit.length, 1);
  assert.equal(factureDetails.notes_credit[0].numero_note, note.numero_note);

  const liste = await getNotesCredit(db);
  assert.equal(liste.length, 1);
  assert.equal(liste[0].client, 'Client Test');
});

test('une note de crédit vide ou sur une facture annulée est refusée', async (t) => {
  const { db, facture } = await avecFacture(t);

  await assert.rejects(
    () => createNoteCredit(db, facture.id, { date_emission: '2026-07-10' },
      [{ description: 'Rien', quantite: 1, prix_unitaire: 0 }]),
    /strictement positif/
  );

  await cancelFacture(db, facture.id);
  await assert.rejects(
    () => createNoteCredit(db, facture.id, { date_emission: '2026-07-10' },
      [{ description: 'X', quantite: 1, prix_unitaire: 100 }]),
    /annulée/
  );
});
