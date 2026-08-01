/**
 * Journal d'audit.
 *
 * Deux garanties sont testées plus que le reste : que le journal enregistre
 * réellement, et qu'on ne peut ni le réécrire ni y trouver un secret.
 */

const test = require('node:test');
const assert = require('node:assert');

const { createTestDb, insertClient, startTestServer, MOT_DE_PASSE } = require('./helpers.js');
const { reset: resetRateLimit } = require('../rateLimit.js');
const { journaliser, lireJournal, ecart, ACTIONS } = require('../auditService.js');

/** Serveur avec un administrateur connecté. */
async function avecAdmin(t) {
  resetRateLimit();
  const api = await startTestServer();
  t.after(() => api.close());

  const res = await api.post('/api/auth/setup', { username: 'patron', password: MOT_DE_PASSE });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return api;
}

/** Bascule la session sur un compte du rôle demandé. */
async function sessionPour(api, role) {
  const username = `compte_${role}`;
  const creation = await api.post('/api/users', { username, password: MOT_DE_PASSE, role });
  assert.equal(creation.status, 201, JSON.stringify(creation.data));
  const login = await api.post('/api/auth/login', { username, password: MOT_DE_PASSE });
  assert.equal(login.status, 200, JSON.stringify(login.data));
}

/** Crée une facture réglée, puis rend l'identifiant de son paiement. */
async function factureAvecPaiement(api) {
  const clientId = await insertClient(api.db, { nom: 'Client audit' });
  const facture = await api.post('/api/factures', {
    client_id: clientId,
    date_emission: '2026-07-01',
    date_echeance: '2026-07-31',
    lignes: [{ description: 'Prestation', quantite: 1, prix_unitaire: 100 }]
  });
  assert.equal(facture.status, 201, JSON.stringify(facture.data));
  const factureId = facture.data.facture.id;

  const paiement = await api.post(`/api/factures/${factureId}/paiements`, { montant: 10 });
  assert.equal(paiement.status, 200, JSON.stringify(paiement.data));

  const { id: paiementId } = await api.db.get(
    'SELECT id FROM paiements WHERE facture_id = ? ORDER BY id DESC LIMIT 1', [factureId]
  );
  return { factureId, paiementId, numero: facture.data.facture.numero_facture };
}

/* --- Ce que le journal enregistre --- */

test('annuler un encaissement laisse une trace nominative', async (t) => {
  const api = await avecAdmin(t);
  const { paiementId, numero } = await factureAvecPaiement(api);

  const res = await api.del(`/api/factures/paiements/${paiementId}`, { motif: 'Saisi en double' });
  assert.equal(res.status, 200, JSON.stringify(res.data));

  const ligne = await api.db.get(
    'SELECT * FROM logs_audit WHERE action = ? ORDER BY id DESC LIMIT 1',
    [ACTIONS.PAIEMENT_ANNULATION]
  );

  assert.ok(ligne, 'une ligne doit être écrite');
  assert.equal(ligne.utilisateur, 'patron');
  assert.equal(ligne.role, 'admin');
  assert.equal(ligne.entite, 'paiement');
  assert.equal(ligne.entite_id, paiementId);

  const details = JSON.parse(ligne.details);
  assert.equal(details.facture, numero);
  assert.equal(details.motif, 'Saisi en double');
});

test('un changement de taux de taxe conserve l\'ancienne et la nouvelle valeur', async (t) => {
  const api = await avecAdmin(t);

  const res = await api.put('/api/settings', {
    entreprise_nom: 'Test', taxe_1_nom: 'TPS', taxe_1_taux: 0.06, taxe_2_taux: 0.09975
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));

  const ligne = await api.db.get(
    'SELECT * FROM logs_audit WHERE action = ? ORDER BY id DESC LIMIT 1',
    [ACTIONS.PARAMETRES_MODIFICATION]
  );

  assert.ok(ligne, 'la modification des paramètres doit être consignée');
  const { changements } = JSON.parse(ligne.details);
  assert.ok(changements.taxe_1_taux, 'le taux modifié doit figurer');
  assert.equal(changements.taxe_1_taux.apres, 0.06);
});

test('modifier un client ne consigne que les champs qui ont bougé', async (t) => {
  const api = await avecAdmin(t);
  const clientId = await insertClient(api.db, { nom: 'Avant', email: 'avant@exemple.ca' });

  const res = await api.put(`/api/clients/${clientId}`, {
    nom_entreprise: 'Après', nom_contact: 'Contact', email: 'avant@exemple.ca',
    adresse: '1 rue Test', langue: 'fr', province: 'QC'
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));

  const ligne = await api.db.get(
    'SELECT * FROM logs_audit WHERE action = ? ORDER BY id DESC LIMIT 1',
    [ACTIONS.CLIENT_MODIFICATION]
  );

  const { changements } = JSON.parse(ligne.details);
  assert.deepEqual(Object.keys(changements), ['nom_entreprise']);
  assert.equal(changements.nom_entreprise.avant, 'Avant');
  assert.equal(changements.nom_entreprise.apres, 'Après');
});

test('un enregistrement sans changement ne pollue pas le journal', async (t) => {
  const api = await avecAdmin(t);
  const clientId = await insertClient(api.db, { nom: 'Inchangé', email: 'x@exemple.ca' });

  const identique = {
    nom_entreprise: 'Inchangé', nom_contact: 'Contact', email: 'x@exemple.ca',
    adresse: '1 rue Test', langue: 'fr', province: 'QC'
  };
  await api.put(`/api/clients/${clientId}`, identique);
  await api.put(`/api/clients/${clientId}`, identique);

  const { total } = await api.db.get(
    'SELECT COUNT(*) AS total FROM logs_audit WHERE action = ?', [ACTIONS.CLIENT_MODIFICATION]
  );
  assert.equal(total, 0, 'réenregistrer sans rien changer ne doit rien consigner');
});

test('supprimer une facture conserve son numéro', async (t) => {
  const api = await avecAdmin(t);
  const clientId = await insertClient(api.db, { nom: 'Client' });
  const facture = await api.post('/api/factures', {
    client_id: clientId,
    date_emission: '2026-07-01',
    date_echeance: '2026-07-31',
    lignes: [{ description: 'Prestation', quantite: 1, prix_unitaire: 50 }]
  });

  assert.equal(facture.status, 201, JSON.stringify(facture.data));
  const res = await api.del(`/api/factures/${facture.data.facture.id}`);
  assert.equal(res.status, 200, JSON.stringify(res.data));

  const ligne = await api.db.get(
    'SELECT * FROM logs_audit WHERE action = ? ORDER BY id DESC LIMIT 1',
    [ACTIONS.FACTURE_SUPPRESSION]
  );

  // Le numéro doit avoir été relevé avant la suppression : après, la facture
  // n'existe plus et la trace ne nommerait rien.
  assert.equal(JSON.parse(ligne.details).numero, facture.data.facture.numero_facture);
});

test('la création et la suppression de compte sont consignées', async (t) => {
  const api = await avecAdmin(t);

  const creation = await api.post('/api/users', {
    username: 'nouveau', password: MOT_DE_PASSE, role: 'comptable'
  });
  assert.equal(creation.status, 201);

  const suppression = await api.del(`/api/users/${creation.data.id}`);
  assert.equal(suppression.status, 200, JSON.stringify(suppression.data));

  const lignes = await api.db.all(
    'SELECT * FROM logs_audit WHERE entite = ? ORDER BY id', ['utilisateur']
  );
  assert.equal(lignes.length, 2);
  assert.equal(lignes[0].action, ACTIONS.UTILISATEUR_CREATION);
  assert.equal(lignes[1].action, ACTIONS.UTILISATEUR_SUPPRESSION);

  // Le nom du compte supprimé doit subsister, sinon la trace n'apprend rien.
  assert.equal(JSON.parse(lignes[1].details).username, 'nouveau');
});

/* --- Ce que le journal ne doit jamais contenir --- */

test('aucun mot de passe ni empreinte n\'atteint le journal', async (t) => {
  const api = await avecAdmin(t);

  await api.post('/api/users', { username: 'secretaire', password: MOT_DE_PASSE, role: 'employe' });
  await api.put('/api/auth/credentials', {
    currentPassword: MOT_DE_PASSE, newUsername: 'patron', newPassword: 'un-autre-mot-de-passe'
  });

  const lignes = await api.db.all('SELECT details FROM logs_audit');
  assert.ok(lignes.length > 0, 'le journal ne doit pas être vide pour ce test');

  const tout = lignes.map((l) => l.details || '').join(' ');
  assert.ok(!tout.includes(MOT_DE_PASSE), 'le mot de passe ne doit pas figurer');
  assert.ok(!tout.includes('un-autre-mot-de-passe'), 'le nouveau mot de passe ne doit pas figurer');
  assert.ok(!tout.includes('$2'), 'aucune empreinte bcrypt ne doit figurer');
});

test('le logo n\'est pas recopié dans le journal', async (t) => {
  const api = await avecAdmin(t);

  // Un data-URI, même court, ne doit pas se retrouver au journal : en usage
  // réel il pèse plusieurs mégaoctets, à chaque enregistrement.
  const logo = `data:image/png;base64,${'A'.repeat(5000)}`;
  const res = await api.put('/api/settings', {
    entreprise_nom: 'Avec logo', taxe_1_taux: 0.05, taxe_2_taux: 0.09975, entreprise_logo: logo
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));

  const lignes = await api.db.all('SELECT details FROM logs_audit');
  const tout = lignes.map((l) => l.details || '').join(' ');
  assert.ok(!tout.includes('data:image/'), 'aucun data-URI ne doit figurer');
  assert.ok(!tout.includes('AAAA'), 'le contenu du logo ne doit pas figurer');
});

test('un détail démesuré est tronqué plutôt que stocké entier', async (t) => {
  const db = await createTestDb();
  t.after(() => db.__cleanup());

  const req = { user: { username: 'patron', role: 'admin' } };
  await journaliser(db, req, {
    action: ACTIONS.CLIENT_MODIFICATION,
    entite: 'client',
    entite_id: 1,
    details: { note: 'x'.repeat(50000) }
  });

  const ligne = await db.get('SELECT details FROM logs_audit ORDER BY id DESC LIMIT 1');
  assert.ok(ligne.details.length < 3000, `détail trop long : ${ligne.details.length}`);
  assert.ok(JSON.parse(ligne.details).tronque, 'la troncature doit être signalée');
});

/* --- Inaltérabilité --- */

test('la base refuse de modifier ou de supprimer une ligne du journal', async (t) => {
  const db = await createTestDb();
  t.after(() => db.__cleanup());

  await journaliser(db, { user: { username: 'patron', role: 'admin' } }, {
    action: ACTIONS.FACTURE_ANNULATION, entite: 'facture', entite_id: 1, details: { numero: 'SHT-1' }
  });

  const ligne = await db.get('SELECT id FROM logs_audit LIMIT 1');
  assert.ok(ligne, 'la ligne de départ doit exister');

  // La garantie ne repose pas sur l'absence de route : c'est SQLite qui refuse,
  // quel que soit le chemin emprunté.
  await assert.rejects(
    () => db.run('UPDATE logs_audit SET utilisateur = ? WHERE id = ?', ['quelqu\'un', ligne.id]),
    /ne peut pas être modifié/
  );
  await assert.rejects(
    () => db.run('DELETE FROM logs_audit WHERE id = ?', [ligne.id]),
    /ne peut pas être supprimé/
  );

  const { total } = await db.get('SELECT COUNT(*) AS total FROM logs_audit');
  assert.equal(total, 1, 'la ligne doit être intacte');
});

test('un journal en échec n\'empêche pas l\'action métier', async (t) => {
  const api = await avecAdmin(t);
  const { paiementId } = await factureAvecPaiement(api);

  // Le déclencheur d'ajout rend toute écriture impossible : c'est la panne la
  // plus radicale qu'on puisse simuler.
  await api.db.exec(`
    CREATE TRIGGER journal_en_panne BEFORE INSERT ON logs_audit
    BEGIN SELECT RAISE(ABORT, 'panne simulée'); END;
  `);

  const res = await api.del(`/api/factures/paiements/${paiementId}`, { motif: 'Test' });

  // Refuser d'annuler un encaissement saisi à tort serait plus dommageable que
  // de perdre une ligne de trace.
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const paiement = await api.db.get('SELECT annule_le FROM paiements WHERE id = ?', [paiementId]);
  assert.ok(paiement.annule_le, 'le paiement doit bien être annulé');
});

/* --- Lecture --- */

test('le journal est réservé à l\'administration et à la comptabilité', async (t) => {
  const api = await avecAdmin(t);

  await sessionPour(api, 'employe');
  assert.equal((await api.get('/api/audit')).status, 403);

  await api.post('/api/auth/login', { username: 'patron', password: MOT_DE_PASSE });
  await sessionPour(api, 'comptable');
  assert.equal((await api.get('/api/audit')).status, 200);

  api.clearCookie();
  assert.equal((await api.get('/api/audit')).status, 401);
});

test('les filtres et la pagination restreignent bien le résultat', async (t) => {
  const db = await createTestDb();
  t.after(() => db.__cleanup());

  const patron = { user: { username: 'patron', role: 'admin' } };
  const comptable = { user: { username: 'julie', role: 'comptable' } };

  for (let i = 0; i < 7; i += 1) {
    await journaliser(db, patron, { action: ACTIONS.CLIENT_MODIFICATION, entite: 'client', entite_id: i });
  }
  await journaliser(db, comptable, { action: ACTIONS.FACTURE_ANNULATION, entite: 'facture', entite_id: 1 });

  const parAction = await lireJournal(db, { action: ACTIONS.FACTURE_ANNULATION });
  assert.equal(parAction.total, 1);
  assert.equal(parAction.lignes[0].utilisateur, 'julie');
  assert.equal(parAction.lignes[0].libelle, 'Facture annulée');

  const parAuteur = await lireJournal(db, { utilisateur: 'patron' });
  assert.equal(parAuteur.total, 7);

  const page1 = await lireJournal(db, { parPage: 3, page: 1 });
  assert.equal(page1.total, 8);
  assert.equal(page1.nbPages, 3);
  assert.equal(page1.lignes.length, 3);

  const page3 = await lireJournal(db, { parPage: 3, page: 3 });
  assert.equal(page3.lignes.length, 2);
});

test('une action inconnue au filtre est refusée', async (t) => {
  const api = await avecAdmin(t);
  assert.equal((await api.get('/api/audit?action=n-importe-quoi')).status, 400);
  assert.equal((await api.get('/api/audit?depuis=01-02-2026')).status, 400);
});

test('ecart ne retient que les différences réelles', () => {
  // SQLite rend « 0.05 » là où le formulaire envoie 0.05 : sans comparaison
  // souple, chaque enregistrement signalerait un faux changement.
  assert.equal(ecart({ taux: 0.05 }, { taux: '0.05' }, ['taux']), null);
  assert.deepEqual(
    ecart({ taux: 0.05 }, { taux: 0.06 }, ['taux']),
    { taux: { avant: 0.05, apres: 0.06 } }
  );
  assert.equal(ecart({ a: 1 }, { a: 1 }, ['inexistant']), null);
});
