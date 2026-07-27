/**
 * Relances automatiques : sélection des factures dues, paliers, journalisation
 * et arrêt au paiement.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  envoyerRelancesDues, getRelancesDues, getRelances,
  parsePaliers, joursDeRetard, composerRappel
} = require('../relanceService.js');
const { createFacture, addPaiement } = require('../invoiceService.js');
const { createNoteCredit } = require('../noteCreditService.js');
const { createTestDb, insertClient } = require('./helpers.js');

const LIGNES = [{ description: 'Service', quantite: 1, prix_unitaire: 1000 }];
const AUJOURDHUI = new Date('2026-08-15T12:00:00Z');

/** Collecte les courriels au lieu de les envoyer. */
function collecteur() {
  const envoyes = [];
  const envoyer = async (message) => { envoyes.push(message); };
  return { envoyes, envoyer };
}

/** Base avec relances actives et une facture échue depuis `retard` jours. */
async function preparer(t, { retard = 20, paliers = '7,15,30', actives = 1, langue = 'fr' } = {}) {
  const db = await createTestDb();
  t.after(() => db.__cleanup());

  await db.run(
    'UPDATE settings SET entreprise_nom = ?, relances_actives = ?, relances_paliers = ?',
    ['Ma PME', actives, paliers]
  );

  const clientId = await insertClient(db, { langue, email: 'client@exemple.ca' });
  const echeance = new Date(AUJOURDHUI);
  echeance.setUTCDate(echeance.getUTCDate() - retard);

  const facture = await createFacture(db, {
    client_id: clientId,
    date_emission: '2026-07-01',
    date_echeance: echeance.toISOString().split('T')[0]
  }, LIGNES);

  return { db, clientId, facture };
}

test('parsePaliers accepte plusieurs séparateurs et écarte les valeurs aberrantes', () => {
  assert.deepEqual(parsePaliers('7,15,30'), [7, 15, 30]);
  assert.deepEqual(parsePaliers('30 ; 7 ; 15'), [7, 15, 30]);
  assert.deepEqual(parsePaliers('7, 7, 15'), [7, 15], 'les doublons sont retirés');
  assert.deepEqual(parsePaliers('0, -5, abc, 400, 10'), [10]);
  assert.deepEqual(parsePaliers(''), [7, 15, 30], 'valeurs par défaut si vide');
  assert.deepEqual(parsePaliers(null), [7, 15, 30]);
});

test('joursDeRetard compte les jours depuis l\'échéance', () => {
  assert.equal(joursDeRetard('2026-08-01', AUJOURDHUI), 14);
  assert.equal(joursDeRetard('2026-08-15', AUJOURDHUI), 0);
  assert.equal(joursDeRetard('2026-08-20', AUJOURDHUI), -5, 'négatif avant échéance');
});

test('une facture échue déclenche le palier franchi', async (t) => {
  const { db } = await preparer(t, { retard: 20 });
  const { envoyes, envoyer } = collecteur();

  const resultat = await envoyerRelancesDues(db, { aujourdhui: AUJOURDHUI, envoyer });

  assert.equal(resultat.envoyees, 1);
  assert.equal(resultat.erreurs, 0);
  assert.equal(envoyes.length, 1);
  assert.equal(envoyes[0].to, 'client@exemple.ca');
  assert.match(envoyes[0].subject, /Rappel de paiement/);
  assert.match(envoyes[0].text, /1149\.75 \$/);
});

test('le palier le plus élevé franchi est retenu, pas tous à la fois', async (t) => {
  // 40 jours de retard : les paliers 7, 15 et 30 sont tous dépassés.
  const { db, facture } = await preparer(t, { retard: 40 });
  const { envoyes, envoyer } = collecteur();

  await envoyerRelancesDues(db, { aujourdhui: AUJOURDHUI, envoyer });

  assert.equal(envoyes.length, 1, 'un seul rappel, pas trois');
  const journal = await getRelances(db, facture.id);
  assert.equal(journal.length, 1);
  assert.equal(journal[0].palier_jours, 30);
});

test('un même palier n\'est jamais envoyé deux fois', async (t) => {
  const { db } = await preparer(t, { retard: 20 });
  const { envoyes, envoyer } = collecteur();

  await envoyerRelancesDues(db, { aujourdhui: AUJOURDHUI, envoyer });
  const second = await envoyerRelancesDues(db, { aujourdhui: AUJOURDHUI, envoyer });

  assert.equal(second.envoyees, 0);
  assert.equal(envoyes.length, 1);
});

test('le palier suivant part quand le retard s\'aggrave', async (t) => {
  const { db, facture } = await preparer(t, { retard: 20 });
  const { envoyes, envoyer } = collecteur();

  await envoyerRelancesDues(db, { aujourdhui: AUJOURDHUI, envoyer });

  const plusTard = new Date(AUJOURDHUI);
  plusTard.setUTCDate(plusTard.getUTCDate() + 15); // 35 jours de retard
  await envoyerRelancesDues(db, { aujourdhui: plusTard, envoyer });

  assert.equal(envoyes.length, 2);
  const journal = await getRelances(db, facture.id);
  assert.deepEqual(journal.map((r) => r.palier_jours).sort((a, b) => a - b), [15, 30]);
});

test('une facture payée ne reçoit plus de relance', async (t) => {
  const { db, facture } = await preparer(t, { retard: 20 });
  await addPaiement(db, facture.id, 1149.75, '', '2026-08-01');

  const { envoyes, envoyer } = collecteur();
  const resultat = await envoyerRelancesDues(db, { aujourdhui: AUJOURDHUI, envoyer });

  assert.equal(resultat.envoyees, 0);
  assert.equal(envoyes.length, 0);
});

test('une facture entièrement créditée ne reçoit plus de relance', async (t) => {
  const { db, facture } = await preparer(t, { retard: 20 });
  await createNoteCredit(db, facture.id, { date_emission: '2026-08-10' },
    [{ description: 'Annulation', quantite: 1, prix_unitaire: 1000 }]);

  const { envoyes, envoyer } = collecteur();
  await envoyerRelancesDues(db, { aujourdhui: AUJOURDHUI, envoyer });

  assert.equal(envoyes.length, 0);
});

test('le rappel porte le solde net des crédits', async (t) => {
  const { db, facture } = await preparer(t, { retard: 20 });
  await createNoteCredit(db, facture.id, { date_emission: '2026-08-10' },
    [{ description: 'Remise', quantite: 1, prix_unitaire: 200 }]);

  const { envoyes, envoyer } = collecteur();
  await envoyerRelancesDues(db, { aujourdhui: AUJOURDHUI, envoyer });

  assert.equal(envoyes.length, 1);
  assert.match(envoyes[0].text, /919\.80 \$/);
});

test('une facture non échue n\'est jamais relancée', async (t) => {
  const { db } = await preparer(t, { retard: -10 });
  const { envoyes, envoyer } = collecteur();

  await envoyerRelancesDues(db, { aujourdhui: AUJOURDHUI, envoyer });
  assert.equal(envoyes.length, 0);
});

test('le retard doit atteindre le premier palier', async (t) => {
  const { db } = await preparer(t, { retard: 3, paliers: '7,15,30' });
  const { envoyes, envoyer } = collecteur();

  await envoyerRelancesDues(db, { aujourdhui: AUJOURDHUI, envoyer });
  assert.equal(envoyes.length, 0, '3 jours de retard, premier palier à 7');
});

test('aucun envoi lorsque les relances sont désactivées', async (t) => {
  const { db } = await preparer(t, { retard: 20, actives: 0 });
  const { envoyes, envoyer } = collecteur();

  const resultat = await envoyerRelancesDues(db, { aujourdhui: AUJOURDHUI, envoyer });
  assert.equal(resultat.inactif, true);
  assert.equal(envoyes.length, 0);
});

test('un client sans adresse courriel est ignoré', async (t) => {
  const { db, clientId } = await preparer(t, { retard: 20 });
  await db.run('UPDATE clients SET email = ? WHERE id = ?', ['', clientId]);

  const { envoyes, envoyer } = collecteur();
  await envoyerRelancesDues(db, { aujourdhui: AUJOURDHUI, envoyer });
  assert.equal(envoyes.length, 0);
});

test('un échec d\'envoi est journalisé sans interrompre les suivants', async (t) => {
  const { db, clientId, facture } = await preparer(t, { retard: 20 });

  // Deuxième facture échue, pour vérifier que la première n'a pas tout arrêté.
  const echeance = new Date(AUJOURDHUI);
  echeance.setUTCDate(echeance.getUTCDate() - 20);
  const seconde = await createFacture(db, {
    client_id: clientId, date_emission: '2026-07-01', date_echeance: echeance.toISOString().split('T')[0]
  }, LIGNES);

  let premier = true;
  const envoyer = async () => {
    if (premier) { premier = false; throw new Error('Serveur SMTP injoignable'); }
  };

  const resultat = await envoyerRelancesDues(db, { aujourdhui: AUJOURDHUI, envoyer });

  assert.equal(resultat.erreurs, 1);
  assert.equal(resultat.envoyees, 1);

  const journaux = [...await getRelances(db, facture.id), ...await getRelances(db, seconde.id)];
  const echec = journaux.find((r) => r.statut === 'Échec');
  assert.ok(echec, 'l\'échec est consigné');
  assert.match(echec.erreur, /injoignable/);

  // L'échec ne bloque pas définitivement : le palier reste à envoyer.
  const dues = await getRelancesDues(db, [7, 15, 30], AUJOURDHUI);
  assert.equal(dues.length, 1);
});

test('le compteur de la facture est alimenté', async (t) => {
  const { db, facture } = await preparer(t, { retard: 20 });
  const { envoyer } = collecteur();

  await envoyerRelancesDues(db, { aujourdhui: AUJOURDHUI, envoyer });

  const ligne = await db.get('SELECT relances_envoyees, date_derniere_relance FROM factures WHERE id = ?', [facture.id]);
  assert.equal(ligne.relances_envoyees, 1);
  assert.equal(ligne.date_derniere_relance, '2026-08-15');
});

test('le rappel suit la langue du client', async (t) => {
  const { db } = await preparer(t, { retard: 20, langue: 'en' });
  const { envoyes, envoyer } = collecteur();

  await envoyerRelancesDues(db, { aujourdhui: AUJOURDHUI, envoyer });

  assert.match(envoyes[0].subject, /Payment reminder/);
  assert.match(envoyes[0].text, /Outstanding balance/);
  assert.match(envoyes[0].text, /1149\.75 \$/, 'même écriture des montants que dans l\'application');
});

test('le rappel reprend la raison sociale des paramètres', () => {
  const facture = {
    numero_facture: 'SHT-202607-0001', date_emission: '2026-07-01', date_echeance: '2026-07-31',
    solde_restant: 1149.75, devise: 'CAD', langue: 'fr', nom_contact: 'Alice', nom_entreprise: 'Client'
  };

  const { sujet, corps } = composerRappel(facture, { entreprise_nom: 'Boulangerie Lafleur' }, 15);
  assert.match(sujet, /SHT-202607-0001/);
  assert.match(corps, /Bonjour Alice/);
  assert.match(corps, /Boulangerie Lafleur/);
  assert.match(corps, /il y a 15 jours\./, 'pluriel accordé');

  const unJour = composerRappel({ ...facture, solde_restant: 1 }, {}, 1);
  assert.match(unJour.corps, /il y a 1 jour\./, 'singulier accordé');
});
