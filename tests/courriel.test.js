/**
 * Configuration du serveur d'envoi de courriels.
 *
 * Ces réglages vivaient dans un fichier `.env` que l'application empaquetée
 * cherchait à l'intérieur de sa propre archive, en lecture seule et d'où le
 * fichier était par ailleurs exclu : l'envoi de courriels était inconfigurable
 * sur toute installation réelle, et aucun test ne couvrait ce service.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer, MOT_DE_PASSE } = require('./helpers.js');
const { reset: resetRateLimit } = require('../rateLimit.js');
const { chiffrer, dechiffrer, estProtege, PREFIXE_COFFRE } = require('../secretStorage.js');
const { chargerConfiguration, reinitialiser, PORT_DEFAUT } = require('../emailService.js');

/** Démarre un serveur avec un administrateur connecté. */
async function withAdmin(t) {
  resetRateLimit();
  reinitialiser();
  const api = await startTestServer();
  t.after(() => api.close());

  const res = await api.post('/api/auth/setup', { username: 'patron', password: MOT_DE_PASSE });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return api;
}

/** Corps minimal accepté par PUT /api/settings, qui exige la raison sociale. */
function parametres(extra = {}) {
  return { entreprise_nom: 'Safehill', taxe_1_taux: 0.05, taxe_2_taux: 0.09975, ...extra };
}

/** Isole les variables d'environnement d'un test. */
function sansEnvironnement(t) {
  const memoire = {};
  for (const cle of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS']) {
    memoire[cle] = process.env[cle];
    delete process.env[cle];
  }
  t.after(() => {
    for (const [cle, valeur] of Object.entries(memoire)) {
      if (valeur === undefined) delete process.env[cle];
      else process.env[cle] = valeur;
    }
    reinitialiser();
  });
}

// --- Chiffrement au repos ---------------------------------------------------

test('un secret chiffré se relit à l\'identique', () => {
  const secret = 'mot-de-passe-application-1234';
  const enregistre = chiffrer(secret);

  assert.notEqual(enregistre, secret, 'le secret ne doit jamais être stocké tel quel');
  assert.equal(dechiffrer(enregistre), secret);
});

test('une valeur vide reste vide et n\'est pas déclarée protégée', () => {
  assert.equal(chiffrer(''), '');
  assert.equal(chiffrer(null), '');
  assert.equal(chiffrer(undefined), '');
  assert.equal(dechiffrer(''), '');
  assert.equal(estProtege(''), false);
});

test('un secret chiffré par le coffre d\'une autre machine est illisible, sans planter', () => {
  // Hors Electron, aucun coffre n'existe : c'est exactement la situation d'une
  // base restaurée sur un autre poste. Le mot de passe doit être traité comme
  // absent — et non produire une exception au moment d'envoyer une facture.
  const venuDAilleurs = `${PREFIXE_COFFRE}bG9yZW0taXBzdW0tbm9uLWRlY2hpZmZyYWJsZQ==`;

  assert.equal(dechiffrer(venuDAilleurs), '');
  assert.equal(estProtege(venuDAilleurs), true);
});

// --- Résolution de la configuration -----------------------------------------

test('les paramètres l\'emportent sur les variables d\'environnement', async (t) => {
  sansEnvironnement(t);
  const api = await withAdmin(t);

  process.env.SMTP_HOST = 'environnement.exemple.ca';
  process.env.SMTP_USER = 'environnement@exemple.ca';
  process.env.SMTP_PASS = 'secret-environnement';

  await api.put('/api/settings', parametres({
    smtp_host: 'parametres.exemple.ca',
    smtp_port: 465,
    smtp_user: 'parametres@exemple.ca',
    smtp_pass: 'secret-parametres'
  }));

  const config = await chargerConfiguration(api.db);

  // C'est l'interface qui fait foi : une variable système oubliée ne doit pas
  // écraser en silence ce que l'utilisateur vient de saisir.
  assert.equal(config.source, 'parametres');
  assert.equal(config.host, 'parametres.exemple.ca');
  assert.equal(config.port, 465);
  assert.equal(config.pass, 'secret-parametres');
});

test('l\'environnement sert de repli quand les paramètres sont vides', async (t) => {
  sansEnvironnement(t);
  const api = await withAdmin(t);

  process.env.SMTP_HOST = 'repli.exemple.ca';
  process.env.SMTP_USER = 'repli@exemple.ca';
  process.env.SMTP_PASS = 'secret-repli';

  const config = await chargerConfiguration(api.db);

  assert.equal(config.source, 'environnement');
  assert.equal(config.host, 'repli.exemple.ca');
  assert.equal(config.port, PORT_DEFAUT, 'le port par défaut doit être renseigné');
});

test('le mot de passe d\'exemple livré dans .env.exemple ne compte pas', async (t) => {
  sansEnvironnement(t);
  const api = await withAdmin(t);

  process.env.SMTP_HOST = 'exemple.ca';
  process.env.SMTP_USER = 'moi@exemple.ca';
  process.env.SMTP_PASS = 'VOTRE_MOT_DE_PASSE_ICI';

  const config = await chargerConfiguration(api.db);
  assert.equal(config.pass, '', 'la valeur d\'exemple n\'est pas un mot de passe');
});

// --- L'API ne divulgue jamais le mot de passe -------------------------------

test('le mot de passe d\'envoi ne ressort jamais de l\'API', async (t) => {
  sansEnvironnement(t);
  const api = await withAdmin(t);

  await api.put('/api/settings', parametres({
    smtp_host: 'smtp.exemple.ca',
    smtp_user: 'moi@exemple.ca',
    smtp_pass: 'ne-doit-jamais-ressortir'
  }));

  const res = await api.get('/api/settings');
  assert.equal(res.status, 200);

  const serialise = JSON.stringify(res.data);
  assert.doesNotMatch(serialise, /ne-doit-jamais-ressortir/);
  assert.equal(res.data.smtp_pass_chiffre, undefined);
  assert.equal(res.data.smtp_pass, undefined);

  // L'interface doit pouvoir afficher « un mot de passe est enregistré » sans
  // que ce mot de passe transite.
  assert.equal(res.data.smtp_pass_defini, true);
  assert.equal(res.data.smtp_host, 'smtp.exemple.ca');
});

test('smtp_pass_defini vaut faux tant que rien n\'est enregistré', async (t) => {
  sansEnvironnement(t);
  const api = await withAdmin(t);

  await api.put('/api/settings', parametres());
  const res = await api.get('/api/settings');

  assert.equal(res.data.smtp_pass_defini, false);
});

// --- Conservation et effacement ---------------------------------------------

test('enregistrer les paramètres sans le mot de passe ne l\'efface pas', async (t) => {
  sansEnvironnement(t);
  const api = await withAdmin(t);

  await api.put('/api/settings', parametres({
    smtp_host: 'smtp.exemple.ca',
    smtp_user: 'moi@exemple.ca',
    smtp_pass: 'a-conserver'
  }));

  // Le formulaire ne renvoie jamais le mot de passe : modifier un taux de taxe
  // ne doit pas couper l'envoi de courriels.
  await api.put('/api/settings', parametres({
    taxe_1_taux: 0.06,
    smtp_host: 'smtp.exemple.ca',
    smtp_user: 'moi@exemple.ca'
  }));

  const config = await chargerConfiguration(api.db);
  assert.equal(config.pass, 'a-conserver');
  assert.equal(config.source, 'parametres');
});

test('vider le serveur d\'envoi efface le mot de passe enregistré', async (t) => {
  sansEnvironnement(t);
  const api = await withAdmin(t);

  await api.put('/api/settings', parametres({
    smtp_host: 'smtp.exemple.ca',
    smtp_user: 'moi@exemple.ca',
    smtp_pass: 'a-effacer'
  }));

  await api.put('/api/settings', parametres({ smtp_host: '', smtp_user: '' }));

  // Garder un secret pour un compte retiré n'a aucun usage, et le laisserait
  // dans chaque sauvegarde produite ensuite.
  const ligne = await api.db.get('SELECT smtp_pass_chiffre FROM settings LIMIT 1');
  assert.equal(ligne.smtp_pass_chiffre, '');

  const res = await api.get('/api/settings');
  assert.equal(res.data.smtp_pass_defini, false);
});

// --- Validation --------------------------------------------------------------

test('un port hors bornes est refusé', async (t) => {
  const api = await withAdmin(t);

  for (const port of [0, 70000, 2.5, 'abc']) {
    const res = await api.put('/api/settings', parametres({ smtp_port: port }));
    assert.equal(res.status, 400, `port ${port} : ${JSON.stringify(res.data)}`);
  }
});

test('un port absent laisse le réglage inchangé', async (t) => {
  sansEnvironnement(t);
  const api = await withAdmin(t);

  await api.put('/api/settings', parametres({ smtp_port: 2525 }));
  await api.put('/api/settings', parametres({ smtp_host: 'smtp.exemple.ca' }));

  const ligne = await api.db.get('SELECT smtp_port FROM settings LIMIT 1');
  assert.equal(ligne.smtp_port, 2525);
});

// --- Journal d'audit ---------------------------------------------------------

test('le journal d\'audit consigne le serveur mais jamais le mot de passe', async (t) => {
  sansEnvironnement(t);
  const api = await withAdmin(t);

  await api.put('/api/settings', parametres({
    smtp_host: 'smtp.exemple.ca',
    smtp_user: 'moi@exemple.ca',
    smtp_pass: 'jamais-dans-le-journal'
  }));

  const res = await api.get('/api/audit');
  assert.equal(res.status, 200, JSON.stringify(res.data));

  const serialise = JSON.stringify(res.data);
  assert.doesNotMatch(serialise, /jamais-dans-le-journal/);
  assert.doesNotMatch(serialise, /smtp_pass/);

  // Le changement de serveur, lui, doit être traçable : il détourne les
  // courriels de l'entreprise vers un autre compte.
  assert.match(serialise, /smtp_host/);
});

// --- Courriel de test --------------------------------------------------------

test('le courriel de test refuse une adresse invalide', async (t) => {
  sansEnvironnement(t);
  const api = await withAdmin(t);

  await api.put('/api/settings', parametres({
    smtp_host: 'smtp.exemple.ca',
    smtp_user: 'moi@exemple.ca',
    smtp_pass: 'secret'
  }));

  const res = await api.post('/api/settings/smtp/test', { destinataire: 'pas-une-adresse' });
  assert.equal(res.status, 400, JSON.stringify(res.data));
});

test('le courriel de test réclame une configuration avant toute connexion', async (t) => {
  sansEnvironnement(t);
  const api = await withAdmin(t);

  await api.put('/api/settings', parametres({ entreprise_email: 'patron@exemple.ca' }));

  const res = await api.post('/api/settings/smtp/test', {});
  assert.equal(res.status, 503, JSON.stringify(res.data));
  assert.match(res.data.error, /Paramètres/);
});

test('le courriel de test est réservé à l\'administrateur', async (t) => {
  sansEnvironnement(t);
  const api = await withAdmin(t);

  await api.post('/api/users', {
    username: 'employe', password: MOT_DE_PASSE, role: 'employe'
  });
  api.clearCookie();
  await api.post('/api/auth/login', { username: 'employe', password: MOT_DE_PASSE });

  const res = await api.post('/api/settings/smtp/test', { destinataire: 'a@exemple.ca' });
  assert.equal(res.status, 403, JSON.stringify(res.data));
});
