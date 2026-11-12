/**
 * Le coffre des secrets, face aux fonctions asynchrones d'Electron.
 *
 * Electron 45 déclare obsolètes les fonctions synchrones de `safeStorage`, et
 * la 46 les retire. Le coffre de Clora protège le mot de passe du courriel, la
 * clé Stripe et la clé des sauvegardes : s'il cessait de relire ce qu'il a
 * chiffré, l'entreprise perdrait d'un coup ses envois et ses sauvegardes.
 *
 * Les tests tournent hors Electron. De faux coffres, de même forme que
 * `safeStorage`, permettent d'exercer ce qui ne se verrait sinon que dans
 * l'application installée.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  chiffrer, dechiffrer, lireSecret, coffreDisponible, estProtege, utiliserCoffre,
  PREFIXE_COFFRE, PREFIXE_CLAIR, COLONNES_SECRETES
} = require('../secretStorage.js');
const { createTestDb } = require('./helpers.js');
const { lireProtection } = require('../backupService.js');
const { empreinteDe } = require('../chiffrementSauvegardes.js');
const { genererCle } = require('../codesSecours.js');
const { chargerConfiguration, reinitialiser } = require('../emailService.js');

const enBloc = (texte) => PREFIXE_COFFRE + Buffer.from(texte, 'utf8').toString('base64');

/**
 * Coffre moderne. Il chiffre avec la clé « A2 » et sait encore lire « A1 »,
 * une clé plus ancienne, en demandant alors le rechiffrement : c'est ce que
 * fait Electron quand le système a renouvelé sa clé.
 *
 * Ses fonctions synchrones lèvent : aucun test ne doit les atteindre.
 */
function coffreModerne({ disponible = true } = {}) {
  const obsolete = () => { throw new Error('fonction synchrone obsolète appelée'); };
  const appels = { chiffrements: 0 };
  return {
    appels,
    isAsyncEncryptionAvailable: async () => disponible,
    encryptStringAsync: async (texte) => { appels.chiffrements += 1; return Buffer.from(`A2:${texte}`, 'utf8'); },
    decryptStringAsync: async (bloc) => {
      const brut = Buffer.from(bloc).toString('utf8');
      if (brut.startsWith('A2:')) return { result: brut.slice(3), shouldReEncrypt: false };
      if (brut.startsWith('A1:')) return { result: brut.slice(3), shouldReEncrypt: true };
      throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptStringAsync.');
    },
    isEncryptionAvailable: obsolete,
    encryptString: obsolete,
    decryptString: obsolete
  };
}

/** Coffre d'un Electron antérieur aux fonctions asynchrones. */
function coffreAncien() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (texte) => Buffer.from(`S:${texte}`, 'utf8'),
    decryptString: (bloc) => {
      const brut = Buffer.from(bloc).toString('utf8');
      if (!brut.startsWith('S:')) throw new Error('illisible');
      return brut.slice(2);
    }
  };
}

function avecCoffre(t, faux) {
  utiliserCoffre(faux);
  t.after(() => utiliserCoffre(undefined));
  return faux;
}

async function baseDeTest(t) {
  const db = await createTestDb();
  t.after(() => db.__cleanup());
  return db;
}

test('le coffre moderne chiffre et relit sans toucher aux fonctions obsolètes', async (t) => {
  avecCoffre(t, coffreModerne());

  const enregistre = await chiffrer('mot-de-passe-été');
  assert.ok(enregistre.startsWith(PREFIXE_COFFRE));
  assert.equal(estProtege(enregistre), true);
  assert.ok(!enregistre.includes('mot-de-passe'), 'le secret ne figure pas tel quel');
  assert.equal(await dechiffrer(enregistre), 'mot-de-passe-été');
  assert.equal(await coffreDisponible(), true);
});

test('un secret chiffré par l\'ancienne fonction reste lisible après la mise à jour', async (t) => {
  // Ce que contient une installation existante : des blocs produits par
  // `encryptString`. Le coffre moderne les relit, comme le fait Electron.
  avecCoffre(t, coffreModerne());
  assert.equal(await dechiffrer(enBloc('A1:clé-posée-avant-la-mise-à-jour')), 'clé-posée-avant-la-mise-à-jour');
});

test('un Electron sans fonctions asynchrones garde les anciennes', async (t) => {
  avecCoffre(t, coffreAncien());

  const enregistre = await chiffrer('secret');
  assert.ok(enregistre.startsWith(PREFIXE_COFFRE));
  assert.equal(await dechiffrer(enregistre), 'secret');
  assert.equal(await coffreDisponible(), true);
});

test('sans coffre, la valeur est encodée et le préfixe le dit', async (t) => {
  avecCoffre(t, null);

  const enregistre = await chiffrer('secret');
  assert.ok(enregistre.startsWith(PREFIXE_CLAIR));
  assert.equal(estProtege(enregistre), false);
  assert.equal(await dechiffrer(enregistre), 'secret');
  assert.equal(await coffreDisponible(), false);
});

test('un coffre qui se dit indisponible, ou qui échoue, n\'est pas employé', async (t) => {
  avecCoffre(t, coffreModerne({ disponible: false }));
  assert.equal(await coffreDisponible(), false);
  assert.ok((await chiffrer('secret')).startsWith(PREFIXE_CLAIR));

  utiliserCoffre({ isAsyncEncryptionAvailable: async () => { throw new Error('coffre en panne'); } });
  assert.equal(await coffreDisponible(), false);
  assert.ok((await chiffrer('secret')).startsWith(PREFIXE_CLAIR));
});

test('une valeur venue d\'un autre poste est illisible, sans planter', async (t) => {
  avecCoffre(t, coffreModerne());
  assert.equal(await dechiffrer(enBloc('bloc-d-une-autre-machine')), '');

  // Et quand le coffre a disparu entre-temps : même silence.
  utiliserCoffre(null);
  assert.equal(await dechiffrer(enBloc('A2:secret')), '');
});

test('le secret est rechiffré quand le coffre le demande, une seule fois', async (t) => {
  const coffre = avecCoffre(t, coffreModerne());
  const db = await baseDeTest(t);
  const ancien = enBloc('A1:mot-de-passe-smtp');
  await db.run('UPDATE settings SET smtp_pass_chiffre = ?', [ancien]);

  assert.equal(await lireSecret(db, 'smtp_pass_chiffre', ancien), 'mot-de-passe-smtp');

  const apres = (await db.get('SELECT smtp_pass_chiffre FROM settings')).smtp_pass_chiffre;
  assert.equal(apres, enBloc('A2:mot-de-passe-smtp'), 'la colonne porte désormais la clé récente');
  assert.equal(coffre.appels.chiffrements, 1);

  // La valeur à jour ne déclenche plus rien.
  assert.equal(await lireSecret(db, 'smtp_pass_chiffre', apres), 'mot-de-passe-smtp');
  assert.equal(coffre.appels.chiffrements, 1);
});

test('le rechiffrement ne piétine pas un secret remplacé entre-temps', async (t) => {
  avecCoffre(t, coffreModerne());
  const db = await baseDeTest(t);
  const lu = enBloc('A1:ancien-mot-de-passe');
  const saisiDepuis = enBloc('A2:nouveau-mot-de-passe');
  // L'utilisateur a enregistré un nouveau mot de passe pendant la lecture.
  await db.run('UPDATE settings SET smtp_pass_chiffre = ?', [saisiDepuis]);

  assert.equal(await lireSecret(db, 'smtp_pass_chiffre', lu), 'ancien-mot-de-passe');
  assert.equal((await db.get('SELECT smtp_pass_chiffre FROM settings')).smtp_pass_chiffre, saisiDepuis);
});

test('un rechiffrement impossible n\'empêche pas de lire le secret', async (t) => {
  avecCoffre(t, coffreModerne());
  const baseEnPanne = { run: async () => { throw new Error('disque plein'); } };
  const erreurs = t.mock.method(console, 'error', () => {});

  assert.equal(await lireSecret(baseEnPanne, 'sauvegarde_cle', enBloc('A1:clé')), 'clé');
  assert.equal(erreurs.mock.callCount(), 1, 'l\'échec est consigné');
  assert.ok(!JSON.stringify(erreurs.mock.calls[0].arguments).includes('clé"'), 'sans le secret');
});

test('seules les colonnes de secrets connues sont acceptées', async (t) => {
  avecCoffre(t, coffreModerne());
  assert.deepEqual(COLONNES_SECRETES, ['smtp_pass_chiffre', 'stripe_cle_chiffree', 'sauvegarde_cle']);
  await assert.rejects(() => lireSecret(null, 'entreprise_nom; DROP TABLE settings', 'x'), /colonne de secret inconnue/);
});

test('la clé des sauvegardes d\'une installation existante est relue, puis rechiffrée', async (t) => {
  avecCoffre(t, coffreModerne());
  const db = await baseDeTest(t);
  const cle = genererCle();
  await db.run(
    'UPDATE settings SET sauvegarde_cle = ?, sauvegarde_cle_empreinte = ?',
    [enBloc(`A1:${cle}`), empreinteDe(cle)]
  );

  const protection = await lireProtection(db);
  assert.deepEqual(
    { active: protection.active, lisible: protection.lisible, cle: protection.cle },
    { active: true, lisible: true, cle }
  );
  assert.equal((await db.get('SELECT sauvegarde_cle FROM settings')).sauvegarde_cle, enBloc(`A2:${cle}`));
});

test('le mot de passe du courriel d\'une installation existante est relu, puis rechiffré', async (t) => {
  avecCoffre(t, coffreModerne());
  reinitialiser();
  t.after(() => reinitialiser());
  const db = await baseDeTest(t);
  await db.run(
    "UPDATE settings SET smtp_host = 'smtp.exemple.ca', smtp_port = 587, smtp_user = 'moi@exemple.ca', smtp_pass_chiffre = ?",
    [enBloc('A1:mot-de-passe-smtp')]
  );

  const config = await chargerConfiguration(db);
  assert.equal(config.pass, 'mot-de-passe-smtp');
  assert.equal(config.source, 'parametres');
  assert.equal((await db.get('SELECT smtp_pass_chiffre FROM settings')).smtp_pass_chiffre, enBloc('A2:mot-de-passe-smtp'));
});
