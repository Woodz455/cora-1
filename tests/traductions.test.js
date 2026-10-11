/**
 * L'interface en anglais.
 *
 * Le texte français est la clé : `t('Nouvelle facture')` affiche « New
 * invoice » à un utilisateur anglophone, par `client/src/traductions/en.js`.
 * Une clé absente du dictionnaire s'affiche en français, sans erreur : c'est
 * ce qui rend la conversion progressive possible, et c'est aussi ce qui
 * laisserait passer un oubli. Ces tests le refusent.
 *
 * La conversion se fait écran par écran. `ECRANS_TRADUITS` et
 * `SERVEUR_TRADUIT` disent ce qui est déjà fait ; ils s'allongent à chaque
 * étape, jusqu'à couvrir toute l'application.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { startTestServer, MOT_DE_PASSE } = require('./helpers.js');
const { reset: resetRateLimit } = require('../rateLimit.js');
const { traduire } = require('../traductionServeur.js');

const RACINE = path.join(__dirname, '..');
const CLIENT = path.join(RACINE, 'client', 'src');

/** Écrans dont plus aucun texte visible n'est écrit en dur. */
const ECRANS_TRADUITS = [
  'App.jsx',
  'components/Login.jsx',
  'components/Setup.jsx',
  'components/ChoixEntreprise.jsx',
  'components/ChoixProfil.jsx',
  'components/ConfirmationModal.jsx',
  'components/Notification.jsx',
  'components/Pagination.jsx',
  'components/InfoTooltip.jsx',
  'components/SelecteurLangue.jsx'
];

/** Fichiers du serveur dont chaque message a sa traduction anglaise. */
const SERVEUR_TRADUIT = [
  'routes/auth.js',
  'routes/entreprises.js',
  'routes/licence.js',
  'authMiddleware.js',
  'rateLimit.js',
  'httpUtils.js',
  'server.js',
  'profils.js'
];

/**
 * Messages du serveur qui n'atteignent jamais l'utilisateur : une erreur de
 * programmation, levée au démarrage, avant toute requête.
 */
const MESSAGES_INTERNES = new Set([
  'createApp exige un registre de dossiers (options.comptesDb).'
]);

/** Lit le dictionnaire, qui ne contient que des données. */
function dictionnaire() {
  const source = fs.readFileSync(path.join(CLIENT, 'traductions', 'en.js'), 'utf8');
  const corps = source.slice(source.indexOf('export default') + 'export default'.length);
  return new Function(`return (${corps.trim().replace(/;\s*$/, '')});`)();
}

/** Lit une chaîne JavaScript entre apostrophes ou guillemets, à la position donnée. */
function lireChaine(source, i) {
  const quote = source[i];
  if (quote !== "'" && quote !== '"') return null;
  let j = i + 1;
  let brut = '';
  while (j < source.length && source[j] !== quote) {
    if (source[j] === '\\') { brut += source[j] + source[j + 1]; j += 2; continue; }
    brut += source[j];
    j += 1;
  }
  return { valeur: new Function(`return ${quote}${brut}${quote};`)(), fin: j + 1 };
}

/** Clés passées à `t`, `tp`, `traduire` et `traduirePluriel` dans un fichier. */
function clesDe(source) {
  const cles = [];
  for (const m of source.matchAll(/\b(?:t|traduire)\(\s*/g)) {
    const lue = lireChaine(source, m.index + m[0].length);
    if (lue) cles.push(lue.valeur);
  }
  for (const m of source.matchAll(/\b(?:tp|traduirePluriel)\(\s*[^,()]+,\s*/g)) {
    const premiere = lireChaine(source, m.index + m[0].length);
    if (!premiere) continue;
    cles.push(premiere.valeur);
    const virgule = source.slice(premiere.fin).match(/^\s*,\s*/);
    if (virgule) {
      const seconde = lireChaine(source, premiere.fin + virgule[0].length);
      if (seconde) cles.push(seconde.valeur);
    }
  }
  return cles;
}

/** Tous les fichiers de l'interface, hors du moteur et du dictionnaire. */
function fichiersInterface(dossier = CLIENT) {
  const liste = [];
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    const chemin = path.join(dossier, entree.name);
    if (entree.isDirectory()) {
      if (entree.name !== 'traductions' && entree.name !== 'assets') liste.push(...fichiersInterface(chemin));
    } else if (/\.jsx?$/.test(entree.name) && entree.name !== 'i18n.js') {
      liste.push(chemin);
    }
  }
  return liste;
}

/**
 * Textes traduits sans passer par un appel `t` littéral : les libellés de la
 * navigation, déclarés en données dans `App.jsx`, les profils et les rôles.
 */
function clesIndirectes() {
  const cles = ['admin', 'comptable', 'employe', 'Non précisé'];
  const app = fs.readFileSync(path.join(CLIENT, 'App.jsx'), 'utf8');
  const vues = app.slice(app.indexOf('const VUES'), app.indexOf('];', app.indexOf('const VUES')));
  for (const m of vues.matchAll(/\b(?:libelle|titre|sousTitre):\s*/g)) {
    const lue = lireChaine(vues, m.index + m[0].length);
    if (lue) cles.push(lue.valeur);
  }
  const profils = fs.readFileSync(path.join(CLIENT, 'profils.js'), 'utf8');
  for (const m of profils.matchAll(/\b(?:libelle|description):\s*/g)) {
    const lue = lireChaine(profils, m.index + m[0].length);
    if (lue) cles.push(lue.valeur);
  }
  return cles;
}

test('chaque texte traduit de l\'interface a sa traduction anglaise', () => {
  const en = dictionnaire();
  const manquantes = new Set();
  for (const fichier of fichiersInterface()) {
    for (const cle of clesDe(fs.readFileSync(fichier, 'utf8'))) {
      if (!(cle in en)) manquantes.add(`${path.relative(CLIENT, fichier)} : « ${cle} »`);
    }
  }
  for (const cle of clesIndirectes()) {
    if (!(cle in en)) manquantes.add(`(donnée) « ${cle} »`);
  }

  assert.deepEqual([...manquantes], [],
    `Ces textes n'ont pas de traduction dans client/src/traductions/en.js ; un utilisateur `
    + `anglophone les lirait en français.\n    ${[...manquantes].join('\n    ')}`);
});

test('une traduction garde les valeurs de son texte', () => {
  // « Page {page} sur {total} » doit rester « Page {page} of {total} » : une
  // valeur perdue afficherait l'accolade telle quelle.
  const en = dictionnaire();
  const marqueurs = (texte) => [...texte.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  const fautives = Object.entries(en)
    .filter(([fr, anglais]) => typeof anglais !== 'string' || anglais.trim() === ''
      || marqueurs(fr).join() !== marqueurs(anglais).join())
    .map(([fr]) => fr);
  assert.deepEqual(fautives, [], 'traduction vide, ou valeurs différentes du texte français');
});

test('aucun texte visible n\'est écrit en dur dans un écran traduit', () => {
  // Noms propres et sigles, qui ne se traduisent pas.
  const PERMIS = new Set(['Clora', 'FR', 'EN', 'Français', 'English']);
  const fautifs = [];

  for (const relatif of ECRANS_TRADUITS) {
    const brut = fs.readFileSync(path.join(CLIENT, relatif), 'utf8');
    // Les commentaires parlent français, et c'est très bien.
    const source = brut
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    const signaler = (texte) => {
      const net = texte.replace(/\s+/g, ' ').trim();
      // Du code pris entre deux balises (« ); return ( »), pas du texte.
      if (/;|\breturn\b|=>|&&|\|\|/.test(net)) return;
      if (/[A-Za-zÀ-ÿ]{2,}/.test(net) && !PERMIS.has(net)) fautifs.push(`${relatif} : « ${net} »`);
    };

    // Texte entre deux balises : <p>Bonjour</p>.
    for (const m of source.matchAll(/>([^<>{}]*)</g)) signaler(m[1]);
    // Attributs lus par l'utilisateur ou par un lecteur d'écran.
    for (const m of source.matchAll(/\b(?:placeholder|title|aria-label|alt|label)="([^"]*)"/g)) signaler(m[1]);
    // Messages passés directement à l'écran.
    for (const m of source.matchAll(/\b(?:setError|setErreur|notifier)\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)) signaler(m[2]);
  }

  assert.deepEqual(fautifs, [],
    `Ces textes s'affichent en français quelle que soit la langue. Les passer par t().\n    ${fautifs.join('\n    ')}`);
});

/** Messages destinés à l'utilisateur dans un fichier du serveur. */
function messagesServeur(source) {
  const messages = [];
  const debut = /(httpError\(\s*\d+\s*,\s*|\berror:\s*|\bmessage:\s*|new Error\(\s*)/g;
  for (const m of source.matchAll(debut)) {
    let i = m.index + m[0].length;
    const quote = source[i];
    if (!`'"\``.includes(quote)) continue;
    let texte = '';
    i += 1;
    while (i < source.length && source[i] !== quote) {
      if (source[i] === '\\') { texte += source[i + 1]; i += 2; continue; }
      if (quote === '`' && source[i] === '$' && source[i + 1] === '{') {
        let profondeur = 1;
        i += 2;
        while (profondeur) {
          if (source[i] === '{') profondeur += 1;
          if (source[i] === '}') profondeur -= 1;
          i += 1;
        }
        // Une valeur plausible à la place de l'expression : le motif doit la reconnaître.
        texte += '1';
        continue;
      }
      texte += source[i];
      i += 1;
    }
    if (/[a-zà-ü]/.test(texte)) messages.push(texte);
  }
  return messages;
}

test('chaque message du serveur déjà traduit a son équivalent anglais', () => {
  const manquants = [];
  for (const relatif of SERVEUR_TRADUIT) {
    const source = fs.readFileSync(path.join(RACINE, relatif), 'utf8');
    for (const message of messagesServeur(source)) {
      if (MESSAGES_INTERNES.has(message)) continue;
      if (traduire(message, 'en') === message) manquants.push(`${relatif} : « ${message} »`);
    }
  }
  assert.deepEqual(manquants, [],
    `Ces messages partiraient en français vers un utilisateur anglophone. Les ajouter à `
    + `traductionServeur.js.\n    ${manquants.join('\n    ')}`);
});

test('chaque compte garde sa langue, et le serveur répond dans celle de l\'interface', async (t) => {
  resetRateLimit();
  const api = await startTestServer();
  t.after(() => api.close());

  // Le premier lancement enregistre la langue choisie sur son écran.
  const setup = await api.post('/api/auth/setup', { username: 'patron', password: MOT_DE_PASSE, langue: 'en' });
  assert.equal(setup.status, 200, JSON.stringify(setup.data));
  assert.equal((await api.get('/api/auth/check')).data.langue, 'en');

  // Un second compte du même dossier commence en français, et le reste quand
  // le premier change la sienne.
  const creation = await api.post('/api/users', { username: 'comptable', password: MOT_DE_PASSE, role: 'comptable' });
  assert.equal(creation.status, 201, JSON.stringify(creation.data));
  assert.equal((await api.put('/api/auth/langue', { langue: 'fr' })).status, 200);
  assert.equal((await api.put('/api/auth/langue', { langue: 'en' })).status, 200);

  const connexion = await api.post('/api/auth/login', { username: 'comptable', password: MOT_DE_PASSE });
  assert.equal(connexion.data.langue, 'fr', 'la langue d\'un compte ne déborde pas sur un autre');
  assert.equal((await api.put('/api/auth/langue', { langue: 'de' })).status, 400, 'langue inconnue refusée');

  // Retour au premier compte : sa langue n'a pas bougé.
  const retour = await api.post('/api/auth/login', { username: 'patron', password: MOT_DE_PASSE });
  assert.equal(retour.data.langue, 'en');

  // Les messages suivent l'en-tête, y compris avant toute session.
  const refusFr = await api.post('/api/auth/login', { username: 'patron', password: 'mauvais-mot-de-passe' });
  assert.equal(refusFr.data.error, 'Identifiants invalides.');
  const refusEn = await api.post('/api/auth/login', { username: 'patron', password: 'mauvais-mot-de-passe' },
    { headers: { 'X-Clora-Langue': 'en' } });
  assert.equal(refusEn.data.error, 'Invalid username or password.');
});
