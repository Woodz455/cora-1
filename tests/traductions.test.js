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

/**
 * Tous les écrans : plus aucun texte visible n'y est écrit en dur. Un écran
 * ajouté plus tard est vérifié d'office.
 */
const ECRANS_TRADUITS = [
  'App.jsx',
  ...fs.readdirSync(path.join(CLIENT, 'components'))
    .filter((nom) => nom.endsWith('.jsx'))
    .map((nom) => `components/${nom}`)
];

/**
 * Outils en ligne de commande, lancés par l'éditeur et jamais par
 * l'utilisateur de l'application : leurs messages restent en français.
 */
const OUTILS_INTERNES = new Set(['doctor.js', 'reset_data.js']);

/**
 * Tous les fichiers du serveur : chaque message destiné à l'utilisateur a sa
 * traduction anglaise. Un fichier ajouté plus tard est vérifié d'office.
 */
const SERVEUR_TRADUIT = [
  ...fs.readdirSync(RACINE).filter((nom) => nom.endsWith('.js') && !OUTILS_INTERNES.has(nom)),
  ...fs.readdirSync(path.join(RACINE, 'routes')).filter((nom) => nom.endsWith('.js')).map((nom) => `routes/${nom}`)
];

/**
 * Messages du serveur qui n'atteignent jamais l'utilisateur : une erreur de
 * programmation, levée au démarrage, avant toute requête.
 */
const MESSAGES_INTERNES = new Set([
  'createApp exige un registre de dossiers (options.comptesDb).',
  // Configuration lue au démarrage : l'application ne démarre pas.
  'JWT_SECRET est trop court : 32 caractères minimum sont requis.',
  // Restauration appliquée au démarrage, consignée dans la console seulement.
  'la sauvegarde demandée a disparu'
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

/**
 * Lit une chaîne, et les morceaux qui lui sont ajoutés (`'…' + '…'`) : un long
 * texte s'écrit sur plusieurs lignes, et c'est le texte entier qui est la clé.
 */
function lireChaineEntiere(source, i) {
  let lue = lireChaine(source, i);
  if (!lue) return null;
  let valeur = lue.valeur;
  for (let suite = source.slice(lue.fin).match(/^\s*\+\s*/); suite; suite = source.slice(lue.fin).match(/^\s*\+\s*/)) {
    const morceau = lireChaine(source, lue.fin + suite[0].length);
    if (!morceau) break;
    valeur += morceau.valeur;
    lue = morceau;
  }
  return { valeur, fin: lue.fin };
}

/** Clés passées à `t`, `tp`, `traduire` et `traduirePluriel` dans un fichier. */
function clesDe(source) {
  const cles = [];
  for (const m of source.matchAll(/\b(?:t|traduire)\(\s*/g)) {
    const lue = lireChaineEntiere(source, m.index + m[0].length);
    if (lue) cles.push(lue.valeur);
  }
  for (const m of source.matchAll(/\b(?:tp|traduirePluriel)\(\s*[^,()]+,\s*/g)) {
    const premiere = lireChaineEntiere(source, m.index + m[0].length);
    if (!premiere) continue;
    cles.push(premiere.valeur);
    const virgule = source.slice(premiere.fin).match(/^\s*,\s*/);
    if (virgule) {
      const seconde = lireChaineEntiere(source, premiere.fin + virgule[0].length);
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

/** Chaînes d'un tableau déclaré `const NOM = [ ... ];` dans un fichier. */
function chainesDuTableau(source, nom) {
  const debut = source.indexOf(`const ${nom} = [`);
  assert.ok(debut >= 0, `tableau ${nom} introuvable`);
  const bloc = source.slice(debut, source.indexOf('];', debut));
  const chaines = [];
  for (const m of bloc.matchAll(/['"]/g)) {
    // Seules les chaînes qui commencent un élément : après `[`, `,` ou un retour.
    const avant = bloc.slice(0, m.index).trimEnd();
    if (!/[[,]$/.test(avant)) continue;
    const lue = lireChaine(bloc, m.index);
    if (lue) chaines.push(lue.valeur);
  }
  return chaines;
}

/** Valeurs des champs nommés, dans tout un fichier ou dans un bloc. */
function valeursDesChamps(source, champs) {
  const valeurs = [];
  for (const m of source.matchAll(new RegExp(`\\b(?:${champs.join('|')}):\\s*`, 'g'))) {
    const lue = lireChaine(source, m.index + m[0].length);
    if (lue) valeurs.push(lue.valeur);
  }
  return valeurs;
}

/**
 * Textes traduits sans passer par un appel `t` littéral : déclarés en données,
 * ou écrits par le serveur, puis passés à `t(variable)` à l'affichage.
 */
function clesIndirectes() {
  const lire = (...chemin) => fs.readFileSync(path.join(...chemin), 'utf8');
  const cles = ['admin', 'comptable', 'employe', 'Non précisé', 'TPS', 'TVQ', 'TVH', 'TVP'];

  // Navigation (App.jsx) et profils (client/src/profils.js).
  const app = lire(CLIENT, 'App.jsx');
  cles.push(...valeursDesChamps(app.slice(app.indexOf('const VUES'), app.indexOf('];', app.indexOf('const VUES'))),
    ['libelle', 'titre', 'sousTitre']));
  cles.push(...valeursDesChamps(lire(CLIENT, 'profils.js'), ['libelle', 'description']));

  // Statuts des factures et des devis, conditions de paiement, provinces,
  // motifs suggérés pour une note de crédit.
  const statuts = lire(CLIENT, 'statuts.js');
  for (const nom of ['STATUTS_FACTURE', 'STATUTS_DEVIS', 'STATUTS_ABONNEMENT', 'CYCLES_ABONNEMENT', 'CATEGORIES_DEPENSE']) {
    cles.push(...chainesDuTableau(statuts, nom));
  }
  const api = lire(CLIENT, 'api.js');
  cles.push(...valeursDesChamps(api.slice(api.indexOf('const CONDITIONS'), api.indexOf('];', api.indexOf('const CONDITIONS'))), ['libelle']));
  const clientModal = lire(CLIENT, 'components', 'ClientModal.jsx');
  cles.push(...valeursDesChamps(clientModal.slice(clientModal.indexOf('const PROVINCES')), ['libelle']));
  cles.push(...chainesDuTableau(lire(CLIENT, 'components', 'CreditNoteModal.jsx'), 'MOTIFS'));

  // Premiers pas et profils, écrits par le serveur et traduits à l'affichage.
  cles.push(...valeursDesChamps(lire(RACINE, 'profils.js'), ['titre', 'detail', 'libelle']));

  // Tranches de la balance âgée et catégorie par défaut des dépenses, écrites
  // par le serveur.
  const factures = lire(RACINE, 'invoiceService.js');
  cles.push(...valeursDesChamps(factures, ['libelle']), 'Sans catégorie');

  // Rôles des comptes (Paramètres), noms de champs et rôles du journal, et
  // libellés des actions consignées, écrits par le serveur.
  const settings = lire(CLIENT, 'components', 'Settings.jsx');
  cles.push(...valeursDesChamps(settings.slice(settings.indexOf('const ROLES'), settings.indexOf('];', settings.indexOf('const ROLES'))), ['libelle']));
  const journal = lire(CLIENT, 'components', 'AuditLog.jsx');
  const champs = journal.slice(journal.indexOf('const LIBELLES_CHAMPS'), journal.indexOf('};', journal.indexOf('const LIBELLES_CHAMPS')));
  for (const m of champs.matchAll(/:\s*(?=['"])/g)) cles.push(lireChaine(champs, m.index + m[0].length).valeur);
  const valeurs = journal.slice(journal.indexOf('const VALEURS'), journal.indexOf(']);', journal.indexOf('const VALEURS')));
  for (const m of valeurs.matchAll(/['"]/g)) {
    if (/[[,]\s*$/.test(valeurs.slice(0, m.index))) cles.push(lireChaine(valeurs, m.index).valeur);
  }
  const audit = lire(RACINE, 'auditService.js');
  const libelles = audit.slice(audit.indexOf('const LIBELLES'), audit.indexOf('};', audit.indexOf('const LIBELLES')));
  for (const m of libelles.matchAll(/\]:\s*(?=['"])/g)) cles.push(lireChaine(libelles, m.index + m[0].length).valeur);
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
  const PERMIS = new Set(['Clora', 'FR', 'EN', 'Français', 'English', 'PDF', 'CAD', 'USD', 'CLORA-…']);
  const fautifs = [];

  for (const relatif of ECRANS_TRADUITS) {
    const brut = fs.readFileSync(path.join(CLIENT, relatif), 'utf8');
    // Les commentaires parlent français, et c'est très bien.
    const source = brut
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    const signaler = (texte) => {
      // Les valeurs insérées dans un gabarit de chaîne ne sont pas du texte.
      const net = texte.replace(/\$\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim();
      // Du code pris entre deux balises (« ); return ( », « ) : x === 0 ? ( »,
      // « Math.abs(a - b) », lu entre la flèche d'une fonction et un « < »).
      if (/;|\breturn\b|=>|&&|\|\||===|\?\s*\(|^\)|\b[A-Za-z]+\.[a-z]\w*\(/.test(net)) return;
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

/**
 * Lit un littéral de chaîne à la position donnée. Une expression `${…}` d'un
 * gabarit est remplacée par « 1 », une valeur plausible que le motif de
 * traduction doit reconnaître.
 */
function lireLitteral(source, debut) {
  const quote = source[debut];
  if (!`'"\``.includes(quote)) return null;
  let i = debut + 1;
  let texte = '';
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
      texte += '1';
      continue;
    }
    texte += source[i];
    i += 1;
  }
  return { texte, fin: i + 1 };
}

/** Messages destinés à l'utilisateur dans un fichier du serveur. */
function messagesServeur(source) {
  const messages = [];
  // Les branches d'un choix (« cond\n ? '…'\n : '…' ») commencent une ligne :
  // seule une phrase, qui commence par une majuscule, y est retenue.
  const debut = /(httpError\(\s*\d+\s*,\s*|\berror:\s*|\bmessage:\s*|\bmotif:\s*|new Error\(\s*|^\s*[?:]\s*(?=['"`][A-ZÀ-Ý]))/gm;
  for (const m of source.matchAll(debut)) {
    let lu = lireLitteral(source, m.index + m[0].length);
    if (!lu) continue;
    let texte = lu.texte;
    // Un message écrit en plusieurs morceaux (`'…' + '…'`) se lit en entier.
    for (let suite = source.slice(lu.fin).match(/^\s*\+\s*/); suite; suite = source.slice(lu.fin).match(/^\s*\+\s*/)) {
      const morceau = lireLitteral(source, lu.fin + suite[0].length);
      if (!morceau) break;
      texte += morceau.texte;
      lu = morceau;
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

test('les colonnes d\'un import portent leur libellé anglais', () => {
  // Ils partent vers l'écran d'import hors de `error` et de `message`, et sont
  // traduits par la route d'import elle-même.
  const { MODELES } = require('../importService.js');
  const manquants = Object.values(MODELES).flat()
    .map((champ) => champ.libelle)
    .filter((libelle) => traduire(libelle, 'en') === libelle && !['Province', 'Description'].includes(libelle));
  assert.deepEqual(manquants, [], 'colonnes d\'import sans libellé anglais');
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

test('le contexte d\'une clé ne s\'affiche jamais, et une barre en tête de texte reste', () => {
  // `{n} devis en attente de réponse|pluriel` départage deux clés que le
  // français écrit pareil. Une première version coupait la clé à la première
  // barre : « | Émise le … » disparaissait des factures en français.
  const source = fs.readFileSync(path.join(CLIENT, 'i18n.js'), 'utf8');
  const extraire = (debut) => {
    const i = source.indexOf(debut);
    assert.ok(i >= 0, `introuvable dans i18n.js : ${debut}`);
    return source.slice(i, source.indexOf('\n}\n', i) + 2).replace(/^export /, '');
  };
  const traduireTest = new Function('EN', 'courante',
    `${extraire('function remplir')}\n${extraire('export function traduire(')}\nreturn traduire;`)(
    { '{n} devis|pluriel': '{n} quotes' }, 'fr');

  assert.equal(traduireTest('{n} devis|pluriel', { n: 2 }, 'fr'), '2 devis');
  assert.equal(traduireTest('{n} devis|pluriel', { n: 2 }, 'en'), '2 quotes');
  assert.equal(traduireTest('| Émise le {date}', { date: '2026-10-01' }, 'fr'), '| Émise le 2026-10-01');
  assert.equal(traduireTest('Texte absent', undefined, 'en'), 'Texte absent', 'absent : le français, jamais vide');
});
