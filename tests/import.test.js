/**
 * Import de clients et d'articles depuis un tableur.
 *
 * Les fichiers `.xlsx` de `tests/fixtures/` ont été produits par un véritable
 * outil de bureautique, pas par le lecteur qu'ils servent à éprouver : un
 * lecteur validé contre du XML que j'aurais écrit moi-même ne prouverait que ma
 * cohérence avec moi-même.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { startTestServer, MOT_DE_PASSE } = require('./helpers.js');
const { reset: resetRateLimit } = require('../rateLimit.js');
const { lireClasseur } = require('../xlsxReader.js');
const {
  analyserCSV, detecterSeparateur, deviner, preparerClients, preparerCatalogue, montant
} = require('../importService.js');

const FIXTURES = path.join(__dirname, 'fixtures');
const classeur = (nom) => fs.readFileSync(path.join(FIXTURES, nom));

async function withAdmin(t) {
  resetRateLimit();
  const api = await startTestServer();
  t.after(async () => { await api.close(); });
  const res = await api.post('/api/auth/setup', { username: 'patron', password: MOT_DE_PASSE });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return api;
}

/** Encode un contenu comme le fait le navigateur avant l'envoi. */
const enBase64 = (contenu) => Buffer.from(contenu).toString('base64');

// --- Lecture d'un classeur Excel ---------------------------------------------

test('un classeur Excel réel est lu, accents et guillemets compris', () => {
  const lignes = lireClasseur(classeur('clients.xlsx'));

  assert.equal(lignes[0][0], "Nom de l'entreprise");
  assert.equal(lignes[1][0], 'Plomberie Tremblay');
  assert.equal(lignes[2][0], 'Éléctricité Côté');
  assert.equal(lignes[3][0], 'Boulangerie « Chez Rémi »');
});

test('une cellule vide ne décale pas les colonnes suivantes', () => {
  const lignes = lireClasseur(classeur('clients.xlsx'));

  // Excel n'écrit pas les cellules vides : c'est la référence de chaque cellule
  // qui donne sa colonne. S'en remettre à l'ordre d'apparition ferait remonter
  // « ON » d'un cran et importerait la province dans le champ du contact.
  assert.equal(lignes[2][2], '', 'le contact est vide sur cette ligne');
  assert.equal(lignes[2][3], 'ON', 'la province doit rester en quatrième colonne');
});

test('une formule rend la valeur mise en cache, et une chaîne en ligne est lue', () => {
  const lignes = lireClasseur(classeur('cas-limites.xlsx'));

  assert.equal(lignes[1][6], '2', 'le résultat en cache de « =1+1 »');

  const derniere = lignes[lignes.length - 1];
  assert.equal(derniere[0], 'Ébénisterie en ligne');
  assert.equal(derniere[1], 'ebene@exemple.ca');
});

test('un fichier qui n\'est pas un classeur est refusé clairement', () => {
  assert.throws(
    () => lireClasseur(Buffer.from('ceci est du texte, pas une archive')),
    /pas un classeur Excel valide/
  );
});

// --- Lecture CSV --------------------------------------------------------------

test('le séparateur se devine hors guillemets', () => {
  assert.equal(detecterSeparateur('nom;courriel;province'), ';');
  assert.equal(detecterSeparateur('nom,courriel,province'), ',');
  // Une raison sociale contenant des virgules ne doit pas emporter la décision.
  assert.equal(detecterSeparateur('"Tremblay, Roy et associés";courriel'), ';');
});

test('un champ cité peut contenir séparateur, saut de ligne et guillemets', () => {
  const csv = 'nom;adresse\r\n"Tremblay, Roy";"12 rue A\nbureau 3"\r\n"Chez ""Rémi""";8 av. B\r\n';
  const lignes = analyserCSV(csv);

  assert.equal(lignes.length, 3);
  assert.equal(lignes[1][0], 'Tremblay, Roy');
  assert.equal(lignes[1][1], '12 rue A\nbureau 3');
  assert.equal(lignes[2][0], 'Chez "Rémi"');
});

test('la marque d\'ordre d\'octets d\'Excel ne colle pas au premier en-tête', () => {
  const lignes = analyserCSV('﻿nom;courriel\r\nTremblay;a@b.ca\r\n');
  assert.equal(lignes[0][0], 'nom', "sans quoi l'en-tête devient méconnaissable");
});

test('les lignes vides de fin de fichier sont écartées', () => {
  const lignes = analyserCSV('nom;courriel\r\nTremblay;a@b.ca\r\n\r\n;\r\n');
  assert.equal(lignes.length, 2);
});

// --- Correspondance des colonnes ---------------------------------------------

test('les colonnes sont devinées, accents et anglais compris', () => {
  const correspondance = deviner(
    ['Raison sociale', 'E-Mail', 'Province', 'Colonne inconnue'],
    'clients'
  );

  assert.equal(correspondance.nom_entreprise, 0);
  assert.equal(correspondance.email, 1);
  assert.equal(correspondance.province, 2);
  assert.equal(correspondance.adresse, undefined, 'aucune colonne ne correspond');
});

test('une même colonne n\'est pas attribuée deux fois', () => {
  const correspondance = deviner(['Nom', 'Name'], 'clients');
  const utilisees = Object.values(correspondance);
  assert.equal(new Set(utilisees).size, utilisees.length);
});

// --- Validation ligne par ligne ----------------------------------------------

test('une ligne invalide est refusée avec son numéro et son motif', () => {
  const lignes = [
    ['Plomberie Tremblay', 'marc@tremblay.ca', 'QC'],
    ['Sans courriel', '', 'QC'],
    ['', 'orphelin@exemple.ca', 'QC'],
    ['Province inventée', 'x@exemple.ca', 'ZZ']
  ];
  const { valides, rejets } = preparerClients(lignes, { nom_entreprise: 0, email: 1, province: 2 });

  assert.equal(valides.length, 1);
  assert.equal(rejets.length, 3);

  // Le numéro compte l'en-tête, comme le fait le tableur de l'utilisateur :
  // lui donner un rang décalé de un le renverrait à la mauvaise ligne.
  assert.equal(rejets[0].ligne, 3);
  assert.match(rejets[0].motif, /courriel/i);
  assert.match(rejets[2].motif, /Province/i);
});

test('un courriel présent deux fois dans le fichier est signalé', () => {
  const lignes = [
    ['Premier', 'meme@exemple.ca'],
    ['Second', 'MEME@exemple.ca']
  ];
  const { valides, rejets } = preparerClients(lignes, { nom_entreprise: 0, email: 1 });

  assert.equal(valides.length, 1);
  assert.match(rejets[0].motif, /deux fois/);
});

test('un prix vide est refusé et non traité comme gratuit', () => {
  // `Number('')` vaut zéro : sans garde, l'article entrerait au catalogue à
  // 0,00 $ et ne se découvrirait qu'au moment de facturer.
  assert.equal(montant(''), null);

  const { valides, rejets } = preparerCatalogue(
    [['Installation', ''], ['Réparation', '1 234,56 $'], ['Négatif', '-5']],
    { nom: 0, prix_unitaire: 1 }
  );

  assert.equal(valides.length, 1);
  assert.equal(valides[0].article.prix_unitaire, 1234.56);
  assert.equal(rejets.length, 2);
});

// --- Bout en bout, par l'API --------------------------------------------------

test('l\'aperçu ne touche pas à la base', async (t) => {
  const api = await withAdmin(t);

  const res = await api.post('/api/import/apercu', {
    modele: 'clients',
    nom_fichier: 'clients.xlsx',
    contenu: enBase64(classeur('clients.xlsx'))
  });

  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.valides, 4);
  assert.equal(res.data.correspondance.nom_entreprise, 0);
  assert.equal(res.data.correspondance.email, 1);

  const restes = await api.db.get('SELECT COUNT(*) AS n FROM clients');
  assert.equal(restes.n, 0, "l'aperçu ne doit rien écrire");
});

test('un import réel verse les clients dans le dossier ouvert', async (t) => {
  const api = await withAdmin(t);

  const apercu = await api.post('/api/import/apercu', {
    modele: 'clients', nom_fichier: 'clients.xlsx', contenu: enBase64(classeur('clients.xlsx'))
  });

  const res = await api.post('/api/import/executer', {
    modele: 'clients',
    nom_fichier: 'clients.xlsx',
    contenu: enBase64(classeur('clients.xlsx')),
    correspondance: apercu.data.correspondance
  });

  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.inseres, 4);

  const clients = await api.db.all('SELECT nom_entreprise, email, province FROM clients ORDER BY nom_entreprise');
  assert.equal(clients.length, 4);
  assert.equal(clients[0].nom_entreprise, 'Boulangerie « Chez Rémi »');
  assert.equal(clients.find((c) => c.email === 'info@cote.ca').province, 'ON');
});

test('réimporter le même fichier n\'entraîne pas de doublons', async (t) => {
  const api = await withAdmin(t);
  const corps = {
    modele: 'clients',
    nom_fichier: 'clients.xlsx',
    contenu: enBase64(classeur('clients.xlsx')),
    correspondance: { nom_entreprise: 0, email: 1, nom_contact: 2, province: 3, adresse: 4 }
  };

  await api.post('/api/import/executer', corps);
  const second = await api.post('/api/import/executer', corps);

  assert.equal(second.data.inseres, 0);
  assert.equal(second.data.ignores, 4);

  const { n } = await api.db.get('SELECT COUNT(*) AS n FROM clients');
  assert.equal(n, 4);
});

test('un fichier sans aucune ligne valide n\'écrit rien', async (t) => {
  const api = await withAdmin(t);

  const csv = 'nom;courriel\r\nSans courriel;\r\nAutre;pas-une-adresse\r\n';
  const res = await api.post('/api/import/executer', {
    modele: 'clients', nom_fichier: 'liste.csv', contenu: enBase64(csv),
    correspondance: { nom_entreprise: 0, email: 1 }
  });

  assert.equal(res.status, 400, JSON.stringify(res.data));
  const { n } = await api.db.get('SELECT COUNT(*) AS n FROM clients');
  assert.equal(n, 0);
});

test('l\'import est consigné au journal d\'audit', async (t) => {
  const api = await withAdmin(t);

  await api.post('/api/import/executer', {
    modele: 'clients', nom_fichier: 'clients.xlsx',
    contenu: enBase64(classeur('clients.xlsx')),
    correspondance: { nom_entreprise: 0, email: 1 }
  });

  const journal = await api.get('/api/audit');
  const serialise = JSON.stringify(journal.data);
  assert.match(serialise, /import/i);
  assert.match(serialise, /clients\.xlsx/);
});

test('un employé ne peut pas importer', async (t) => {
  const api = await withAdmin(t);
  await api.post('/api/users', { username: 'employe', password: MOT_DE_PASSE, role: 'employe' });

  api.clearCookie();
  await api.post('/api/auth/login', { username: 'employe', password: MOT_DE_PASSE });

  const res = await api.post('/api/import/apercu', {
    modele: 'clients', nom_fichier: 'x.csv', contenu: enBase64('nom;courriel\r\nA;a@b.ca\r\n')
  });
  assert.equal(res.status, 403, JSON.stringify(res.data));
});
