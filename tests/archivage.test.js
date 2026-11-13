/**
 * Renommer et archiver : un client créé par erreur, une entreprise fermée, un
 * dossier dont le nom a changé.
 *
 * Rien de cela n'était possible : un client restait pour toujours dans les
 * listes de choix, un dossier gardait le nom saisi à sa création.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer, MOT_DE_PASSE } = require('./helpers.js');
const { reset: resetRateLimit } = require('../rateLimit.js');
const { aujourdhui } = require('../dates.js');

async function avecAdmin(t) {
  resetRateLimit();
  const api = await startTestServer();
  t.after(() => api.close());
  const res = await api.post('/api/auth/setup', { username: 'patron', password: MOT_DE_PASSE, entreprise: 'Plomberie Tremblay' });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return api;
}

async function client(api, nom = 'Boulangerie Lavoie') {
  const res = await api.post('/api/clients', { nom_entreprise: nom, email: 'compta@exemple.ca', province: 'QC', langue: 'fr' });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data.client;
}

const LIGNES = [{ description: 'Service', quantite: 1, prix_unitaire: 100 }];

test('un client archivé ne reçoit plus de document, et ses documents passés restent', async (t) => {
  const api = await avecAdmin(t);
  const c = await client(api);
  const facture = await api.post('/api/factures', { client_id: c.id, date_emission: aujourdhui(), lignes: LIGNES });
  assert.equal(facture.status, 201);

  const archive = await api.put(`/api/clients/${c.id}/archive`, { archive: true });
  assert.equal(archive.status, 200, JSON.stringify(archive.data));
  assert.ok(archive.data.client.archive_le);

  const liste = (await api.get('/api/clients')).data;
  assert.ok(liste.find((x) => x.id === c.id).archive_le, 'la liste le signale, l\'écran le range à part');

  const refus = await api.post('/api/factures', { client_id: c.id, date_emission: aujourdhui(), lignes: LIGNES });
  assert.equal(refus.status, 400);
  assert.match(refus.data.error, /archivé/);
  const devis = await api.post('/api/devis', { client_id: c.id, date_emission: aujourdhui(), date_validite: aujourdhui(), lignes: LIGNES });
  assert.equal(devis.status, 400);
  assert.match(devis.data.error, /archivé/);
  const abonnement = await api.post('/api/abonnements', {
    client_id: c.id, titre: 'Entretien', lignes_json: JSON.stringify(LIGNES), cycle: 'Mensuel', date_prochaine_generation: aujourdhui()
  });
  assert.equal(abonnement.status, 400);
  assert.match(abonnement.data.error, /archivé/);

  // Sa facture passée reste consultable et encaissable.
  assert.equal((await api.get(`/api/factures/${facture.data.facture.id}/details`)).status, 200);
  assert.equal((await api.post(`/api/factures/${facture.data.facture.id}/paiements`, { montant: 10 })).status, 200);

  assert.equal((await api.put(`/api/clients/${c.id}/archive`, { archive: false })).status, 200);
  assert.equal((await api.post('/api/factures', { client_id: c.id, date_emission: aujourdhui(), lignes: LIGNES })).status, 201);

  const traces = await api.db.all("SELECT action FROM logs_audit WHERE action LIKE 'client.%' ORDER BY id");
  assert.deepEqual(traces.map((l) => l.action), ['client.archivage', 'client.reactivation']);
});

test('un client sous abonnement actif ne s\'archive pas', async (t) => {
  const api = await avecAdmin(t);
  const c = await client(api);
  const abonnement = await api.post('/api/abonnements', {
    client_id: c.id, titre: 'Entretien', lignes_json: JSON.stringify(LIGNES), cycle: 'Mensuel', date_prochaine_generation: '2099-01-01'
  });
  assert.equal(abonnement.status, 201, JSON.stringify(abonnement.data));

  const refus = await api.put(`/api/clients/${c.id}/archive`, { archive: true });
  assert.equal(refus.status, 400);
  assert.match(refus.data.error, /abonnement actif/);

  const id = abonnement.data.id;
  assert.equal((await api.put(`/api/abonnements/${id}`, { statut: 'Inactif' })).status, 200);
  assert.equal((await api.put(`/api/clients/${c.id}/archive`, { archive: true })).status, 200);

  // Et l'abonnement d'un client archivé ne se réactive pas.
  const reactivation = await api.put(`/api/abonnements/${id}`, { statut: 'Actif' });
  assert.equal(reactivation.status, 400);
  assert.match(reactivation.data.error, /archivé/);
});

test('seule une fiche sans document se supprime, et seulement par l\'administrateur', async (t) => {
  const api = await avecAdmin(t);
  const erreur = await client(api, 'Créé par erreur');
  const reel = await client(api, 'Vrai client');
  await api.post('/api/factures', { client_id: reel.id, date_emission: aujourdhui(), lignes: LIGNES });

  const liste = (await api.get('/api/clients')).data;
  assert.equal(liste.find((x) => x.id === erreur.id).documents, 0);
  assert.equal(liste.find((x) => x.id === reel.id).documents, 1);

  const refus = await api.del(`/api/clients/${reel.id}`);
  assert.equal(refus.status, 400);
  assert.match(refus.data.error, /archivez-le plutôt/);

  assert.equal((await api.post('/api/users', { username: 'compta', password: MOT_DE_PASSE, role: 'comptable' })).status, 201);
  assert.equal((await api.post('/api/auth/login', { username: 'compta', password: MOT_DE_PASSE })).status, 200);
  assert.equal((await api.del(`/api/clients/${erreur.id}`)).status, 403);

  assert.equal((await api.post('/api/auth/login', { username: 'patron', password: MOT_DE_PASSE })).status, 200);
  assert.equal((await api.del(`/api/clients/${erreur.id}`)).status, 200);
  assert.equal((await api.get('/api/clients')).data.some((x) => x.id === erreur.id), false);

  const [trace] = await api.db.all("SELECT details FROM logs_audit WHERE action = 'client.suppression'");
  assert.equal(JSON.parse(trace.details).nom, 'Créé par erreur');
});

test('un dossier se renomme et s\'archive, jamais celui qu\'on a ouvert', async (t) => {
  const api = await avecAdmin(t);
  const premier = (await api.get('/api/entreprises')).data.entreprises[0];
  const second = await api.post('/api/entreprises', { nom: 'Boulangerie Côté' });
  assert.equal(second.status, 201);
  const secondId = second.data.entreprise.id;

  // Le second est ouvert : il ne s'archive pas.
  const ouvert = await api.put(`/api/entreprises/${secondId}/archive`, { archive: true });
  assert.equal(ouvert.status, 409);

  const renomme = await api.put(`/api/entreprises/${premier.id}`, { nom: 'Plomberie Tremblay 2025' });
  assert.equal(renomme.status, 200, JSON.stringify(renomme.data));
  assert.equal((await api.put(`/api/entreprises/${premier.id}`, { nom: '  ' })).status, 400);

  assert.equal((await api.put(`/api/entreprises/${premier.id}/archive`, { archive: true })).status, 200);
  const apres = (await api.get('/api/entreprises')).data;
  assert.deepEqual(apres.entreprises.map((e) => e.nom), ['Boulangerie Côté']);
  assert.deepEqual(apres.archives.map((e) => e.nom), ['Plomberie Tremblay 2025']);
  assert.equal((await api.post(`/api/entreprises/${premier.id}/ouvrir`, {})).status, 404, 'un dossier archivé ne s\'ouvre pas');

  // Les données ne sont pas touchées : réactivé, il se rouvre tel quel.
  assert.equal((await api.put(`/api/entreprises/${premier.id}/archive`, { archive: false })).status, 200);
  assert.equal((await api.post(`/api/entreprises/${premier.id}/ouvrir`, {})).status, 200);
});

test('seul un administrateur du dossier le renomme ou l\'archive', async (t) => {
  const api = await avecAdmin(t);
  const dossier = (await api.get('/api/entreprises')).data.entreprises[0];
  assert.equal((await api.post('/api/users', { username: 'compta', password: MOT_DE_PASSE, role: 'comptable' })).status, 201);
  assert.equal((await api.post('/api/auth/login', { username: 'compta', password: MOT_DE_PASSE })).status, 200);

  assert.equal((await api.put(`/api/entreprises/${dossier.id}`, { nom: 'Autre' })).status, 403);
  assert.equal((await api.put(`/api/entreprises/${dossier.id}/archive`, { archive: true })).status, 403);
  assert.equal((await api.put('/api/entreprises/9999', { nom: 'Autre' })).status, 404);
});

test('le dossier suit la raison sociale, sauf s\'il a reçu un nom à lui', async (t) => {
  const api = await avecAdmin(t);
  const id = (await api.get('/api/entreprises')).data.entreprises[0].id;
  const nomDuDossier = async () => (await api.get('/api/entreprises')).data.entreprises.find((e) => e.id === id).nom;

  const changement = await api.put('/api/settings', { entreprise_nom: 'Plomberie Tremblay inc.' });
  assert.equal(changement.status, 200, JSON.stringify(changement.data));
  assert.deepEqual(changement.data.dossier, { id, nom: 'Plomberie Tremblay inc.' }, 'l\'interface met son en-tête à jour');
  assert.equal(await nomDuDossier(), 'Plomberie Tremblay inc.');

  await api.put(`/api/entreprises/${id}`, { nom: 'Tremblay (client de la firme)' });
  const second = await api.put('/api/settings', { entreprise_nom: 'Plomberie Tremblay ltée' });
  assert.equal(second.data.dossier, null);
  assert.equal(await nomDuDossier(), 'Tremblay (client de la firme)');
});
