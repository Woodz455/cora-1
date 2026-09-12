/**
 * Profils de dossier et premiers pas.
 *
 * Un profil règle des valeurs de départ et l'ordre des premiers pas ; il ne
 * retire rien. Ces tests vérifient que les valeurs de départ sont bien posées,
 * que la liste des premiers pas se coche d'elle-même d'après le contenu du
 * dossier, et que rien de tout cela ne dépend d'un écran caché.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { startTestServer, MOT_DE_PASSE } = require('./helpers.js');
const { reset: resetRateLimit } = require('../rateLimit.js');
const { PROFILS, PARCOURS, PARCOURS_SANS_PROFIL, ETAPES } = require('../profils.js');
const { ouvrirEntreprise } = require('../companyStore.js');

const ANNEE = new Date().getFullYear();

async function avecAdmin(t) {
  resetRateLimit();
  const api = await startTestServer();
  t.after(() => api.close());
  const res = await api.post('/api/auth/setup', { username: 'patron', password: MOT_DE_PASSE });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return api;
}

/** Crée un dossier avec un profil ; la session bascule dessus. */
async function dossier(api, profil, nom = 'Nouveau dossier') {
  const res = await api.post('/api/entreprises', { nom, profil });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data.entreprise;
}

async function client(api, corps = {}) {
  const res = await api.post('/api/clients', {
    nom_entreprise: 'Client', email: 'client@exemple.ca', province: 'QC', ...corps
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data.client;
}

/** Base SQLite du dossier ouvert, pour y semer ce que l'API ne crée pas. */
async function baseDe(api, entrepriseId) {
  const { chemin } = await api.comptesDb.get('SELECT chemin FROM entreprises WHERE id = ?', [entrepriseId]);
  return ouvrirEntreprise(chemin);
}

/* --- Les définitions --- */

test('les deux copies des profils restent alignées', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'client', 'src', 'profils.js'), 'utf8');
  for (const { valeur, libelle } of PROFILS) {
    assert.ok(
      source.includes(`valeur: '${valeur}', libelle: '${libelle}'`),
      `le profil ${valeur} doit être identique côté interface`
    );
  }
});

test('chaque parcours ne renvoie qu\'à des étapes définies, et toutes mènent à la sauvegarde', () => {
  for (const [profil, cles] of Object.entries({ ...PARCOURS, aucun: PARCOURS_SANS_PROFIL })) {
    for (const cle of cles) {
      const etape = ETAPES[cle];
      assert.ok(etape, `${profil} : étape ${cle} inconnue`);
      assert.ok(etape.titre && etape.detail && etape.vue, `${profil} : étape ${cle} incomplète`);
      assert.equal(typeof etape.fait, 'function');
    }
    assert.equal(cles[cles.length - 1], 'sauvegarde', `${profil} : la sauvegarde manque à tout le monde`);
  }
  assert.deepEqual(Object.keys(PARCOURS).sort(), PROFILS.map((p) => p.valeur).sort());
});

/* --- Les valeurs de départ --- */

test('un travailleur autonome se fait payer à la réception, une PME à trente jours', async (t) => {
  const api = await avecAdmin(t);

  await dossier(api, 'autonome', 'Studio Lumière');
  let reglages = (await api.get('/api/settings')).data;
  assert.equal(reglages.profil, 'autonome');
  assert.equal(reglages.conditions_defaut, 'reception');

  // La fiche créée sans terme reçoit celui du dossier ; un terme explicite l'emporte.
  assert.equal((await client(api)).conditions_paiement, 'reception');
  assert.equal((await client(api, { conditions_paiement: 'net60', email: 'b@exemple.ca' })).conditions_paiement, 'net60');

  await dossier(api, 'pme', 'Plomberie Tremblay');
  reglages = (await api.get('/api/settings')).data;
  assert.equal(reglages.profil, 'pme');
  assert.equal(reglages.conditions_defaut, 'net30');
  assert.equal((await client(api)).conditions_paiement, 'net30');
});

test('un dossier neuf porte son nom dès sa création, sur une seule ligne de paramètres', async (t) => {
  const api = await avecAdmin(t);
  const cree = await dossier(api, 'autonome', 'Studio Lumière');

  // Deux lignes de paramètres, et toute lecture tombait sur la première, au
  // nom vide : le dossier s'appelait « Votre entreprise » sur ses factures.
  const db = await baseDe(api, cree.id);
  const lignes = await db.all('SELECT entreprise_nom, profil FROM settings');
  assert.equal(lignes.length, 1);
  assert.deepEqual(lignes[0], { entreprise_nom: 'Studio Lumière', profil: 'autonome' });
  assert.equal((await api.get('/api/settings')).data.entreprise_nom, 'Studio Lumière');
});

test('un dossier créé sans profil garde le comportement d\'avant', async (t) => {
  const api = await avecAdmin(t);

  const res = await api.post('/api/entreprises', { nom: 'Sans profil' });
  assert.equal(res.status, 201);

  const reglages = (await api.get('/api/settings')).data;
  assert.equal(reglages.profil, null);
  assert.equal(reglages.conditions_defaut, null);
  assert.equal((await client(api)).conditions_paiement, 'net30');
});

test('un profil inconnu est refusé, et aucun dossier n\'est créé', async (t) => {
  const api = await avecAdmin(t);
  const avant = (await api.get('/api/entreprises')).data.entreprises.length;

  const res = await api.post('/api/entreprises', { nom: 'Douteux', profil: 'multinationale' });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /Profil inconnu/);

  assert.equal((await api.get('/api/entreprises')).data.entreprises.length, avant);
});

test('la première configuration nomme le dossier et pose son profil', async (t) => {
  resetRateLimit();
  const api = await startTestServer();
  t.after(() => api.close());
  // Sans dossier préexistant : c'est le cas d'une installation neuve.
  await api.comptesDb.run('DELETE FROM entreprises');

  const refus = await api.post('/api/auth/setup', {
    username: 'patron', password: MOT_DE_PASSE, entreprise: 'Studio Lumière', profil: 'galaxie'
  });
  assert.equal(refus.status, 400);
  // Refusé avant d'écrire : la configuration reste entièrement à faire.
  assert.equal((await api.get('/api/auth/setup-status')).data.setupRequired, true);

  const res = await api.post('/api/auth/setup', {
    username: 'patron', password: MOT_DE_PASSE, entreprise: 'Studio Lumière', profil: 'startup'
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.entreprise.nom, 'Studio Lumière');

  const reglages = (await api.get('/api/settings')).data;
  assert.equal(reglages.entreprise_nom, 'Studio Lumière');
  assert.equal(reglages.profil, 'startup');
  assert.equal(reglages.conditions_defaut, 'net30');
});

/* --- Les premiers pas --- */

test('les premiers pas sont réservés à l\'administration', async (t) => {
  const api = await avecAdmin(t);
  await api.post('/api/users', { username: 'compta', password: MOT_DE_PASSE, role: 'comptable' });
  await api.post('/api/auth/login', { username: 'compta', password: MOT_DE_PASSE });

  assert.equal((await api.get('/api/demarrage')).status, 403);
  assert.equal((await api.post('/api/demarrage/masquer', {})).status, 403);
});

test('un dossier sans profil reçoit l\'essentiel, rien de coché', async (t) => {
  const api = await avecAdmin(t);

  const res = await api.get('/api/demarrage');
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.profil, null);
  assert.equal(res.data.masque, false);
  assert.deepEqual(res.data.etapes.map((e) => e.cle), PARCOURS_SANS_PROFIL);
  assert.ok(res.data.etapes.every((e) => e.fait === false));
});

test('les étapes se cochent d\'elles-mêmes d\'après le contenu du dossier', async (t) => {
  const api = await avecAdmin(t);
  const cree = await dossier(api, 'pme');

  const etat = (await api.get('/api/demarrage')).data;
  assert.deepEqual(etat.profil, { valeur: 'pme', libelle: 'PME établie' });
  assert.deepEqual(etat.etapes.map((e) => e.cle), PARCOURS.pme);
  const faites = async () => Object.fromEntries(
    (await api.get('/api/demarrage')).data.etapes.map((e) => [e.cle, e.fait])
  );
  assert.deepEqual(await faites(), {
    coordonnees: false, comptes: false, client: false, facture: false, banque: false, sauvegarde: false
  });

  // Les coordonnées : l'adresse suffit, un autonome n'a pas toujours de numéros de taxes.
  await api.put('/api/settings', { entreprise_nom: 'Plomberie', entreprise_adresse: '1, rue Test' });
  // L'équipe : un second accès au dossier.
  await api.post('/api/users', { username: 'employe1', password: MOT_DE_PASSE, role: 'employe' });
  // Le premier client et la première facture.
  const c = await client(api);
  await api.post('/api/factures', {
    client_id: c.id, date_emission: '2026-03-01',
    lignes: [{ description: 'Travaux', quantite: 1, prix_unitaire: 100 }]
  });
  // Un relevé bancaire, semé directement : l'import passe par un fichier.
  const db = await baseDe(api, cree.id);
  await db.run(
    "INSERT INTO transactions_bancaires (date_transaction, description, montant) VALUES ('2026-03-05', 'Dépôt', 100)"
  );
  // La sauvegarde : un dossier désigné. Le formulaire renvoie toujours tous
  // les champs texte : un champ absent est enregistré vide, d'où l'adresse.
  await api.put('/api/settings', {
    entreprise_nom: 'Plomberie', entreprise_adresse: '1, rue Test',
    sauvegarde_dossier: 'C:\\Users\\moi\\OneDrive\\Clora'
  });

  assert.deepEqual(await faites(), {
    coordonnees: true, comptes: true, client: true, facture: true, banque: true, sauvegarde: true
  });
});

test('le travailleur autonome est mené au taux kilométrique, la startup aux abonnements', async (t) => {
  const api = await avecAdmin(t);

  await dossier(api, 'autonome');
  let etat = (await api.get('/api/demarrage')).data;
  assert.deepEqual(etat.etapes.map((e) => e.cle), PARCOURS.autonome);
  const km = etat.etapes.find((e) => e.cle === 'kilometrage');
  assert.equal(km.fait, false);
  assert.equal(km.vue, 'parametres');
  assert.equal(km.ancre, 'section-kilometrage');

  const taux = await api.put('/api/settings/taux-kilometriques', {
    annee: ANNEE, taux_1: 0.72, taux_2: 0.66, seuil_km: 5000
  });
  assert.equal(taux.status, 200, JSON.stringify(taux.data));
  etat = (await api.get('/api/demarrage')).data;
  assert.equal(etat.etapes.find((e) => e.cle === 'kilometrage').fait, true);

  await dossier(api, 'startup');
  etat = (await api.get('/api/demarrage')).data;
  assert.deepEqual(etat.etapes.map((e) => e.cle), PARCOURS.startup);
  assert.equal(etat.etapes.find((e) => e.cle === 'paiement_en_ligne').fait, false);
  assert.equal(etat.etapes.find((e) => e.cle === 'abonnement').vue, 'abonnements');
});

test('la liste se masque, et réapparaît quand le profil change', async (t) => {
  const api = await avecAdmin(t);
  await dossier(api, 'autonome');

  assert.equal((await api.post('/api/demarrage/masquer', {})).status, 200);
  assert.equal((await api.get('/api/demarrage')).data.masque, true);

  // Réenregistrer le même profil ne rouvre rien.
  await api.put('/api/settings', { entreprise_nom: 'Studio', profil: 'autonome' });
  assert.equal((await api.get('/api/demarrage')).data.masque, true);

  // En choisir un autre montre le nouveau chemin.
  await api.put('/api/settings', { entreprise_nom: 'Studio', profil: 'pme' });
  const etat = (await api.get('/api/demarrage')).data;
  assert.equal(etat.masque, false);
  assert.deepEqual(etat.etapes.map((e) => e.cle), PARCOURS.pme);
});

/* --- Les paramètres --- */

test('le profil et les conditions par défaut se règlent dans les paramètres, et sont validés', async (t) => {
  const api = await avecAdmin(t);

  assert.equal((await api.put('/api/settings', { entreprise_nom: 'E', profil: 'holding' })).status, 400);
  assert.equal((await api.put('/api/settings', { entreprise_nom: 'E', conditions_defaut: 'net45' })).status, 400);

  const res = await api.put('/api/settings', { entreprise_nom: 'E', profil: 'startup', conditions_defaut: 'net15' });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.settings.profil, 'startup');
  assert.equal(res.data.settings.conditions_defaut, 'net15');

  // Le réglage s'applique aux fiches suivantes.
  assert.equal((await client(api)).conditions_paiement, 'net15');

  // Un enregistrement qui ne parle pas du profil le laisse en place.
  await api.put('/api/settings', { entreprise_nom: 'E', entreprise_email: 'e@exemple.ca' });
  const reglages = (await api.get('/api/settings')).data;
  assert.equal(reglages.profil, 'startup');
  assert.equal(reglages.conditions_defaut, 'net15');
});
