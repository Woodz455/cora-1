/**
 * Sécurité de l'API : authentification, cloisonnement des rôles, en-têtes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const { startTestServer, MOT_DE_PASSE } = require('./helpers.js');
const { reset: resetRateLimit } = require('../rateLimit.js');

/** Prépare un serveur avec un admin connecté. */
async function withAdmin(t) {
  resetRateLimit();
  const api = await startTestServer();
  t.after(() => api.close());

  const res = await api.post('/api/auth/setup', { username: 'patron', password: MOT_DE_PASSE });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return api;
}

/**
 * Crée un compte avec le rôle demandé, puis bascule la session dessus.
 * À appeler depuis une session administrateur.
 */
async function sessionPour(api, role) {
  const username = `compte_${role}`;
  const creation = await api.post('/api/users', { username, password: MOT_DE_PASSE, role });
  assert.equal(creation.status, 201, JSON.stringify(creation.data));

  const login = await api.post('/api/auth/login', { username, password: MOT_DE_PASSE });
  assert.equal(login.status, 200, JSON.stringify(login.data));
}

test('les routes de l\'API exigent une session', async (t) => {
  resetRateLimit();
  const api = await startTestServer();
  t.after(() => api.close());

  for (const url of ['/api/factures', '/api/clients', '/api/settings', '/api/rapports', '/api/stats']) {
    const res = await api.get(url);
    assert.equal(res.status, 401, `${url} devrait exiger une session`);
  }
});

test('un jeton signé avec l\'ancien secret par défaut est rejeté', async (t) => {
  const api = await withAdmin(t);

  // Ce secret figurait en dur dans le code source : n'importe qui pouvait
  // forger un jeton administrateur sans connaître aucun mot de passe.
  const forge = jwt.sign({ username: 'pirate', role: 'admin' }, 'safequick_local_secret_key_2026');
  api.setCookie(`token=${forge}`);

  const res = await api.get('/api/users');
  assert.equal(res.status, 401);
});

test('un employé ne peut pas supprimer une facture', async (t) => {
  const api = await withAdmin(t);

  const client = await api.post('/api/clients', {
    nom_entreprise: 'Client Test', email: 'client@exemple.ca', province: 'QC'
  });
  assert.equal(client.status, 201);

  const facture = await api.post('/api/factures', {
    client_id: client.data.client.id,
    date_emission: '2026-07-01',
    date_echeance: '2026-07-31',
    lignes: [{ description: 'Service', quantite: 1, prix_unitaire: 1000 }]
  });
  assert.equal(facture.status, 201, JSON.stringify(facture.data));
  const factureId = facture.data.facture.id;

  await sessionPour(api, 'employe');

  // Un employé supprimait auparavant définitivement n'importe quelle facture,
  // paiements compris, sans aucun contrôle.
  const suppression = await api.del(`/api/factures/${factureId}`);
  assert.equal(suppression.status, 403);

  const annulation = await api.put(`/api/factures/${factureId}/cancel`);
  assert.equal(annulation.status, 403);

  const paiement = await api.post(`/api/factures/${factureId}/paiements`, { montant: 100 });
  assert.equal(paiement.status, 403);

  // La facture est intacte.
  const liste = await api.get('/api/factures');
  assert.equal(liste.status, 200);
  assert.equal(liste.data.length, 1);
});

test('un employé n\'atteint ni les dépenses, ni les rapports, ni la banque, ni les comptes', async (t) => {
  const api = await withAdmin(t);
  await sessionPour(api, 'employe');

  for (const url of ['/api/depenses', '/api/rapports', '/api/rapports/taxes', '/api/banque/transactions', '/api/users']) {
    const res = await api.get(url);
    assert.equal(res.status, 403, `${url} devrait être refusé à un employé`);
  }
});

test('un employé peut lire les paramètres mais pas les modifier', async (t) => {
  const api = await withAdmin(t);
  await api.put('/api/settings', {
    entreprise_nom: 'Ma PME', taxe_1_nom: 'TPS', taxe_1_taux: 0.05,
    taxe_2_nom: 'TVQ', taxe_2_taux: 0.09975, payment_instructions: 'Virement Interac'
  });

  await sessionPour(api, 'employe');

  // La lecture était réservée aux administrateurs alors que le modèle
  // d'impression en dépend : les factures d'un employé sortaient sans logo,
  // sans raison sociale et sans instructions de paiement.
  const lecture = await api.get('/api/settings');
  assert.equal(lecture.status, 200);
  assert.equal(lecture.data.entreprise_nom, 'Ma PME');
  assert.equal(lecture.data.payment_instructions, 'Virement Interac');

  // Les colonnes techniques ne sont jamais exposées.
  assert.equal(lecture.data.admin_username, undefined);
  assert.equal(lecture.data.admin_password, undefined);

  const ecriture = await api.put('/api/settings', { entreprise_nom: 'Pirate' });
  assert.equal(ecriture.status, 403);
});

test('un comptable accède aux rapports mais pas aux paramètres', async (t) => {
  const api = await withAdmin(t);
  await sessionPour(api, 'comptable');

  assert.equal((await api.get('/api/rapports')).status, 200);
  assert.equal((await api.get('/api/depenses')).status, 200);
  assert.equal((await api.get('/api/banque/transactions')).status, 200);
  assert.equal((await api.put('/api/settings', { entreprise_nom: 'X' })).status, 403);
  assert.equal((await api.get('/api/users')).status, 403);
});

test('les tentatives de connexion répétées sont bloquées', async (t) => {
  const api = await withAdmin(t);
  api.clearCookie();

  let bloque = false;
  for (let i = 0; i < 12; i++) {
    const res = await api.post('/api/auth/login', { username: 'patron', password: 'mauvais-mot-de-passe' });
    if (res.status === 429) { bloque = true; break; }
    assert.equal(res.status, 401);
  }
  assert.ok(bloque, 'la limitation des tentatives devrait finir par répondre 429');
});

test('un mot de passe trop court est refusé', async (t) => {
  const api = await withAdmin(t);
  const res = await api.post('/api/users', { username: 'faible', password: '1234', role: 'employe' });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /8 caractères/);
});

test('le dernier administrateur ne peut pas être supprimé', async (t) => {
  const api = await withAdmin(t);
  const moi = await api.get('/api/users');
  const admin = moi.data.find((u) => u.role === 'admin');

  const res = await api.del(`/api/users/${admin.id}`);
  assert.equal(res.status, 400);
  assert.match(res.data.error, /propre compte|dernier administrateur/);
});

test('les données invalides sont refusées avec un message explicite', async (t) => {
  const api = await withAdmin(t);

  const clientSansEmail = await api.post('/api/clients', { nom_entreprise: 'Sans courriel' });
  assert.equal(clientSansEmail.status, 400);
  assert.match(clientSansEmail.data.error, /courriel/);

  const provinceInconnue = await api.post('/api/clients', {
    nom_entreprise: 'X', email: 'x@y.ca', province: 'ZZ'
  });
  assert.equal(provinceInconnue.status, 400);

  const client = await api.post('/api/clients', {
    nom_entreprise: 'Client', email: 'c@exemple.ca', province: 'QC'
  });

  const sansLigne = await api.post('/api/factures', {
    client_id: client.data.client.id, date_emission: '2026-07-01', date_echeance: '2026-07-31', lignes: []
  });
  assert.equal(sansLigne.status, 400);

  const dateInvalide = await api.post('/api/factures', {
    client_id: client.data.client.id,
    date_emission: '01/07/2026',
    date_echeance: '2026-07-31',
    lignes: [{ description: 'S', quantite: 1, prix_unitaire: 10 }]
  });
  assert.equal(dateInvalide.status, 400);

  const quantiteNegative = await api.post('/api/factures', {
    client_id: client.data.client.id,
    date_emission: '2026-07-01',
    date_echeance: '2026-07-31',
    lignes: [{ description: 'S', quantite: -5, prix_unitaire: 10 }]
  });
  assert.equal(quantiteNegative.status, 400);
  assert.match(quantiteNegative.data.error, /quantité/);
});

test('une facture en devise étrangère est refusée sans taux de change', async (t) => {
  const api = await withAdmin(t);
  const client = await api.post('/api/clients', {
    nom_entreprise: 'Client US', email: 'us@exemple.ca', province: 'QC'
  });

  const res = await api.post('/api/factures', {
    client_id: client.data.client.id,
    date_emission: '2026-07-01',
    date_echeance: '2026-07-31',
    devise: 'USD',
    taux_change: 0,
    lignes: [{ description: 'S', quantite: 1, prix_unitaire: 10 }]
  });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /taux de change/);
});

test('une route d\'API inconnue répond en JSON', async (t) => {
  const api = await withAdmin(t);
  const res = await api.get('/api/inexistant');
  assert.equal(res.status, 404);
  assert.match(res.data.error, /Route inconnue/);
});

test('les en-têtes de sécurité sont présents et aucun en-tête CORS ne l\'est', async (t) => {
  resetRateLimit();
  const api = await startTestServer();
  t.after(() => api.close());

  const res = await fetch(`${api.base}/api/auth/setup-status`, {
    headers: { Origin: 'http://site-malveillant.example' }
  });

  // `cors()` répondait « Access-Control-Allow-Origin: * » à n'importe quelle origine.
  assert.equal(res.headers.get('access-control-allow-origin'), null);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('un 503 délibéré parvient à l\'utilisateur, un 500 imprévu reste opaque', async (t) => {
  const api = await withAdmin(t);

  // Sans configuration d'envoi, le message doit dire quoi faire : « Erreur
  // interne du serveur » renverrait l'utilisateur d'un logiciel de bureau lire
  // des journaux.
  //
  // Il désigne désormais l'écran des Paramètres, et non plus des variables d'un
  // fichier `.env` que l'application installée ne pouvait de toute façon pas
  // lire — le message envoyait chercher un fichier inatteignable.
  const res = await api.post('/api/emails/send', {
    to: 'client@exemple.ca',
    subject: 'Facture',
    body: 'Bonjour',
    attachmentBase64: 'data:application/pdf;base64,JVBERi0='
  });
  assert.equal(res.status, 503, JSON.stringify(res.data));
  assert.match(res.data.error, /Paramètres/);
  assert.match(res.data.error, /Courriel/);
  assert.doesNotMatch(res.data.error, /\.env/);

  // Une anomalie non prévue ne divulgue toujours rien.
  const { errorHandler, httpError } = require('../httpUtils.js');
  const reponse = () => {
    const r = { code: null, corps: null };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.corps = b; return r; };
    return r;
  };

  const requete = { method: 'GET', originalUrl: '/api/test' };
  const erreurJournalisee = [];
  const consoleError = console.error;
  console.error = (...args) => erreurJournalisee.push(args);
  try {
    const imprevu = reponse();
    errorHandler(new Error('SELECT * FROM users a échoué : disque plein'), requete, imprevu, () => {});
    assert.equal(imprevu.code, 500);
    assert.equal(imprevu.corps.error, 'Erreur interne du serveur.');

    const delibere = reponse();
    errorHandler(httpError(503, 'Service indisponible : réessayez.'), requete, delibere, () => {});
    assert.equal(delibere.code, 503);
    assert.equal(delibere.corps.error, 'Service indisponible : réessayez.');
  } finally {
    console.error = consoleError;
  }

  assert.equal(erreurJournalisee.length, 2, 'les deux 5xx restent journalisés côté serveur');
});
