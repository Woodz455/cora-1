/**
 * Pièces justificatives : le reçu joint à la dépense, gardé six ans.
 *
 * Les fichiers vivent à côté de la base et rejoignent le dossier de sauvegarde
 * une fois chacun. Ces essais vérifient qu'ils y arrivent, chiffrés quand il le
 * faut, et qu'une base restaurée ailleurs les retrouve.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { startTestServer, MOT_DE_PASSE } = require('./helpers.js');
const { reset: resetRateLimit } = require('../rateLimit.js');
const { creerSauvegarde, enregistrerCle, serieDe, identifiantDuDossier } = require('../backupService.js');
const { dechiffrer, estChiffre } = require('../chiffrementSauvegardes.js');
const { genererCle } = require('../codesSecours.js');
const { repertoireLocal, PREFIXE_DOSSIER_SAUVEGARDE } = require('../piecesService.js');
const { aujourdhui } = require('../dates.js');

async function avecAdmin(t) {
  resetRateLimit();
  const api = await startTestServer();
  t.after(() => api.close());
  const res = await api.post('/api/auth/setup', { username: 'patron', password: MOT_DE_PASSE });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return api;
}

async function depense(api, date = aujourdhui()) {
  const res = await api.post('/api/depenses', {
    fournisseur: 'Papeterie', description: 'Cartouches', date_depense: date,
    montant_ht: 40, tps: 2, tvq: 3.99, montant_ttc: 45.99, categorie: 'Fournitures'
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data;
}

/** Un petit PDF, unique à chaque appel. */
const unPdf = (texte = crypto.randomUUID()) => Buffer.from(`%PDF-1.4\n% ${texte}\n%%EOF\n`, 'latin1');

/** Envoie un fichier tel quel, comme le fait l'interface. */
async function envoyer(api, depenseId, contenu, nom = 'reçu épicerie.pdf', type = 'application/pdf') {
  const res = await fetch(`${api.base}/api/depenses/${depenseId}/pieces`, {
    method: 'POST',
    headers: { Cookie: api.cookie(), 'Content-Type': type, 'X-Nom-Fichier': encodeURIComponent(nom) },
    body: contenu
  });
  return { status: res.status, data: await res.json() };
}

async function telecharger(api, pieceId) {
  const res = await fetch(`${api.base}/api/depenses/pieces/${pieceId}`, { headers: { Cookie: api.cookie() } });
  return { status: res.status, type: res.headers.get('content-type'), csp: res.headers.get('content-security-policy'), contenu: Buffer.from(await res.arrayBuffer()) };
}

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

test('un reçu se joint, se relit à l\'identique et laisse une trace', async (t) => {
  const api = await avecAdmin(t);
  const { id } = await depense(api);
  const pdf = unPdf();

  const res = await envoyer(api, id, pdf);
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.equal(res.data.nom, 'reçu épicerie.pdf');
  assert.equal(res.data.type, 'application/pdf');
  assert.equal(res.data.empreinte, sha256(pdf));
  assert.equal(res.data.ajoute_par, 'patron');

  // Le fichier est à côté de la base, sous son empreinte, et pas dans la base.
  assert.deepEqual(fs.readFileSync(path.join(repertoireLocal(api.db), sha256(pdf))), pdf);

  const relu = await telecharger(api, res.data.id);
  assert.equal(relu.status, 200);
  assert.equal(relu.type, 'application/pdf');
  assert.deepEqual(relu.contenu, pdf);
  assert.match(relu.csp, /sandbox/, 'une pièce ne peut exécuter aucun script');

  const liste = await api.get('/api/depenses');
  assert.equal(liste.data.find((d) => d.id === id).pieces, 1, 'la liste compte les pièces');
  assert.equal((await api.get(`/api/depenses/${id}/pieces`)).data.length, 1);

  const [trace] = await api.db.all("SELECT details FROM logs_audit WHERE action = 'piece.ajout'");
  assert.equal(JSON.parse(trace.details).nom, 'reçu épicerie.pdf');
});

test('seuls les PDF et les images sont acceptés, reconnus à leur contenu', async (t) => {
  const api = await avecAdmin(t);
  const { id } = await depense(api);

  // Un texte renommé en PDF n'en devient pas un.
  const faux = await envoyer(api, id, Buffer.from('ceci est un simple texte, pas un PDF'), 'faux.pdf');
  assert.equal(faux.status, 415);
  assert.match(faux.data.error, /PDF et les images/);

  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(32)]);
  const image = await envoyer(api, id, png, '../../photo.png', 'image/png');
  assert.equal(image.status, 201, JSON.stringify(image.data));
  assert.equal(image.data.type, 'image/png');
  assert.equal(image.data.nom, 'photo.png', 'le nom ne garde aucun chemin');

  assert.equal((await envoyer(api, id, Buffer.alloc(0))).status, 400);

  const tropGros = await envoyer(api, id, Buffer.concat([unPdf(), Buffer.alloc(15 * 1024 * 1024)]));
  assert.equal(tropGros.status, 413);
  assert.equal(tropGros.data.error, 'Le fichier dépasse 15 Mo.');
});

test('retirer une pièce efface le fichier, sauf s\'il sert ailleurs', async (t) => {
  const api = await avecAdmin(t);
  const a = await depense(api);
  const b = await depense(api);
  const pdf = unPdf();
  const pieceA = (await envoyer(api, a.id, pdf)).data;
  const pieceB = (await envoyer(api, b.id, pdf)).data;
  const fichier = path.join(repertoireLocal(api.db), sha256(pdf));

  assert.equal((await api.del(`/api/depenses/pieces/${pieceA.id}`)).status, 200);
  assert.ok(fs.existsSync(fichier), 'le même reçu reste joint à l\'autre dépense');

  // Supprimer la dépense emporte sa pièce, et le fichier devenu orphelin.
  assert.equal((await api.del(`/api/depenses/${b.id}`)).status, 200);
  assert.ok(!fs.existsSync(fichier));
  assert.equal((await telecharger(api, pieceB.id)).status, 404);

  const actions = (await api.db.all("SELECT action, details FROM logs_audit WHERE action IN ('piece.retrait', 'depense.suppression') ORDER BY id"));
  assert.deepEqual(actions.map((l) => l.action), ['piece.retrait', 'depense.suppression']);
  assert.deepEqual(JSON.parse(actions[1].details).pieces, ['reçu épicerie.pdf']);
});

test('une dépense close accepte un reçu, mais n\'en perd aucun', async (t) => {
  const api = await avecAdmin(t);
  const { id } = await depense(api, '2025-11-20');
  const avant = (await envoyer(api, id, unPdf())).data;
  assert.equal((await api.put('/api/settings/verrouillage', { date_verrouillage: '2025-12-31' })).status, 200);

  const ajout = await envoyer(api, id, unPdf());
  assert.equal(ajout.status, 201, 'joindre un reçu complète la justification sans changer les chiffres');

  const retrait = await api.del(`/api/depenses/pieces/${avant.id}`);
  assert.equal(retrait.status, 409);
  await assert.rejects(() => api.db.run('DELETE FROM pieces_jointes WHERE id = ?', [avant.id]), /CLORA_PERIODE_VERROUILLEE/);
});

test('les pièces rejoignent le dossier de sauvegarde une fois chacune', async (t) => {
  const api = await avecAdmin(t);
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'clora-pieces-sauvegarde-'));
  t.after(() => fs.rmSync(dossier, { recursive: true, force: true }));
  const { id } = await depense(api);
  const pdf = unPdf();
  await envoyer(api, id, pdf);

  const premiere = await creerSauvegarde(api.db, { dossier });
  assert.deepEqual(premiere.pieces, { deposees: 1, manquantes: 0 });
  const serie = serieDe(await identifiantDuDossier(api.db));
  const depot = path.join(dossier, `${PREFIXE_DOSSIER_SAUVEGARDE}${serie}`, `${sha256(pdf)}.piece`);
  assert.deepEqual(fs.readFileSync(depot), pdf);

  // La base sauvegardée ne contient pas le fichier : elle reste légère.
  assert.ok(!fs.readFileSync(premiere.chemin).includes(pdf));

  const seconde = await creerSauvegarde(api.db, { dossier });
  assert.deepEqual(seconde.pieces, { deposees: 0, manquantes: 0 }, 'rien n\'est recopié');
});

test('protégées par la clé du dossier, les pièces partent chiffrées', async (t) => {
  const api = await avecAdmin(t);
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'clora-pieces-chiffrees-'));
  t.after(() => fs.rmSync(dossier, { recursive: true, force: true }));
  await api.db.run('UPDATE settings SET sauvegarde_dossier = ?', [dossier]);
  const { id } = await depense(api);
  const ancienne = unPdf();
  await envoyer(api, id, ancienne);
  await creerSauvegarde(api.db, { dossier });
  const serie = serieDe(await identifiantDuDossier(api.db));
  const repertoire = path.join(dossier, `${PREFIXE_DOSSIER_SAUVEGARDE}${serie}`);

  // Activer la protection chiffre aussi les pièces déjà déposées en clair.
  const cle = genererCle();
  const activation = await api.post('/api/sauvegardes/cle', { cle, confirmation: cle });
  assert.equal(activation.status, 200, JSON.stringify(activation.data));
  assert.deepEqual(activation.data.pieces, { rechiffrees: 1, laissees: 0 });
  assert.ok(!fs.existsSync(path.join(repertoire, `${sha256(ancienne)}.piece`)), 'aucun exemplaire en clair ne reste');
  const reprise = fs.readFileSync(path.join(repertoire, `${sha256(ancienne)}.clora`));
  assert.ok(estChiffre(reprise));
  assert.deepEqual(dechiffrer(reprise, cle), ancienne);

  // Et les suivantes partent directement chiffrées.
  const nouvelle = unPdf();
  await envoyer(api, id, nouvelle);
  await creerSauvegarde(api.db, { dossier });
  assert.deepEqual(dechiffrer(fs.readFileSync(path.join(repertoire, `${sha256(nouvelle)}.clora`)), cle), nouvelle);

  // Remplacer la clé les rechiffre avec la nouvelle.
  const autre = genererCle();
  const remplacement = await api.post('/api/sauvegardes/cle', { cle: autre, confirmation: autre, motDePasse: MOT_DE_PASSE });
  assert.equal(remplacement.status, 200, JSON.stringify(remplacement.data));
  assert.deepEqual(dechiffrer(fs.readFileSync(path.join(repertoire, `${sha256(nouvelle)}.clora`)), autre), nouvelle);
});

test('une pièce absente du poste est reprise du dossier de sauvegarde', async (t) => {
  const api = await avecAdmin(t);
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'clora-pieces-reprise-'));
  t.after(() => fs.rmSync(dossier, { recursive: true, force: true }));
  await api.db.run('UPDATE settings SET sauvegarde_dossier = ?', [dossier]);
  const cle = genererCle();
  await enregistrerCle(api.db, cle);

  const { id } = await depense(api);
  const pdf = unPdf();
  const piece = (await envoyer(api, id, pdf)).data;
  await creerSauvegarde(api.db, { dossier });

  // Ce que voit une base restaurée sur un nouvel ordinateur : la description
  // de la pièce, sans le fichier.
  const local = path.join(repertoireLocal(api.db), sha256(pdf));
  fs.unlinkSync(local);

  const relu = await telecharger(api, piece.id);
  assert.equal(relu.status, 200);
  assert.deepEqual(relu.contenu, pdf);
  assert.ok(fs.existsSync(local), 'la pièce est remise en place');

  // Un fichier altéré dans le dossier de sauvegarde n'est pas rendu pour bon.
  fs.unlinkSync(local);
  const serie = serieDe(await identifiantDuDossier(api.db));
  const depot = path.join(dossier, `${PREFIXE_DOSSIER_SAUVEGARDE}${serie}`, `${sha256(pdf)}.clora`);
  const abime = fs.readFileSync(depot);
  abime[abime.length - 20] ^= 0xff;
  fs.writeFileSync(depot, abime);
  assert.equal((await telecharger(api, piece.id)).status, 404);
});
