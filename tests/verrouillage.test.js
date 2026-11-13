/**
 * La date de verrouillage : une fois la déclaration produite, la période close
 * ne bouge plus.
 *
 * Rien n'empêchait de modifier une facture, de supprimer une dépense ou
 * d'annuler un encaissement d'un trimestre déjà déclaré. La déclaration remise
 * à l'État cessait alors de correspondre aux livres, sans que rien ne le dise.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer, insertClient, MOT_DE_PASSE } = require('./helpers.js');
const { reset: resetRateLimit } = require('../rateLimit.js');
const { aujourdhui } = require('../dates.js');
const { checkAndGenerateRecurringInvoices } = require('../subscriptionService.js');
const { lendemain } = require('../verrouillage.js');

/** Fin de la période close. Antérieure à toute date d'exécution des tests. */
const VERROU = '2025-12-31';
const DANS_LA_PERIODE = '2025-12-10';

async function avecAdmin(t) {
  resetRateLimit();
  const api = await startTestServer();
  t.after(() => api.close());
  const res = await api.post('/api/auth/setup', { username: 'patron', password: MOT_DE_PASSE });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return api;
}

async function facturer(api, clientId, date) {
  const res = await api.post('/api/factures', {
    client_id: clientId, date_emission: date,
    lignes: [{ description: 'Service', quantite: 1, prix_unitaire: 100 }]
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data.facture;
}

const DEPENSE = {
  fournisseur: 'Quincaillerie', description: 'Outils', date_depense: DANS_LA_PERIODE,
  montant_ht: 200, tps: 10, tvq: 19.95, montant_ttc: 229.95, categorie: 'Fournitures'
};

async function verrouiller(api, date = VERROU) {
  const res = await api.put('/api/settings/verrouillage', { date_verrouillage: date });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return res;
}

test('seul l\'administrateur pose la date, qui doit être passée, et chaque geste est consigné', async (t) => {
  const api = await avecAdmin(t);

  assert.equal((await api.put('/api/settings/verrouillage', { date_verrouillage: '2025-13-40' })).status, 400);
  const avenir = await api.put('/api/settings/verrouillage', { date_verrouillage: aujourdhui() });
  assert.equal(avenir.status, 400, 'clore aujourd\'hui empêcherait de facturer aujourd\'hui');

  const pose = await verrouiller(api);
  assert.equal(pose.data.date_verrouillage, VERROU);
  assert.equal((await api.get('/api/settings')).data.date_verrouillage, VERROU, 'l\'interface la connaît');

  // Avancer la date clôt davantage ; la reculer rouvre.
  await verrouiller(api, '2025-06-30');
  const rouverture = await api.put('/api/settings/verrouillage', { date_verrouillage: null });
  assert.equal(rouverture.status, 200);
  assert.equal(rouverture.data.date_verrouillage, null);

  const journal = await api.db.all(
    "SELECT action, details FROM logs_audit WHERE action LIKE 'periode.%' ORDER BY id"
  );
  assert.deepEqual(journal.map((l) => l.action), ['periode.verrouillage', 'periode.deverrouillage', 'periode.deverrouillage']);
  assert.deepEqual(JSON.parse(journal[1].details).changements.date_verrouillage, { avant: VERROU, apres: '2025-06-30' });

  // Un comptable ne rouvre pas une période.
  assert.equal((await api.post('/api/users', { username: 'compta', password: MOT_DE_PASSE, role: 'comptable' })).status, 201);
  assert.equal((await api.post('/api/auth/login', { username: 'compta', password: MOT_DE_PASSE })).status, 200);
  assert.equal((await api.put('/api/settings/verrouillage', { date_verrouillage: VERROU })).status, 403);
});

test('une facture d\'une période close ne se crée, ne se modifie, ne s\'annule ni ne se supprime', async (t) => {
  const api = await avecAdmin(t);
  const client = await insertClient(api.db);
  const facture = await facturer(api, client, DANS_LA_PERIODE);
  await verrouiller(api);

  const creation = await api.post('/api/factures', {
    client_id: client, date_emission: DANS_LA_PERIODE, lignes: [{ description: 'X', quantite: 1, prix_unitaire: 5 }]
  });
  assert.equal(creation.status, 409);
  assert.match(creation.data.error, /verrouillée jusqu'au 2025-12-31/);

  const modification = await api.put(`/api/factures/${facture.id}`, {
    client_id: client, lignes: [{ description: 'Service', quantite: 2, prix_unitaire: 100 }]
  });
  assert.equal(modification.status, 409);
  assert.match(modification.data.error, /note de crédit/, 'le message dit comment corriger');

  assert.equal((await api.put(`/api/factures/${facture.id}/cancel`)).status, 409);
  assert.equal((await api.del(`/api/factures/${facture.id}`)).status, 409);

  const intacte = await api.db.get('SELECT statut, montant_total FROM factures WHERE id = ?', [facture.id]);
  assert.deepEqual({ ...intacte }, { statut: 'En attente', montant_total: facture.montant_total });
  assert.equal((await api.db.get('SELECT COUNT(*) AS n FROM lignes_facture WHERE facture_id = ?', [facture.id])).n, 1);

  // En anglais, la même règle.
  const enAnglais = await api.del(`/api/factures/${facture.id}`, undefined, { headers: { 'X-Clora-Langue': 'en' } });
  assert.equal(enAnglais.data.error, 'The period is locked through 2025-12-31: to correct this invoice, issue a credit note.');
});

test('une facture close s\'encaisse et se corrige dans la période ouverte', async (t) => {
  const api = await avecAdmin(t);
  const client = await insertClient(api.db);
  const facture = await facturer(api, client, DANS_LA_PERIODE);
  await verrouiller(api);

  // Un encaissement daté de la période close changerait ses encaissements.
  const ancien = await api.post(`/api/factures/${facture.id}/paiements`, { montant: 10, date_paiement: DANS_LA_PERIODE });
  assert.equal(ancien.status, 409);

  // La note de crédit, datée de la période ouverte, est le bon geste.
  const note = await api.post('/api/notes-credit', {
    facture_id: facture.id, date_emission: aujourdhui(), motif: 'Remise',
    lignes: [{ description: 'Remise', quantite: 1, prix_unitaire: 20 }]
  });
  assert.equal(note.status, 201, JSON.stringify(note.data));
  const noteAncienne = await api.post('/api/notes-credit', {
    facture_id: facture.id, date_emission: DANS_LA_PERIODE,
    lignes: [{ description: 'Remise', quantite: 1, prix_unitaire: 1 }]
  });
  assert.equal(noteAncienne.status, 409);

  // Encaisser aujourd'hui le reste fait passer la facture à « Payée » : son
  // statut change, pas ce qu'elle déclare.
  const solde = (await api.get(`/api/factures/${facture.id}/solde`)).data.solde_restant;
  const paiement = await api.post(`/api/factures/${facture.id}/paiements`, { montant: solde, date_paiement: aujourdhui() });
  assert.equal(paiement.status, 200, JSON.stringify(paiement.data));
  assert.equal(paiement.data.facture.statut, 'Payée');

  // Relancer ou noter l'envoi ne touche pas non plus aux chiffres.
  assert.equal((await api.post(`/api/factures/${facture.id}/relance/marquer`)).status, 200);
});

test('un encaissement d\'une période close ne s\'annule plus', async (t) => {
  const api = await avecAdmin(t);
  const client = await insertClient(api.db);
  const facture = await facturer(api, client, DANS_LA_PERIODE);
  const paye = await api.post(`/api/factures/${facture.id}/paiements`, { montant: 50, date_paiement: DANS_LA_PERIODE });
  assert.equal(paye.status, 200, JSON.stringify(paye.data));
  const { id } = await api.db.get('SELECT id FROM paiements WHERE facture_id = ?', [facture.id]);

  await verrouiller(api);
  const annulation = await api.del(`/api/factures/paiements/${id}`, { motif: 'erreur' });
  assert.equal(annulation.status, 409);
  assert.equal((await api.db.get('SELECT annule_le FROM paiements WHERE id = ?', [id])).annule_le, null);
});

test('une dépense close ne se crée, ne se modifie, ne se déplace ni ne se supprime', async (t) => {
  const api = await avecAdmin(t);
  const close = (await api.post('/api/depenses', DEPENSE)).data;
  const ouverte = (await api.post('/api/depenses', { ...DEPENSE, date_depense: aujourdhui() })).data;
  await verrouiller(api);

  assert.equal((await api.post('/api/depenses', DEPENSE)).status, 409);
  assert.equal((await api.put(`/api/depenses/${close.id}`, { ...DEPENSE, montant_ht: 1 })).status, 409);
  assert.equal((await api.del(`/api/depenses/${close.id}`)).status, 409);
  // Glisser une dépense ouverte dans la période close changerait la déclaration.
  assert.equal((await api.put(`/api/depenses/${ouverte.id}`, DEPENSE)).status, 409);
  // Celle de la période ouverte reste libre.
  assert.equal((await api.put(`/api/depenses/${ouverte.id}`, { ...DEPENSE, date_depense: aujourdhui(), montant_ht: 300 })).status, 200);
});

test('rouvrir la période rend la main', async (t) => {
  const api = await avecAdmin(t);
  const close = (await api.post('/api/depenses', DEPENSE)).data;
  await verrouiller(api);
  assert.equal((await api.del(`/api/depenses/${close.id}`)).status, 409);

  await api.put('/api/settings/verrouillage', { date_verrouillage: null });
  assert.equal((await api.del(`/api/depenses/${close.id}`)).status, 200);
});

test('la base refuse elle-même, quel que soit le chemin', async (t) => {
  const api = await avecAdmin(t);
  const client = await insertClient(api.db);
  const facture = await facturer(api, client, DANS_LA_PERIODE);
  await api.post('/api/depenses', DEPENSE);
  await verrouiller(api);

  const refus = /CLORA_PERIODE_VERROUILLEE/;
  await assert.rejects(() => api.db.run('UPDATE factures SET montant_total = 1 WHERE id = ?', [facture.id]), refus);
  await assert.rejects(() => api.db.run("UPDATE factures SET statut = 'Annulée' WHERE id = ?", [facture.id]), refus);
  await assert.rejects(() => api.db.run('DELETE FROM lignes_facture WHERE facture_id = ?', [facture.id]), refus);
  await assert.rejects(() => api.db.run('UPDATE depenses SET montant_ht = 1'), refus);
  await assert.rejects(() => api.db.run('DELETE FROM depenses'), refus);

  // Ce qui ne change pas la déclaration passe.
  await api.db.run("UPDATE factures SET statut = 'Payée', envoyee_le = '2026-01-02' WHERE id = ?", [facture.id]);
  // Réécrire une valeur identique non plus : un recalcul qui retombe sur les
  // mêmes montants ne doit pas échouer.
  await api.db.run('UPDATE factures SET montant_total = montant_total WHERE id = ?', [facture.id]);
});

test('un recalcul d\'indemnités qui toucherait la période close est refusé lisiblement', async (t) => {
  const api = await avecAdmin(t);
  assert.equal((await api.put('/api/settings/taux-kilometriques', { annee: 2025, taux_1: 0.7, taux_2: 0.64, seuil_km: 5000 })).status, 200);
  const trajet = await api.post('/api/depenses', {
    fournisseur: '', description: 'Client', date_depense: DANS_LA_PERIODE, categorie: 'Déplacement', kilometres: 100, vehicule: 'Auto'
  });
  assert.equal(trajet.status, 201, JSON.stringify(trajet.data));
  await verrouiller(api);

  const res = await api.put('/api/settings/taux-kilometriques', { annee: 2025, taux_1: 0.8, taux_2: 0.64, seuil_km: 5000 });
  assert.equal(res.status, 409);
  assert.match(res.data.error, /période verrouillée/);
  assert.equal((await api.db.get('SELECT montant_ht FROM depenses WHERE id = ?', [trajet.data.id])).montant_ht, 70);
});

test('un abonnement rattrapé sur une période close est facturé au premier jour ouvert', async (t) => {
  const api = await avecAdmin(t);
  const client = await insertClient(api.db);
  await api.db.run(
    `INSERT INTO abonnements (client_id, titre, lignes_json, cycle, date_prochaine_generation)
     VALUES (?, 'Entretien', ?, 'Annuel', '2025-12-15')`,
    [client, JSON.stringify([{ description: 'Entretien', quantite: 1, prix_unitaire: 100 }])]
  );
  await verrouiller(api);

  const { generees, erreurs } = await checkAndGenerateRecurringInvoices(api.db);
  assert.equal(erreurs, 0);
  assert.ok(generees >= 1);
  const premiere = await api.db.get('SELECT date_emission, date_echeance FROM factures ORDER BY id LIMIT 1');
  assert.equal(premiere.date_emission, lendemain(VERROU));
  assert.ok(premiere.date_echeance > premiere.date_emission, 'l\'échéance suit la date retenue');
});

test('un déplacement de la période ouverte s\'inscrit, même quand l\'année a des trajets clos', async (t) => {
  const api = await avecAdmin(t);
  const annee = Number(aujourdhui().slice(0, 4));
  assert.equal((await api.put('/api/settings/taux-kilometriques', { annee, taux_1: 0.7, taux_2: 0.64, seuil_km: 5000 })).status, 200);
  const trajet = (date, km) => api.post('/api/depenses', {
    fournisseur: '', description: 'Client', date_depense: date, categorie: 'Déplacement', kilometres: km, vehicule: 'Auto'
  });
  const ancien = await trajet(`${annee}-01-05`, 100);
  assert.equal(ancien.status, 201, JSON.stringify(ancien.data));
  // Le 1er janvier n'est clos que si l'on est au moins le 2.
  if (aujourdhui() <= `${annee}-01-05`) return;
  assert.equal((await api.put('/api/settings/verrouillage', { date_verrouillage: `${annee}-01-05` })).status, 200);

  // Le recalcul de l'année repasse sur le trajet clos, et retombe sur son montant.
  const nouveau = await trajet(aujourdhui(), 50);
  assert.equal(nouveau.status, 201, JSON.stringify(nouveau.data));
  assert.equal(nouveau.data.montant_ht, 35);
  assert.equal((await api.db.get('SELECT montant_ht FROM depenses WHERE id = ?', [ancien.data.id])).montant_ht, 70);
});
