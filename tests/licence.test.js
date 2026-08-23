/**
 * Licence perpétuelle et maintenance annuelle.
 *
 * Les clés sont signées ici avec une vraie paire Ed25519, engendrée pour la
 * durée du test : la clé de l'éditeur n'existe pas dans le dépôt, et ne doit
 * jamais y entrer.
 *
 * Le test qui compte le plus n'est pas la vérification de signature — Node s'en
 * charge — mais celui qui prouve que la **clé privée n'est pas empaquetée**.
 * C'est le seul défaut de ce mécanisme qui serait irréversible : une clé privée
 * diffusée ne se rappelle pas, et permettrait à quiconque d'émettre des
 * licences valides.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { startTestServer, MOT_DE_PASSE } = require('./helpers.js');
const { reset: resetRateLimit } = require('../rateLimit.js');
const {
  etatLicence, activer, verifierCle, definirClePublique, joursEntre, dateFiable,
  ETATS, JOURS_ESSAI, PREFIXE
} = require('../licenceService.js');

/** Paire de clés propre à cette exécution. */
const paire = crypto.generateKeyPairSync('ed25519');
const PUBLIQUE = paire.publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('base64');

/** Signe une licence comme le ferait `scripts/generer-licence.js`. */
function emettre({ titulaire = 'Plomberie Tremblay', courriel = '', maintenance = '2099-01-01' } = {}) {
  const charge = Buffer.from(JSON.stringify({
    titulaire, courriel, achat: '2026-01-01', maintenance_jusqu_au: maintenance
  }), 'utf8');
  const signature = crypto.sign(null, charge, paire.privateKey);
  return `${PREFIXE}${charge.toString('base64url')}.${signature.toString('base64url')}`;
}

/** Active la clé publique de test, et la retire après coup. */
function avecCle(t) {
  definirClePublique(PUBLIQUE);
  t.after(() => definirClePublique(null));
}

/** Registre isolé, sans serveur. */
async function registre(t) {
  const { ouvrirComptes } = require('../companyStore.js');
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clora-licence-'));
  const db = await ouvrirComptes(path.join(dir, 'comptes.sqlite'));
  t.after(async () => { await db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return db;
}

// --- Ce qui ne doit jamais fuir ----------------------------------------------

test('la clé privée est exclue de git et du paquet', () => {
  const gitignore = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
  assert.match(gitignore, /clef-privee-licence\.pem/);
  assert.match(gitignore, /\*\.pem/);

  // `build.files` décide de ce qui entre dans l'installateur. L'outil
  // d'émission et toute clé privée en sont exclus explicitement, plutôt que par
  // le hasard des motifs existants.
  const { build } = require('../package.json');
  assert.ok(build.files.includes('!scripts/**'), "l'outil d'émission doit être exclu");
  assert.ok(build.files.includes('!*.pem'), 'aucune clé privée ne doit être empaquetée');
});

test('le dépôt ne contient aucune clé privée', () => {
  const racine = path.join(__dirname, '..');
  const suspects = fs.readdirSync(racine).filter((f) => /\.(pem|key|p12|pfx)$/i.test(f));
  assert.deepEqual(suspects, [], `fichiers de clé trouvés : ${suspects.join(', ')}`);
});

// --- Vérification des clés ----------------------------------------------------

test('une clé authentique est acceptée et lue', (t) => {
  avecCle(t);
  const { valide, licence } = verifierCle(emettre({ titulaire: 'Boulangerie Côté' }));

  assert.equal(valide, true);
  assert.equal(licence.titulaire, 'Boulangerie Côté');
});

test('une clé modifiée après émission est rejetée', (t) => {
  avecCle(t);
  const cle = emettre({ maintenance: '2026-01-01' });

  // Le client repousse lui-même son échéance : la charge change, la signature
  // ne correspond plus. C'est exactement ce que la signature sert à empêcher.
  const [charge, signature] = cle.slice(PREFIXE.length).split('.');
  const trafiquee = JSON.parse(Buffer.from(charge, 'base64url').toString('utf8'));
  trafiquee.maintenance_jusqu_au = '2099-01-01';
  const refaite = Buffer.from(JSON.stringify(trafiquee), 'utf8').toString('base64url');

  const r = verifierCle(`${PREFIXE}${refaite}.${signature}`);
  assert.equal(r.valide, false);
  assert.match(r.motif, /authentique/);
});

test('une clé signée par une autre paire est rejetée', (t) => {
  avecCle(t);
  const autre = crypto.generateKeyPairSync('ed25519');
  const charge = Buffer.from(JSON.stringify({
    titulaire: 'Fraudeur', maintenance_jusqu_au: '2099-01-01'
  }), 'utf8');
  const signature = crypto.sign(null, charge, autre.privateKey);

  const r = verifierCle(`${PREFIXE}${charge.toString('base64url')}.${signature.toString('base64url')}`);
  assert.equal(r.valide, false);
});

test('une chaîne quelconque est refusée sans planter', (t) => {
  avecCle(t);
  for (const bruit of ['', 'bonjour', 'CLORA-', 'CLORA-abc', 'CLORA-abc.def', null, undefined]) {
    const r = verifierCle(bruit);
    assert.equal(r.valide, false, JSON.stringify(bruit));
    assert.ok(r.motif, 'un motif doit toujours accompagner un refus');
  }
});

// --- La règle de maintenance --------------------------------------------------

test('une version postérieure à la maintenance refuse la clé, une antérieure l\'accepte', async (t) => {
  avecCle(t);
  const db = await registre(t);
  const cle = emettre({ maintenance: '2027-06-30' });

  // Version publiée après l'échéance : refusée à l'activation, avec un message
  // qui dit quoi faire plutôt qu'un simple « invalide ».
  await assert.rejects(
    () => activer(db, cle, { dateVersion: '2027-07-01' }),
    (e) => {
      assert.match(e.message, /2027-06-30/);
      assert.match(e.message, /vos données restent intactes/);
      return true;
    }
  );

  // La même clé, sur une version antérieure : acceptée. C'est ce qui permet au
  // client qui cesse de payer de garder son logiciel indéfiniment.
  const etat = await activer(db, cle, { dateVersion: '2027-06-30' });
  assert.equal(etat.etat, ETATS.ACTIVEE);
  assert.equal(etat.titulaire, 'Plomberie Tremblay');
});

test('une mise à jour publiée après l\'échéance bloque cette version seulement', async (t) => {
  avecCle(t);
  const db = await registre(t);

  await activer(db, emettre({ maintenance: '2027-06-30' }), { dateVersion: '2027-01-01' });

  const ancienne = await etatLicence(db, { dateVersion: '2027-01-01' });
  assert.equal(ancienne.utilisable, true);

  const recente = await etatLicence(db, { dateVersion: '2027-08-01' });
  assert.equal(recente.etat, ETATS.MAINTENANCE_EXPIREE);
  assert.equal(recente.utilisable, false);
});

// --- L'essai ------------------------------------------------------------------

test('l\'essai court trente jours puis expire', async (t) => {
  avecCle(t);
  const db = await registre(t);
  await db.run("UPDATE licence SET essai_debut = '2026-01-01', date_max = '2026-01-01'");

  const debut = await etatLicence(db, { maintenant: new Date('2026-01-01T12:00:00Z') });
  assert.equal(debut.etat, ETATS.ESSAI);
  assert.equal(debut.jours_restants, JOURS_ESSAI);

  const veille = await etatLicence(db, { maintenant: new Date('2026-01-30T12:00:00Z') });
  assert.equal(veille.etat, ETATS.ESSAI);
  assert.equal(veille.utilisable, true);

  const apres = await etatLicence(db, { maintenant: new Date('2026-02-01T12:00:00Z') });
  assert.equal(apres.etat, ETATS.ESSAI_EXPIRE);
  assert.equal(apres.utilisable, false);
});

test('reculer l\'horloge ne prolonge pas l\'essai', async (t) => {
  avecCle(t);
  const db = await registre(t);
  await db.run("UPDATE licence SET essai_debut = '2026-01-01', date_max = '2026-01-01'");

  // L'application a vu passer le 15 février : l'essai est terminé.
  const expire = await etatLicence(db, { maintenant: new Date('2026-02-15T12:00:00Z') });
  assert.equal(expire.etat, ETATS.ESSAI_EXPIRE);

  // L'utilisateur recule l'horloge de Windows au 2 janvier. La date la plus
  // élevée jamais observée fait foi.
  const triche = await etatLicence(db, { maintenant: new Date('2026-01-02T12:00:00Z') });
  assert.equal(triche.etat, ETATS.ESSAI_EXPIRE, "l'essai ne doit pas repartir");

  const retenue = await dateFiable(db, new Date('2026-01-02T12:00:00Z'));
  assert.equal(retenue, '2026-02-15');
});

test('sans clé publique configurée, le contrôle est inerte', async (t) => {
  const db = await registre(t);
  definirClePublique(null);
  await db.run("UPDATE licence SET essai_debut = '2020-01-01', date_max = '2020-01-01'");

  // Un essai commencé il y a six ans : sans clé publique, rien ne se verrouille.
  const etat = await etatLicence(db);
  assert.equal(etat.etat, ETATS.DESACTIVE);
  assert.equal(etat.utilisable, true);
});

test('le compte des jours est exact aux bornes', () => {
  assert.equal(joursEntre('2026-01-01', '2026-01-01'), 0);
  assert.equal(joursEntre('2026-01-01', '2026-01-31'), 30);
  // Passage à l'heure d'été : un calcul en heure locale rendrait 29 ou 31.
  assert.equal(joursEntre('2026-03-01', '2026-03-31'), 30);
});

// --- Par l'API ----------------------------------------------------------------

test('l\'état de la licence se consulte sans être connecté', async (t) => {
  resetRateLimit();
  const api = await startTestServer();
  t.after(async () => { await api.close(); });

  const res = await api.get('/api/licence');
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.ok(res.data.etat, 'un état doit toujours être rendu');
});

test('un essai expiré bloque l\'API mais laisse activer une clé', async (t) => {
  avecCle(t);
  resetRateLimit();
  const api = await startTestServer();
  t.after(async () => { await api.close(); });

  await api.post('/api/auth/setup', { username: 'patron', password: MOT_DE_PASSE });
  await api.comptesDb.run("UPDATE licence SET essai_debut = '2020-01-01', date_max = '2020-01-01'");

  // Tout le métier est refusé, avec un code qui dit pourquoi.
  const bloque = await api.get('/api/clients');
  assert.equal(bloque.status, 402, JSON.stringify(bloque.data));
  assert.match(bloque.data.error, /essai/i);

  // Mais la route de licence répond encore : sans quoi l'utilisateur serait
  // enfermé dehors, sans moyen de saisir la clé qu'il vient d'acheter.
  const etat = await api.get('/api/licence');
  assert.equal(etat.status, 200);

  const active = await api.post('/api/licence/activer', { cle: emettre() });
  assert.equal(active.status, 200, JSON.stringify(active.data));
  assert.equal(active.data.etat, ETATS.ACTIVEE);

  // L'application redevient utilisable immédiatement, sans redémarrage.
  const apres = await api.get('/api/clients');
  assert.equal(apres.status, 200, JSON.stringify(apres.data));
});

test('une clé invalide est refusée avec un motif lisible', async (t) => {
  avecCle(t);
  resetRateLimit();
  const api = await startTestServer();
  t.after(async () => { await api.close(); });

  const res = await api.post('/api/licence/activer', { cle: 'CLORA-nimporte.quoi' });
  assert.equal(res.status, 400, JSON.stringify(res.data));
  assert.ok(res.data.error);

  const vide = await api.post('/api/licence/activer', {});
  assert.equal(vide.status, 400);
});
