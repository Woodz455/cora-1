/**
 * Facturation récurrente : rattrapage des périodes échues et calcul des cycles.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createSubscription, updateSubscription, checkAndGenerateRecurringInvoices, addCycle
} = require('../subscriptionService.js');
const { createTestDb, insertClient } = require('./helpers.js');

const LIGNES = [{ description: 'Hébergement', quantite: 1, prix_unitaire: 100 }];

/** Décale une date de N jours par rapport à aujourd'hui. */
function ilYA(jours) {
  const d = new Date();
  d.setDate(d.getDate() - jours);
  return d.toISOString().split('T')[0];
}

async function prepare(t) {
  const db = await createTestDb();
  t.after(() => db.__cleanup());
  const clientId = await insertClient(db);
  return { db, clientId };
}

test('addCycle borne le jour du mois', () => {
  // `setMonth` seul déborderait : 31 janvier + 1 mois donnerait le 3 mars.
  assert.equal(addCycle('2026-01-31', 'Mensuel'), '2026-02-28');
  assert.equal(addCycle('2028-01-31', 'Mensuel'), '2028-02-29');
  assert.equal(addCycle('2026-03-31', 'Mensuel'), '2026-04-30');
  assert.equal(addCycle('2026-01-15', 'Mensuel'), '2026-02-15');
  assert.equal(addCycle('2026-12-15', 'Mensuel'), '2027-01-15');
  assert.equal(addCycle('2026-07-01', 'Annuel'), '2027-07-01');
  assert.equal(addCycle('2028-02-29', 'Annuel'), '2029-02-28');
});

test('chaque période échue donne sa propre facture', async (t) => {
  const { db, clientId } = await prepare(t);

  // Abonnement mensuel en retard de trois périodes.
  await createSubscription(db, {
    client_id: clientId,
    titre: 'Abonnement mensuel',
    lignes_json: JSON.stringify(LIGNES),
    cycle: 'Mensuel',
    date_prochaine_generation: ilYA(95)
  });

  const { generees, erreurs } = await checkAndGenerateRecurringInvoices(db);

  // L'ancienne implémentation n'émettait qu'une facture puis repoussait la date
  // au prochain cycle : les périodes manquées étaient définitivement perdues.
  assert.equal(erreurs, 0);
  assert.ok(generees >= 3, `au moins 3 factures attendues, ${generees} générée(s)`);

  const factures = await db.all('SELECT numero_facture, date_emission, date_echeance FROM factures ORDER BY date_emission');
  assert.equal(factures.length, generees);

  // Toutes les échéances sont fixées à 30 jours de l'émission.
  for (const f of factures) {
    const jours = (new Date(f.date_echeance) - new Date(f.date_emission)) / 86400000;
    assert.equal(jours, 30);
  }
});

test('la prochaine échéance est reportée dans le futur', async (t) => {
  const { db, clientId } = await prepare(t);
  await createSubscription(db, {
    client_id: clientId,
    titre: 'Abonnement',
    lignes_json: JSON.stringify(LIGNES),
    cycle: 'Mensuel',
    date_prochaine_generation: ilYA(40)
  });

  await checkAndGenerateRecurringInvoices(db);

  const sub = await db.get('SELECT date_prochaine_generation FROM abonnements');
  const aujourdhui = new Date().toISOString().split('T')[0];
  assert.ok(sub.date_prochaine_generation > aujourdhui,
    `${sub.date_prochaine_generation} devrait être postérieure à ${aujourdhui}`);
});

test('un second passage ne duplique aucune facture', async (t) => {
  const { db, clientId } = await prepare(t);
  await createSubscription(db, {
    client_id: clientId,
    titre: 'Abonnement',
    lignes_json: JSON.stringify(LIGNES),
    cycle: 'Mensuel',
    date_prochaine_generation: ilYA(10)
  });

  const premier = await checkAndGenerateRecurringInvoices(db);
  const second = await checkAndGenerateRecurringInvoices(db);

  // L'opération est idempotente : le planificateur peut repasser sans risque.
  assert.equal(premier.generees, 1);
  assert.equal(second.generees, 0);
  const { count } = await db.get('SELECT COUNT(*) AS count FROM factures');
  assert.equal(count, 1);
});

test('un abonnement inactif ne génère rien', async (t) => {
  const { db, clientId } = await prepare(t);
  const sub = await createSubscription(db, {
    client_id: clientId,
    titre: 'Abonnement',
    lignes_json: JSON.stringify(LIGNES),
    cycle: 'Mensuel',
    date_prochaine_generation: ilYA(10)
  });
  await updateSubscription(db, sub.id, { statut: 'Inactif' });

  const { generees } = await checkAndGenerateRecurringInvoices(db);
  assert.equal(generees, 0);
});

test('la mise à jour partielle préserve les lignes', async (t) => {
  const { db, clientId } = await prepare(t);
  const sub = await createSubscription(db, {
    client_id: clientId,
    titre: 'Abonnement',
    lignes_json: JSON.stringify(LIGNES),
    cycle: 'Mensuel',
    date_prochaine_generation: ilYA(1)
  });

  // Le simple basculement de statut envoyé par l'interface ne doit pas
  // écraser les lignes ni le cycle.
  const apres = await updateSubscription(db, sub.id, { statut: 'Inactif' });
  assert.equal(apres.cycle, 'Mensuel');
  assert.deepEqual(JSON.parse(apres.lignes_json), LIGNES);
});

test('des lignes invalides sont refusées à la création', async (t) => {
  const { db, clientId } = await prepare(t);

  await assert.rejects(() => createSubscription(db, {
    client_id: clientId, titre: 'X', lignes_json: '[]', cycle: 'Mensuel',
    date_prochaine_generation: '2026-07-01'
  }), /Au moins une ligne/);

  await assert.rejects(() => createSubscription(db, {
    client_id: clientId, titre: 'X', lignes_json: 'pas du json', cycle: 'Mensuel',
    date_prochaine_generation: '2026-07-01'
  }), /illisibles/);

  await assert.rejects(() => createSubscription(db, {
    client_id: 9999, titre: 'X', lignes_json: JSON.stringify(LIGNES), cycle: 'Mensuel',
    date_prochaine_generation: '2026-07-01'
  }), /Client introuvable/);
});

test('le rattrapage est borné pour un abonnement très ancien', async (t) => {
  const { db, clientId } = await prepare(t);
  await createSubscription(db, {
    client_id: clientId,
    titre: 'Abonnement ancien',
    lignes_json: JSON.stringify(LIGNES),
    cycle: 'Mensuel',
    date_prochaine_generation: '2015-01-01'
  });

  const { generees } = await checkAndGenerateRecurringInvoices(db);

  // Une date de départ lointaine saisie par erreur ne doit pas produire des
  // centaines de factures d'un seul coup.
  assert.equal(generees, 24);
});
