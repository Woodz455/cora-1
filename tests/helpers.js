/**
 * Utilitaires partagés par les tests : base jetable et client HTTP authentifié.
 */

process.env.NODE_ENV = 'test';
// Secret fixe, pour ne pas écrire de fichier de secret pendant les tests.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'secret-de-test-uniquement-32-caracteres-minimum';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { initDb } = require('../database.js');

/** Crée une base neuve dans un répertoire temporaire. */
async function createTestDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clora-test-'));
  const dbPath = path.join(dir, 'test.sqlite');
  const db = await initDb(dbPath);

  // Le registre a besoin du chemin pour enregistrer ce fichier comme dossier.
  db.__dbPath = dbPath;
  db.__cleanup = async () => {
    // Le registre a pu la fermer avant nous ; ce qui compte est que le
    // répertoire temporaire disparaisse.
    try {
      await db.close();
    } catch (e) {
      // déjà fermée
    }
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return db;
}

/** Insère un client et retourne son identifiant. */
async function insertClient(db, { nom = 'Client Test', province = 'QC', email = 'test@exemple.ca', langue = 'fr' } = {}) {
  const result = await db.run(
    'INSERT INTO clients (nom_entreprise, nom_contact, email, adresse, langue, province) VALUES (?, ?, ?, ?, ?, ?)',
    [nom, 'Contact', email, '1 rue Test', langue, province]
  );
  return result.lastID;
}

/** Insère les paramètres d'entreprise. */
async function insertSettings(db, overrides = {}) {
  const existant = await db.get('SELECT id FROM settings LIMIT 1');
  const valeurs = {
    entreprise_nom: 'Entreprise Test',
    taxe_1_nom: 'TPS',
    taxe_1_taux: 0.05,
    taxe_2_nom: 'TVQ',
    taxe_2_taux: 0.09975,
    ...overrides
  };
  if (existant) {
    await db.run(
      'UPDATE settings SET entreprise_nom = ?, taxe_1_nom = ?, taxe_1_taux = ?, taxe_2_nom = ?, taxe_2_taux = ? WHERE id = ?',
      [valeurs.entreprise_nom, valeurs.taxe_1_nom, valeurs.taxe_1_taux, valeurs.taxe_2_nom, valeurs.taxe_2_taux, existant.id]
    );
  }
}

/**
 * Démarre l'application sur un port libre et retourne un client HTTP qui
 * conserve les cookies de session.
 */
async function startTestServer(options = {}) {
  const { createApp } = require('../server.js');
  const { ouvrirComptes, enregistrerConnexion } = require('../companyStore.js');

  const db = await createTestDb();

  // Les dossiers créés par l'API atterrissent dans le répertoire de données ;
  // sans cette redirection, les tests les sèmeraient dans le dépôt.
  process.env.CLORA_DATA_DIR = path.dirname(db.__dbPath);

  // Les tests exercent le mode multi-dossier, celui qui est livré. Les faire
  // tourner sur le mode mono aurait vérifié un chemin que personne n'emprunte.
  const comptesDb = await ouvrirComptes(path.join(path.dirname(db.__dbPath), 'comptes.sqlite'));
  await comptesDb.run(
    'INSERT INTO entreprises (nom, chemin) VALUES (?, ?)',
    [options.entreprise || 'Entreprise Test', db.__dbPath]
  );
  // Sans cela, les routes ouvriraient une seconde connexion sur le même
  // fichier, et les assertions portant sur `api.db` observeraient autre chose
  // que ce que l'API vient d'écrire.
  enregistrerConnexion(db.__dbPath, db);

  const app = createApp(db, { comptesDb });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  let cookie = '';

  /** Effectue une requête JSON en conservant le cookie de session. */
  async function request(method, url, body, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (cookie && !options.noCookie) headers.Cookie = cookie;
    if (options.headers) Object.assign(headers, options.headers);

    const res = await fetch(`${base}${url}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of setCookie) {
      const [pair] = c.split(';');
      if (pair.startsWith('token=')) cookie = pair.endsWith('token=') ? '' : pair;
    }

    const texte = await res.text();
    let data = null;
    try {
      data = texte ? JSON.parse(texte) : null;
    } catch (e) {
      data = texte;
    }
    return { status: res.status, data };
  }

  return {
    db,
    base,
    request,
    get: (url, options) => request('GET', url, undefined, options),
    post: (url, body, options) => request('POST', url, body, options),
    put: (url, body, options) => request('PUT', url, body, options),
    // Un DELETE peut porter un corps — l'annulation d'un paiement transmet son
    // motif — et le client réel en envoie un (`client/src/api.js`). L'ignorer
    // ici faisait croire à des tests qu'ils vérifiaient un motif jamais transmis.
    del: (url, body, options) => request('DELETE', url, body, options),
    setCookie: (value) => { cookie = value; },
    // Nécessaire aux réponses qui ne sont pas du JSON — un CSV téléchargé, par
    // exemple — que `request` ne sait pas rendre telles quelles.
    cookie: () => cookie,
    clearCookie: () => { cookie = ''; },
    comptesDb,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      // Le registre garde les connexions ouvertes d'un test à l'autre : sans
      // purge, le test suivant réutiliserait la base du précédent.
      const { fermerTout } = require('../companyStore.js');
      await fermerTout();
      await comptesDb.close();
      await db.__cleanup();
    }
  };
}

/** Mot de passe respectant la longueur minimale exigée. */
const MOT_DE_PASSE = 'motdepasse-test';

module.exports = { createTestDb, insertClient, insertSettings, startTestServer, MOT_DE_PASSE };
