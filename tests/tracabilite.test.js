/**
 * Ce que le journal doit garder, et qu'il ne gardait pas.
 *
 * Une dépense modifiée ou supprimée change le rapport de taxes ; une facture
 * modifiée après son envoi n'est plus celle que le client a en main ; un dépôt
 * imputé ou écarté décide de ce qui est tenu pour encaissé. Aucun de ces gestes
 * ne laissait de trace.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer, insertClient, MOT_DE_PASSE } = require('./helpers.js');
const { reset: resetRateLimit } = require('../rateLimit.js');
const { reinitialiser } = require('../emailService.js');

async function avecAdmin(t) {
  resetRateLimit();
  const api = await startTestServer();
  t.after(() => api.close());
  const res = await api.post('/api/auth/setup', { username: 'patron', password: MOT_DE_PASSE });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return api;
}

/** Entrées du journal pour une action, de la plus ancienne à la plus récente. */
async function journal(api, action) {
  const lignes = await api.db.all('SELECT * FROM logs_audit WHERE action = ? ORDER BY id', [action]);
  return lignes.map((l) => ({ ...l, details: l.details ? JSON.parse(l.details) : null }));
}

const DEPENSE = {
  fournisseur: 'Quincaillerie', description: 'Outils', date_depense: '2026-10-05',
  montant_ht: 200, tps: 10, tvq: 19.95, montant_ttc: 229.95, categorie: 'Fournitures'
};

async function facturer(api, clientId) {
  const res = await api.post('/api/factures', {
    client_id: clientId, date_emission: '2026-11-10', date_echeance: '2026-12-10',
    lignes: [{ description: 'Service', quantite: 1, prix_unitaire: 100 }]
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data.facture;
}

test('une dépense ajoutée, modifiée puis supprimée laisse trois traces', async (t) => {
  const api = await avecAdmin(t);

  const creee = await api.post('/api/depenses', DEPENSE);
  assert.equal(creee.status, 201, JSON.stringify(creee.data));
  const id = creee.data.id;

  const modifiee = await api.put(`/api/depenses/${id}`, { ...DEPENSE, montant_ht: 300, tps: 15, tvq: 29.93, montant_ttc: 344.93 });
  assert.equal(modifiee.status, 200, JSON.stringify(modifiee.data));
  assert.equal((await api.del(`/api/depenses/${id}`)).status, 200);

  const [ajout] = await journal(api, 'depense.creation');
  assert.equal(ajout.utilisateur, 'patron');
  assert.equal(ajout.entite_id, id);
  assert.equal(ajout.details.fournisseur, 'Quincaillerie');

  const [modification] = await journal(api, 'depense.modification');
  assert.deepEqual(modification.details.changements.montant_ht, { avant: 200, apres: 300 });
  assert.deepEqual(modification.details.changements.tps, { avant: 10, apres: 15 });
  assert.equal(modification.details.changements.fournisseur, undefined, 'seul ce qui change est consigné');

  // La dépense n'existe plus : le journal garde de quoi la reconstituer.
  const [suppression] = await journal(api, 'depense.suppression');
  assert.equal(suppression.details.montant_ttc, 344.93);
  assert.equal(suppression.details.tps, 15);
  assert.equal(suppression.details.date_depense, '2026-10-05');
});

test('enregistrer une dépense sans rien changer ne consigne rien', async (t) => {
  const api = await avecAdmin(t);
  const { data } = await api.post('/api/depenses', DEPENSE);
  await api.put(`/api/depenses/${data.id}`, DEPENSE);
  assert.equal((await journal(api, 'depense.modification')).length, 0);
});

test('une facture modifiée est consignée, avec l\'écart de ses montants', async (t) => {
  const api = await avecAdmin(t);
  const clientId = await insertClient(api.db);
  const facture = await facturer(api, clientId);

  const res = await api.put(`/api/factures/${facture.id}`, {
    client_id: clientId, date_echeance: '2026-12-10',
    lignes: [{ description: 'Service', quantite: 1, prix_unitaire: 250 }]
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));

  const [trace] = await journal(api, 'facture.modification');
  assert.equal(trace.details.numero, facture.numero_facture);
  assert.equal(trace.details.deja_envoyee, false);
  assert.deepEqual(trace.details.changements.sous_total, { avant: 100, apres: 250 });
  assert.ok(trace.details.changements.montant_total, 'le total a changé lui aussi');
});

test('l\'envoi d\'une facture est daté et consigné, et sa modification le signale', async (t) => {
  const api = await avecAdmin(t);
  const clientId = await insertClient(api.db);
  const facture = await facturer(api, clientId);

  // Un serveur d'envoi factice : seul compte ici ce que Clora retient de l'envoi.
  const envois = [];
  t.mock.method(require('nodemailer'), 'createTransport', () => ({
    sendMail: async (message) => { envois.push(message); return { accepted: [message.to] }; }
  }));
  Object.assign(process.env, { SMTP_HOST: 'smtp.exemple.ca', SMTP_USER: 'moi@exemple.ca', SMTP_PASS: 'secret' });
  reinitialiser();
  t.after(() => {
    for (const cle of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']) delete process.env[cle];
    reinitialiser();
  });

  const corps = { to: 'client@exemple.ca', subject: 'Votre facture', text: 'Bonjour', attachmentBase64: 'JVBERi0=', filename: 'Facture.pdf' };
  assert.equal((await api.get(`/api/factures/${facture.id}/details`)).data.envoyee_le, null);

  const premier = await api.post('/api/emails/send', { ...corps, facture_id: facture.id });
  assert.equal(premier.status, 200, JSON.stringify(premier.data));
  const date = (await api.get(`/api/factures/${facture.id}/details`)).data.envoyee_le;
  assert.match(date, /^\d{4}-\d{2}-\d{2}T/);

  // Un second envoi est consigné, mais la date du premier reste.
  await api.post('/api/emails/send', { ...corps, to: 'autre@exemple.ca', facture_id: facture.id });
  assert.equal((await api.get(`/api/factures/${facture.id}/details`)).data.envoyee_le, date);
  const traces = await journal(api, 'facture.envoi');
  assert.deepEqual(traces.map((l) => l.details.destinataire), ['client@exemple.ca', 'autre@exemple.ca']);
  assert.equal(traces[0].details.numero, facture.numero_facture);
  assert.equal(envois.length, 2);

  // Un envoi sans facture désignée (un devis, une note de crédit) ne date rien.
  assert.equal((await api.post('/api/emails/send', corps)).status, 200);
  assert.equal((await journal(api, 'facture.envoi')).length, 2);

  await api.put(`/api/factures/${facture.id}`, {
    client_id: clientId, date_echeance: '2026-12-10',
    lignes: [{ description: 'Service', quantite: 1, prix_unitaire: 120 }]
  });
  const [modification] = await journal(api, 'facture.modification');
  assert.equal(modification.details.deja_envoyee, true, 'le client avait déjà reçu l\'ancienne version');
});

test('un abonnement créé, modifié puis supprimé laisse trois traces', async (t) => {
  const api = await avecAdmin(t);
  const clientId = await insertClient(api.db);

  const cree = await api.post('/api/abonnements', {
    client_id: clientId, titre: 'Hébergement', cycle: 'Mensuel', date_prochaine_generation: '2027-01-01',
    lignes_json: JSON.stringify([{ description: 'Hébergement', quantite: 1, prix_unitaire: 50 }])
  });
  assert.equal(cree.status, 201, JSON.stringify(cree.data));
  const id = cree.data.id;

  assert.equal((await api.put(`/api/abonnements/${id}`, { statut: 'Inactif' })).status, 200);
  assert.equal((await api.del(`/api/abonnements/${id}`)).status, 200);

  assert.equal((await journal(api, 'abonnement.creation'))[0].details.titre, 'Hébergement');
  const [modification] = await journal(api, 'abonnement.modification');
  assert.deepEqual(Object.keys(modification.details.changements), ['statut']);
  assert.equal((await journal(api, 'abonnement.suppression'))[0].details.titre, 'Hébergement');
});

test('imputer ou écarter un dépôt bancaire est consigné', async (t) => {
  const api = await avecAdmin(t);
  const clientId = await insertClient(api.db);
  const facture = await facturer(api, clientId);
  const depot = async (description, montant) => (await api.db.run(
    "INSERT INTO transactions_bancaires (date_transaction, description, montant) VALUES ('2026-11-12', ?, ?)",
    [description, montant]
  )).lastID;

  const virement = await depot('VIREMENT CLIENT', 60);
  const res = await api.post(`/api/banque/rapprocher/${virement}`, { facture_id: facture.id });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const [imputation] = await journal(api, 'banque.rapprochement');
  assert.equal(imputation.details.facture, facture.numero_facture);
  assert.equal(imputation.details.montant_impute, 60);
  assert.equal(imputation.details.depot, 'VIREMENT CLIENT');

  const autre = await depot('DEPOT PERSONNEL', 500);
  assert.equal((await api.post(`/api/banque/ignorer/${autre}`)).status, 200);
  const [ecarte] = await journal(api, 'banque.depot_ignore');
  assert.equal(ecarte.details.montant, 500);
  assert.equal(ecarte.utilisateur, 'patron');
});

test('un geste refusé ne laisse aucune trace trompeuse', async (t) => {
  const api = await avecAdmin(t);
  assert.equal((await api.del('/api/depenses/999')).status, 404);
  assert.equal((await api.del('/api/abonnements/999')).status, 404);
  assert.equal((await api.post('/api/banque/ignorer/999')).status, 404);
  const { n } = await api.db.get("SELECT COUNT(*) AS n FROM logs_audit WHERE action LIKE 'depense.%' OR action LIKE 'abonnement.%' OR action LIKE 'banque.%'");
  assert.equal(n, 0);
});
