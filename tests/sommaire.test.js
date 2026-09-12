/**
 * Compte rendu de gestion d'une période.
 *
 * Ce document part chez un comptable ou un banquier : ces tests vérifient
 * d'abord que chaque famille de chiffres est bornée sur sa propre date, car
 * c'est là qu'un sommaire ment le plus facilement. Une facture émise en mars
 * et payée en avril appartient au facturé de mars et à l'encaissé d'avril.
 */

const test = require('node:test');
const assert = require('node:assert');

const { createTestDb, insertClient, insertSettings, startTestServer, MOT_DE_PASSE } = require('./helpers.js');
const { reset: resetRateLimit } = require('../rateLimit.js');
const {
  getSommaire, bornesPeriode, createFacture, addPaiement, cancelFacture, annulerPaiement
} = require('../invoiceService.js');
const { createNoteCredit } = require('../noteCreditService.js');
const { createExpense } = require('../expenseService.js');
const { definirTaux } = require('../kilometrageService.js');

/** Jour de référence pour la balance âgée : fin de l'exercice testé. */
const AUJOURDHUI = '2026-12-31';

async function prepare(t) {
  const db = await createTestDb();
  t.after(() => db.__cleanup());
  await insertSettings(db, { entreprise_nom: 'Ateliers Test' });
  return db;
}

/**
 * Facture d'un montant rond, sur un client hors province : les taux de taxe
 * sont nuls et les chiffres du sommaire se vérifient de tête.
 */
async function facture(db, clientId, dateEmission, prix, options = {}) {
  return createFacture(db, {
    client_id: clientId,
    date_emission: dateEmission,
    date_echeance: options.date_echeance || dateEmission,
    devise: options.devise || 'CAD',
    taux_change: options.taux_change || 1.0
  }, [{ description: 'Prestation', quantite: 1, prix_unitaire: prix }]);
}

async function depense(db, date, montantHt, categorie = 'Fournitures', taxes = {}) {
  return createExpense(db, {
    fournisseur: 'Fournisseur', description: 'Achat', date_depense: date,
    montant_ht: montantHt, tps: taxes.tps || 0, tvq: taxes.tvq || 0, categorie
  });
}

/* --- Les bornes --- */

test('les bornes d\'une période tombent au bon jour', () => {
  assert.deepEqual(bornesPeriode({ annee: '2026' }), {
    debut: '2026-01-01', fin: '2026-12-31',
    mois: ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
      '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12']
  });
  assert.deepEqual(bornesPeriode({ annee: '2026', trimestre: '2' }), {
    debut: '2026-04-01', fin: '2026-06-30', mois: ['2026-04', '2026-05', '2026-06']
  });
  // Février d'une année bissextile : le piège classique du dernier jour.
  assert.deepEqual(bornesPeriode({ annee: '2028', mois: '02' }), {
    debut: '2028-02-01', fin: '2028-02-29', mois: ['2028-02']
  });
  assert.equal(bornesPeriode({ annee: '2026', mois: '9' }).fin, '2026-09-30');
});

/* --- Chaque chiffre sur sa propre date --- */

test('le facturé suit l\'émission et l\'encaissé suit le paiement', async (t) => {
  const db = await prepare(t);
  const clientId = await insertClient(db, { province: '' });

  // Émise en mars, payée en avril : elle change de mois entre les deux séries.
  const f = await facture(db, clientId, '2026-03-20', 1000);
  await addPaiement(db, f.id, 1000, 'Virement', '2026-04-05');

  const mars = await getSommaire(db, { annee: '2026', mois: '03' }, AUJOURDHUI);
  assert.equal(mars.facturation.total_facture, 1000);
  assert.equal(mars.facturation.nb_factures, 1);
  assert.equal(mars.encaissements.total_encaisse, 0, 'rien n\'est rentré en mars');
  assert.equal(mars.encaissements.nb_paiements, 0);

  const avril = await getSommaire(db, { annee: '2026', mois: '04' }, AUJOURDHUI);
  assert.equal(avril.facturation.total_facture, 0, 'rien n\'a été émis en avril');
  assert.equal(avril.encaissements.total_encaisse, 1000);
  assert.equal(avril.encaissements.delai_moyen_jours, 16, 'du 20 mars au 5 avril');

  // Sur l'année, les deux se retrouvent, et l'évolution mensuelle les place
  // chacun dans son mois.
  const annee = await getSommaire(db, { annee: '2026' }, AUJOURDHUI);
  assert.equal(annee.facturation.total_facture, 1000);
  assert.equal(annee.encaissements.total_encaisse, 1000);
  assert.equal(annee.par_mois.length, 12);
  assert.deepEqual(annee.par_mois[2], { mois: '2026-03', facture: 1000, encaisse: 0, depenses_ht: 0 });
  assert.deepEqual(annee.par_mois[3], { mois: '2026-04', facture: 0, encaisse: 1000, depenses_ht: 0 });
});

test('les dépenses suivent leur propre date et se ventilent par catégorie', async (t) => {
  const db = await prepare(t);

  await depense(db, '2026-05-10', 300, 'Fournitures', { tps: 15, tvq: 29.93 });
  await depense(db, '2026-05-25', 200, 'Logiciels');
  await depense(db, '2026-05-28', 100, 'Fournitures');
  await depense(db, '2026-06-02', 999, 'Fournitures'); // hors période

  const mai = await getSommaire(db, { annee: '2026', mois: '05' }, AUJOURDHUI);

  assert.equal(mai.depenses.nb_depenses, 3);
  assert.equal(mai.depenses.total_ht, 600);
  assert.equal(mai.depenses.taxes_recuperables, 44.93);
  assert.equal(mai.depenses.total_ttc, 644.93);
  assert.deepEqual(mai.depenses.par_categorie, [
    { categorie: 'Fournitures', nombre: 2, montant_ht: 400 },
    { categorie: 'Logiciels', nombre: 1, montant_ht: 200 }
  ]);
});

test('un trimestre couvre exactement ses trois mois', async (t) => {
  const db = await prepare(t);
  const clientId = await insertClient(db, { province: '' });

  await facture(db, clientId, '2026-06-30', 100); // dernier jour du T2
  await facture(db, clientId, '2026-07-01', 200); // premier jour du T3
  await facture(db, clientId, '2026-09-30', 400); // dernier jour du T3
  await facture(db, clientId, '2026-10-01', 800); // premier jour du T4

  const t3 = await getSommaire(db, { annee: '2026', trimestre: '3' }, AUJOURDHUI);

  assert.equal(t3.facturation.total_facture, 600);
  assert.equal(t3.periode.debut, '2026-07-01');
  assert.equal(t3.periode.fin, '2026-09-30');
  assert.deepEqual(t3.par_mois.map((m) => m.facture), [200, 0, 400]);
});

/* --- Le résultat --- */

test('le bénéfice net est l\'encaissé moins les dépenses hors taxes, et la marge en découle', async (t) => {
  const db = await prepare(t);
  const clientId = await insertClient(db, { province: '' });

  const f = await facture(db, clientId, '2026-02-01', 5000);
  await addPaiement(db, f.id, 4000, 'Acompte', '2026-02-15');
  // Les taxes payées sur l'achat sont récupérables : elles ne pèsent pas sur
  // le résultat, comme sur l'écran Rapports.
  await depense(db, '2026-02-20', 1000, 'Sous-traitance', { tps: 50, tvq: 99.75 });

  const fevrier = await getSommaire(db, { annee: '2026', mois: '02' }, AUJOURDHUI);

  assert.equal(fevrier.resultat.benefice_net, 3000);
  assert.equal(fevrier.resultat.marge, 75);
});

test('sans encaissement, la marge est absente plutôt que nulle', async (t) => {
  const db = await prepare(t);
  await depense(db, '2026-02-20', 1000);

  const fevrier = await getSommaire(db, { annee: '2026', mois: '02' }, AUJOURDHUI);

  assert.equal(fevrier.resultat.benefice_net, -1000);
  assert.equal(fevrier.resultat.marge, null);
  assert.equal(fevrier.encaissements.delai_moyen_jours, null);
});

/* --- Ce qui est exclu --- */

test('factures annulées, paiements annulés et notes de crédit sont traités comme partout ailleurs', async (t) => {
  const db = await prepare(t);
  const clientId = await insertClient(db, { province: '' });

  const gardee = await facture(db, clientId, '2026-03-01', 1000);
  const annulee = await facture(db, clientId, '2026-03-02', 9000);
  await cancelFacture(db, annulee.id);

  await addPaiement(db, gardee.id, 300, 'Erreur de saisie', '2026-03-10');
  const errone = await db.get('SELECT id FROM paiements WHERE facture_id = ? ORDER BY id DESC LIMIT 1', [gardee.id]);
  await annulerPaiement(db, errone.id, { motif: 'Doublon', utilisateur: 'patron' });
  await addPaiement(db, gardee.id, 400, 'Virement', '2026-03-12');

  await createNoteCredit(db, gardee.id, { date_emission: '2026-03-15', motif: 'Remise' },
    [{ description: 'Remise', quantite: 1, prix_unitaire: 250 }]);

  const mars = await getSommaire(db, { annee: '2026', mois: '03' }, AUJOURDHUI);

  assert.equal(mars.facturation.nb_factures, 1, 'la facture annulée ne compte pas');
  assert.equal(mars.facturation.total_facture, 1000);
  assert.equal(mars.facturation.total_credite, 250);
  assert.equal(mars.facturation.facture_net, 750);
  assert.equal(mars.encaissements.total_encaisse, 400, 'le paiement annulé ne compte pas');
  assert.equal(mars.par_mois[0].facture, 750, 'l\'évolution mensuelle est nette des crédits');
});

test('une note de crédit compte sur sa propre date d\'émission', async (t) => {
  const db = await prepare(t);
  const clientId = await insertClient(db, { province: '' });

  const f = await facture(db, clientId, '2026-03-01', 1000);
  await createNoteCredit(db, f.id, { date_emission: '2026-04-10', motif: 'Litige' },
    [{ description: 'Remise', quantite: 1, prix_unitaire: 300 }]);

  const mars = await getSommaire(db, { annee: '2026', mois: '03' }, AUJOURDHUI);
  const avril = await getSommaire(db, { annee: '2026', mois: '04' }, AUJOURDHUI);

  // Le mois de mars est clos tel qu'il a été facturé ; le crédit vient grever
  // avril, mois où il a été consenti. C'est la convention du rapport de taxes.
  assert.equal(mars.facturation.facture_net, 1000);
  assert.equal(avril.facturation.facture_net, -300);
});

/* --- Les devises --- */

test('tout est ramené en dollars canadiens au taux figé sur la facture', async (t) => {
  const db = await prepare(t);
  const clientId = await insertClient(db, { province: '' });

  const f = await facture(db, clientId, '2026-05-01', 100, { devise: 'USD', taux_change: 1.35 });
  await addPaiement(db, f.id, 100, 'Virement', '2026-05-20');

  const mai = await getSommaire(db, { annee: '2026', mois: '05' }, AUJOURDHUI);

  assert.equal(mai.facturation.total_facture, 135);
  assert.equal(mai.encaissements.total_encaisse, 135);
  assert.equal(mai.clients.principaux[0].facture, 135);
});

/* --- Les clients --- */

test('les principaux clients sont classés sur le facturé net de la période', async (t) => {
  const db = await prepare(t);
  const gros = await insertClient(db, { nom: 'Gros', province: '', email: 'g@x.ca' });
  const moyen = await insertClient(db, { nom: 'Moyen', province: '', email: 'm@x.ca' });
  const credite = await insertClient(db, { nom: 'Crédité', province: '', email: 'c@x.ca' });

  await facture(db, gros, '2026-01-10', 6000);
  await facture(db, moyen, '2026-01-11', 3000);
  await facture(db, moyen, '2026-01-12', 1000);
  // Facturé 5000, mais crédité 4500 : ce client ne pèse que 500 en réalité.
  const reprise = await facture(db, credite, '2026-01-13', 5000);
  await createNoteCredit(db, reprise.id, { date_emission: '2026-01-20', motif: 'Reprise' },
    [{ description: 'Reprise', quantite: 1, prix_unitaire: 4500 }]);
  // Hors période : n'entre pas dans le classement de janvier.
  await facture(db, credite, '2026-02-01', 20000);

  const janvier = await getSommaire(db, { annee: '2026', mois: '01' }, AUJOURDHUI);

  assert.deepEqual(
    janvier.clients.principaux.map((c) => [c.client, c.facture, c.nb_factures]),
    [['Gros', 6000, 1], ['Moyen', 4000, 2], ['Crédité', 500, 1]]
  );
  assert.equal(janvier.facturation.nb_clients, 3);
  // 6000 sur un facturé net de 10 500.
  assert.equal(janvier.clients.part_premier_client, 57.1);
});

test('sans facture, il n\'y a ni principal client ni part à calculer', async (t) => {
  const db = await prepare(t);

  const vide = await getSommaire(db, { annee: '2026', mois: '01' }, AUJOURDHUI);

  assert.deepEqual(vide.clients.principaux, []);
  assert.equal(vide.clients.part_premier_client, null);
  assert.equal(vide.facturation.nb_factures, 0);
  assert.equal(vide.par_mois.length, 1);
});

/* --- Les créances : un état au jour du rapport, pas une période --- */

test('les créances sont celles du jour du rapport, quelle que soit la période', async (t) => {
  const db = await prepare(t);
  const clientId = await insertClient(db, { province: '' });

  // Émise en 2025, toujours impayée : elle n'appartient à aucun mois de 2026
  // et figure pourtant dans ce qui est dû aujourd'hui.
  await facture(db, clientId, '2025-11-01', 700, { date_echeance: '2025-12-01' });
  // Émise sur la période, pas encore échue.
  await facture(db, clientId, '2026-12-20', 300, { date_echeance: '2027-01-19' });

  const decembre = await getSommaire(db, { annee: '2026', mois: '12' }, AUJOURDHUI);

  assert.equal(decembre.facturation.total_facture, 300);
  assert.equal(decembre.creances.balance.totaux.total, 1000);
  assert.equal(decembre.creances.balance.totaux.non_echu, 300);
  assert.equal(decembre.creances.en_retard, 700);
  assert.equal(decembre.creances.nb_factures_en_retard, 1);
  assert.equal(decembre.creances.balance.totaux.jours_91_plus, 700);
});

/* --- Le kilométrage et les taxes --- */

test('le kilométrage de la période et le rapport de taxes sont repris', async (t) => {
  const db = await prepare(t);
  const clientId = await insertClient(db, { province: 'QC' });

  await definirTaux(db, { annee: 2026, taux_1: 0.70, taux_2: 0.64, seuil_km: 5000 });
  await createExpense(db, {
    fournisseur: 'Tournage', description: 'Plateau', date_depense: '2026-06-10',
    kilometres: 100, vehicule: 'Honda Civic', categorie: 'Déplacements'
  });
  // 1000 $ au Québec : 50 $ de TPS et 99,75 $ de TVQ facturées.
  await facture(db, clientId, '2026-06-15', 1000);

  const juin = await getSommaire(db, { annee: '2026', mois: '06' }, AUJOURDHUI);

  assert.equal(juin.depenses.kilometres, 100);
  assert.equal(juin.depenses.indemnite_kilometrique, 70);
  assert.equal(juin.taxes.taxes_facturees, 149.75);
  assert.equal(juin.taxes.taxes_payees, 0, 'une indemnité kilométrique n\'ouvre aucune taxe récupérable');
  assert.equal(juin.taxes.taxes_nettes, 149.75);
  assert.deepEqual(juin.taxes.parRegime.map((r) => r.nom), ['TPS', 'TVQ']);
});

/* --- L'en-tête --- */

test('le document porte l\'identité de l\'entreprise et sa période', async (t) => {
  const db = await prepare(t);

  const s = await getSommaire(db, { annee: '2026', trimestre: '1' }, AUJOURDHUI);

  assert.equal(s.entreprise.entreprise_nom, 'Ateliers Test');
  assert.equal(s.date_reference, AUJOURDHUI);
  assert.deepEqual(s.periode, {
    annee: '2026', mois: null, trimestre: '1', debut: '2026-01-01', fin: '2026-03-31'
  });
  // Rien de secret ne doit sortir avec l'en-tête.
  for (const cle of Object.keys(s.entreprise)) {
    assert.ok(!/smtp|stripe|password|cle/.test(cle), `${cle} n'a rien à faire dans un document`);
  }
});

test('sans année, le sommaire est refusé', async (t) => {
  const db = await prepare(t);
  await assert.rejects(() => getSommaire(db, {}, AUJOURDHUI), (err) => err.status === 400);
});

/* --- L'API --- */

test('la route est réservée à l\'administration et à la comptabilité, et exige l\'année', async (t) => {
  resetRateLimit();
  const api = await startTestServer();
  t.after(() => api.close());
  await api.post('/api/auth/setup', { username: 'patron', password: MOT_DE_PASSE });

  // Les deux comptes sont créés par l'administrateur, seul habilité à le faire.
  await api.post('/api/users', { username: 'employe1', password: MOT_DE_PASSE, role: 'employe' });
  await api.post('/api/users', { username: 'compta', password: MOT_DE_PASSE, role: 'comptable' });

  await api.post('/api/auth/login', { username: 'employe1', password: MOT_DE_PASSE });
  assert.equal((await api.get('/api/rapports/sommaire?annee=2026')).status, 403);

  await api.post('/api/auth/login', { username: 'compta', password: MOT_DE_PASSE });

  const sansAnnee = await api.get('/api/rapports/sommaire');
  assert.equal(sansAnnee.status, 400);
  assert.match(sansAnnee.data.error, /année/);

  const contradictoire = await api.get('/api/rapports/sommaire?annee=2026&mois=3&trimestre=1');
  assert.equal(contradictoire.status, 400);

  const res = await api.get('/api/rapports/sommaire?annee=2026&mois=9');
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.periode.debut, '2026-09-01');
  assert.equal(res.data.periode.fin, '2026-09-30');
  assert.equal(res.data.facturation.nb_factures, 0);
  assert.ok(Array.isArray(res.data.par_mois));
});
