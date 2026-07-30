/**
 * Annulation d'un encaissement saisi à tort.
 *
 * Le cas d'origine : une facture de 113 $ portait 3 000 $ d'encaissements, issus
 * d'un dépôt bancaire mal affecté, et rien dans l'application ne permettait de
 * revenir dessus.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createFacture, addPaiement, annulerPaiement,
  getSoldeFacture, getFactureDetails, getReportStats, getDashboardStats, STATUTS
} = require('../invoiceService.js');
const { createNoteCredit } = require('../noteCreditService.js');
const { diagnostiquer, corrigerStatuts, annulerSurpaiements } = require('../doctor.js');
const { createTestDb, insertClient } = require('./helpers.js');

const LIGNES = [{ description: 'Service', quantite: 1, prix_unitaire: 100 }];

/** Facture de 113 $ (100 + TVH 13 %), comme celle du cas réel, soldée. */
async function factureReglee(t) {
  const db = await createTestDb();
  t.after(() => db.__cleanup());

  const clientId = await insertClient(db, { province: 'ON' });
  const facture = await createFacture(db, {
    client_id: clientId, date_emission: '2026-06-01', date_echeance: '2026-06-30'
  }, LIGNES);

  await addPaiement(db, facture.id, 113, 'Chèque 1234', '2026-06-15');
  return { db, facture };
}

/** Insère un paiement directement en base, comme la donnée héritée. */
async function insererPaiementBrut(db, factureId, montant, note, transactionId = null) {
  const { lastID } = await db.run(
    'INSERT INTO paiements (facture_id, date_paiement, montant, note, transaction_id) VALUES (?, ?, ?, ?, ?)',
    [factureId, '2026-05-26', montant, note, transactionId]
  );
  return lastID;
}

test('un paiement annulé ne compte plus dans le solde', async (t) => {
  const { db, facture } = await factureReglee(t);

  const avant = await getSoldeFacture(db, facture.id);
  assert.equal(avant.solde_restant, 0);
  assert.equal(avant.statut, STATUTS.PAYEE);

  const paiements = await db.all('SELECT id FROM paiements WHERE facture_id = ?', [facture.id]);
  await annulerPaiement(db, paiements[0].id, { motif: 'Chèque sans provision', utilisateur: 'patron' });

  const apres = await getSoldeFacture(db, facture.id);
  assert.equal(apres.montant_paye, 0);
  assert.equal(apres.solde_restant, 113);
  assert.equal(apres.statut, STATUTS.EN_ATTENTE, 'la facture redevient due');
});

test('la ligne reste en base, avec son motif et son auteur', async (t) => {
  const { db, facture } = await factureReglee(t);
  const [paiement] = await db.all('SELECT id FROM paiements WHERE facture_id = ?', [facture.id]);

  await annulerPaiement(db, paiement.id, { motif: 'Chèque sans provision', utilisateur: 'patron' });

  const ligne = await db.get('SELECT * FROM paiements WHERE id = ?', [paiement.id]);
  assert.ok(ligne, 'le paiement n\'est pas effacé');
  assert.equal(ligne.montant, 113, 'son montant est conservé tel quel');
  assert.equal(ligne.motif_annulation, 'Chèque sans provision');
  assert.equal(ligne.annule_par, 'patron');
  assert.match(ligne.annule_le, /^\d{4}-\d{2}-\d{2}$/);
});

test('le détail de la facture montre le paiement annulé', async (t) => {
  const { db, facture } = await factureReglee(t);
  const [paiement] = await db.all('SELECT id FROM paiements WHERE facture_id = ?', [facture.id]);
  await annulerPaiement(db, paiement.id, { motif: 'Erreur de saisie', utilisateur: 'patron' });

  const details = await getFactureDetails(db, facture.id);
  assert.equal(details.paiements.length, 1);
  assert.equal(details.paiements[0].id, paiement.id, 'l\'identifiant est remonté');
  assert.equal(details.paiements[0].motif_annulation, 'Erreur de saisie');
  assert.equal(details.montant_paye, 0, 'sans compter dans les totaux');
});

test('annuler deux fois le même paiement est refusé', async (t) => {
  const { db, facture } = await factureReglee(t);
  const [paiement] = await db.all('SELECT id FROM paiements WHERE facture_id = ?', [facture.id]);

  await annulerPaiement(db, paiement.id, {});
  await assert.rejects(
    () => annulerPaiement(db, paiement.id, {}),
    (err) => err.status === 400 && /déjà annulé/.test(err.message)
  );
});

test('un paiement inconnu lève une 404', async (t) => {
  const { db } = await factureReglee(t);
  await assert.rejects(() => annulerPaiement(db, 99999, {}), (err) => err.status === 404);
});

test('après annulation, la facture accepte de nouveau un paiement', async (t) => {
  const { db, facture } = await factureReglee(t);
  const [paiement] = await db.all('SELECT id FROM paiements WHERE facture_id = ?', [facture.id]);

  await annulerPaiement(db, paiement.id, { motif: 'Montant erroné' });
  const apres = await addPaiement(db, facture.id, 113, 'Chèque 1235', '2026-06-20');

  assert.equal(apres.solde_restant, 0);
  assert.equal(apres.statut, STATUTS.PAYEE);
});

test('un paiement annulé sort du chiffre d\'affaires et du tableau de bord', async (t) => {
  const { db, facture } = await factureReglee(t);

  const avant = await getReportStats(db);
  assert.equal(avant.total_encaisse, 113);

  const [paiement] = await db.all('SELECT id FROM paiements WHERE facture_id = ?', [facture.id]);
  await annulerPaiement(db, paiement.id, {});

  const apres = await getReportStats(db);
  assert.equal(apres.total_encaisse, 0);
  assert.equal(apres.solde_a_percevoir, 113);

  const bord = await getDashboardStats(db);
  assert.equal(bord.chartData.reduce((s, m) => s + m.revenu, 0), 0,
    'les encaissements par mois n\'en tiennent plus compte');
});

test('un paiement annulé ne bloque plus la suppression d\'une note de crédit', async (t) => {
  const db = await createTestDb();
  t.after(() => db.__cleanup());

  const clientId = await insertClient(db, { province: 'ON' });
  const facture = await createFacture(db, {
    client_id: clientId, date_emission: '2026-06-01', date_echeance: '2026-06-30'
  }, LIGNES);

  const note = await createNoteCredit(db, facture.id, { date_emission: '2026-06-10' },
    [{ description: 'Remise', quantite: 1, prix_unitaire: 20 }]);
  await addPaiement(db, facture.id, 50, '', '2026-06-15');

  const { deleteNoteCredit } = require('../noteCreditService.js');
  await assert.rejects(() => deleteNoteCredit(db, note.id), (err) => err.status === 400);

  const [paiement] = await db.all('SELECT id FROM paiements WHERE facture_id = ?', [facture.id]);
  await annulerPaiement(db, paiement.id, {});
  await deleteNoteCredit(db, note.id);
});

test('annuler un paiement issu du rapprochement remet la transaction en attente', async (t) => {
  const db = await createTestDb();
  t.after(() => db.__cleanup());

  const clientId = await insertClient(db, { province: 'ON' });
  const facture = await createFacture(db, {
    client_id: clientId, date_emission: '2026-06-01', date_echeance: '2026-06-30'
  }, LIGNES);

  const { lastID: transactionId } = await db.run(
    "INSERT INTO transactions_bancaires (date_transaction, description, montant, statut, facture_id) VALUES (?, ?, ?, 'Rapproché', ?)",
    ['2026-06-15', 'Dépôt', 113, facture.id]
  );
  await addPaiement(db, facture.id, 113, 'Rapprochement bancaire : Dépôt', '2026-06-15', transactionId);

  const [paiement] = await db.all('SELECT id FROM paiements WHERE facture_id = ?', [facture.id]);
  await annulerPaiement(db, paiement.id, { motif: 'Mauvaise facture' });

  const transaction = await db.get('SELECT statut, facture_id FROM transactions_bancaires WHERE id = ?', [transactionId]);
  assert.equal(transaction.statut, 'En attente', 'le dépôt retourne dans la file');
  assert.equal(transaction.facture_id, null, 'et se détache de la facture');
});

test('un paiement hérité, sans transaction_id, est rattaché par sa note', async (t) => {
  const db = await createTestDb();
  t.after(() => db.__cleanup());

  const clientId = await insertClient(db, { province: 'ON' });
  const facture = await createFacture(db, {
    client_id: clientId, date_emission: '2026-06-01', date_echeance: '2026-06-30'
  }, LIGNES);

  const { lastID: transactionId } = await db.run(
    "INSERT INTO transactions_bancaires (date_transaction, description, montant, statut, facture_id) VALUES (?, ?, ?, 'Rapproché', ?)",
    ['2026-05-26', 'AAAA', 3000, facture.id]
  );
  // Aucun transaction_id : exactement la forme des paiements antérieurs.
  const paiementId = await insererPaiementBrut(db, facture.id, 3000, 'Rapprochement bancaire: AAAA');

  await annulerPaiement(db, paiementId, {});

  const transaction = await db.get('SELECT statut FROM transactions_bancaires WHERE id = ?', [transactionId]);
  assert.equal(transaction.statut, 'En attente');
});

test('le diagnostic nomme le paiement à l\'origine de l\'excédent', async (t) => {
  const db = await createTestDb();
  t.after(() => db.__cleanup());

  const clientId = await insertClient(db, { province: 'ON' });
  const facture = await createFacture(db, {
    client_id: clientId, date_emission: '2026-06-01', date_echeance: '2026-06-30'
  }, LIGNES);
  await insererPaiementBrut(db, facture.id, 3000, 'Rapprochement bancaire: AAAA');

  const anomalies = await diagnostiquer(db);
  const excedent = anomalies.find((a) => /excédent/.test(a.probleme));

  assert.ok(excedent, 'le sur-paiement est signalé');
  assert.match(excedent.probleme, /3 000,00 \$/, 'le montant du paiement fautif est cité');
  assert.match(excedent.probleme, /Rapprochement bancaire/, 'son origine aussi');
  assert.match(excedent.action, /--annuler-surpaiements/, 'la commande de réparation est indiquée');
});

test('--annuler-surpaiements ramène la facture à son solde réel', async (t) => {
  const db = await createTestDb();
  t.after(() => db.__cleanup());

  const clientId = await insertClient(db, { province: 'ON' });
  const facture = await createFacture(db, {
    client_id: clientId, date_emission: '2026-06-01', date_echeance: '2026-06-30'
  }, LIGNES);

  const { lastID: transactionId } = await db.run(
    "INSERT INTO transactions_bancaires (date_transaction, description, montant, statut, facture_id) VALUES (?, ?, ?, 'Rapproché', ?)",
    ['2026-05-26', 'AAAA', 3000, facture.id]
  );
  await insererPaiementBrut(db, facture.id, 3000, 'Rapprochement bancaire: AAAA', transactionId);

  assert.equal((await getSoldeFacture(db, facture.id)).solde_restant, -2887);

  const annules = await annulerSurpaiements(db);
  assert.equal(annules, 1);

  const apres = await getSoldeFacture(db, facture.id);
  assert.equal(apres.solde_restant, 113, 'la facture redevient due de son montant');
  assert.equal(apres.statut, STATUTS.EN_ATTENTE);

  const transaction = await db.get('SELECT statut FROM transactions_bancaires WHERE id = ?', [transactionId]);
  assert.equal(transaction.statut, 'En attente', 'le dépôt est de nouveau à affecter');

  assert.equal((await diagnostiquer(db)).filter((a) => /excédent/.test(a.probleme)).length, 0);
});

test('un sur-paiement saisi à la main n\'est jamais défait d\'office', async (t) => {
  const db = await createTestDb();
  t.after(() => db.__cleanup());

  const clientId = await insertClient(db, { province: 'ON' });
  const facture = await createFacture(db, {
    client_id: clientId, date_emission: '2026-06-01', date_echeance: '2026-06-30'
  }, LIGNES);
  await insererPaiementBrut(db, facture.id, 500, 'Virement du client');

  const annules = await annulerSurpaiements(db);

  assert.equal(annules, 0, 'son origine est ambiguë : seule l\'entreprise peut trancher');
  assert.equal((await getSoldeFacture(db, facture.id)).montant_paye, 500);
});

test('une facture entièrement créditée n\'est pas signalée comme anormale', async (t) => {
  const db = await createTestDb();
  t.after(() => db.__cleanup());

  const clientId = await insertClient(db, { province: 'ON' });
  const facture = await createFacture(db, {
    client_id: clientId, date_emission: '2026-06-01', date_echeance: '2026-06-30'
  }, LIGNES);
  await createNoteCredit(db, facture.id, { date_emission: '2026-06-10' },
    [{ description: 'Annulation', quantite: 1, prix_unitaire: 100 }]);

  const apres = await getSoldeFacture(db, facture.id);
  assert.equal(apres.statut, STATUTS.CREDITEE);

  // Le diagnostic appelait resolveStatut sans les montants de crédit : le solde
  // étant nul, il concluait « Payée » et « --corriger-statuts » écrasait le
  // statut, laissant croire à un encaissement qui n'a jamais eu lieu.
  const statuts = (await diagnostiquer(db)).filter((a) => /Statut/.test(a.probleme));
  assert.deepEqual(statuts, [], 'aucune fausse anomalie de statut');

  assert.equal(await corrigerStatuts(db), 0);
  assert.equal((await getSoldeFacture(db, facture.id)).statut, STATUTS.CREDITEE,
    'le statut « Créditée » survit à la correction');
});
