/**
 * Les reçus d'une période, remis au comptable en une archive.
 *
 * Un comptable qui prépare une déclaration veut les reçus du trimestre d'un
 * seul coup ; Clora les faisait ouvrir un à un.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { startTestServer, MOT_DE_PASSE } = require('./helpers.js');
const { reset: resetRateLimit } = require('../rateLimit.js');
const { crc32 } = require('../archiveZip.js');
const { repertoireLocal } = require('../piecesService.js');

async function avecAdmin(t) {
  resetRateLimit();
  const api = await startTestServer();
  t.after(() => api.close());
  const res = await api.post('/api/auth/setup', { username: 'patron', password: MOT_DE_PASSE });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return api;
}

async function depense(api, date, fournisseur) {
  const res = await api.post('/api/depenses', {
    fournisseur, description: 'Achat', date_depense: date,
    montant_ht: 100, tps: 5, tvq: 9.98, montant_ttc: 114.98, categorie: 'Fournitures'
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data;
}

const unPdf = () => Buffer.from(`%PDF-1.4\n% ${crypto.randomUUID()}\n%%EOF\n`, 'latin1');

async function joindre(api, depenseId, contenu, nom) {
  const res = await fetch(`${api.base}/api/depenses/${depenseId}/pieces`, {
    method: 'POST',
    headers: { Cookie: api.cookie(), 'Content-Type': 'application/pdf', 'X-Nom-Fichier': encodeURIComponent(nom) },
    body: contenu
  });
  assert.equal(res.status, 201);
  return res.json();
}

async function telecharger(api, requete) {
  const res = await fetch(`${api.base}/api/rapports/export/recus?${requete}`, { headers: { Cookie: api.cookie() } });
  return { status: res.status, entetes: res.headers, contenu: Buffer.from(await res.arrayBuffer()) };
}

/**
 * Lit une archive ZIP par son répertoire central, comme le ferait Windows, et
 * vérifie le CRC de chaque fichier.
 */
function lireZip(zip) {
  const fin = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(fin >= 0, 'fin de répertoire central absente');
  const nombre = zip.readUInt16LE(fin + 10);
  let p = zip.readUInt32LE(fin + 16);
  const fichiers = new Map();
  for (let i = 0; i < nombre; i += 1) {
    assert.equal(zip.readUInt32LE(p), 0x02014b50);
    const crc = zip.readUInt32LE(p + 16);
    const taille = zip.readUInt32LE(p + 24);
    const longueurNom = zip.readUInt16LE(p + 28);
    const decalage = zip.readUInt32LE(p + 42);
    const nom = zip.subarray(p + 46, p + 46 + longueurNom).toString('utf8');
    const debut = decalage + 30 + zip.readUInt16LE(decalage + 26) + zip.readUInt16LE(decalage + 28);
    const contenu = zip.subarray(debut, debut + taille);
    assert.equal(crc32(contenu), crc, `CRC de ${nom}`);
    fichiers.set(nom, contenu);
    p += 46 + longueurNom;
  }
  return fichiers;
}

test('les reçus d\'un trimestre partent en une archive, avec leur index', async (t) => {
  const api = await avecAdmin(t);
  const juillet = await depense(api, '2026-07-02', 'Bédard & fils');
  const aout = await depense(api, '2026-08-15', 'Papeterie Roy');
  const octobre = await depense(api, '2026-10-01', 'Hors période');
  const a = unPdf();
  const b = unPdf();
  const c = unPdf();
  await joindre(api, juillet.id, a, 'reçu juillet.pdf');
  await joindre(api, juillet.id, b, 'reçu juillet.pdf');
  await joindre(api, aout.id, c, 'facture:août?.PDF');
  await joindre(api, octobre.id, unPdf(), 'autre.pdf');

  const compte = await api.get('/api/rapports/recus?annee=2026&trimestre=3');
  assert.deepEqual(compte.data, { nombre: 3, taille: a.length + b.length + c.length });

  const res = await telecharger(api, 'annee=2026&trimestre=3');
  assert.equal(res.status, 200);
  assert.equal(res.entetes.get('content-type'), 'application/zip');
  assert.match(res.entetes.get('content-disposition'), /filename="recus-2026-T3\.zip"/);

  const fichiers = lireZip(res.contenu);
  assert.deepEqual([...fichiers.keys()], [
    '2026-07-02 - Bédard & fils - reçu juillet.pdf',
    '2026-07-02 - Bédard & fils - reçu juillet (2).pdf',
    '2026-08-15 - Papeterie Roy - factureaoût.pdf',
    'registre-des-recus.csv'
  ]);
  assert.deepEqual(fichiers.get('2026-07-02 - Bédard & fils - reçu juillet.pdf'), a);
  assert.deepEqual(fichiers.get('2026-08-15 - Papeterie Roy - factureaoût.pdf'), c);

  const index = fichiers.get('registre-des-recus.csv').toString('utf8');
  assert.match(index, /Date;Fournisseur;Description;Catégorie;Montant HT;TPS \/ TVH;TVQ \/ TVP;Total TTC;Fichier/);
  assert.match(index, /2026-08-15;Papeterie Roy;Achat;Fournitures;100,00;5,00;9,98;114,98;2026-08-15 - Papeterie Roy - factureaoût\.pdf/);
  assert.ok(!index.includes('Hors période'), 'le reçu d\'octobre n\'appartient pas au troisième trimestre');
});

test('un reçu introuvable ne fait pas échouer l\'archive : l\'index le signale', async (t) => {
  const api = await avecAdmin(t);
  const d = await depense(api, '2026-03-10', 'Quincaillerie');
  const perdu = unPdf();
  await joindre(api, d.id, perdu, 'perdu.pdf');
  await joindre(api, d.id, unPdf(), 'present.pdf');
  fs.unlinkSync(path.join(repertoireLocal(api.db), crypto.createHash('sha256').update(perdu).digest('hex')));
  const erreurs = t.mock.method(console, 'error', () => {});

  const fichiers = lireZip((await telecharger(api, 'annee=2026&mois=3')).contenu);
  assert.deepEqual([...fichiers.keys()], ['2026-03-10 - Quincaillerie - present.pdf', 'registre-des-recus.csv']);
  assert.match(fichiers.get('registre-des-recus.csv').toString('utf8'), /introuvable : perdu\.pdf/);
  assert.equal(erreurs.mock.callCount(), 1, 'l\'absence est consignée');
});

test('en anglais, l\'archive et son index le sont aussi ; une période vide est refusée', async (t) => {
  const api = await avecAdmin(t);
  const d = await depense(api, '2026-05-20', 'Supplier');
  await joindre(api, d.id, unPdf(), 'receipt.pdf');

  const res = await telecharger(api, 'annee=2026&trimestre=2&langue=en');
  assert.match(res.entetes.get('content-disposition'), /filename="receipts-2026-Q2\.zip"/);
  const index = lireZip(res.contenu).get('receipts-register.csv').toString('utf8');
  assert.match(index, /Date,Supplier,Description,Category,Amount before tax,GST \/ HST,QST \/ PST,Total,File/);

  const vide = await telecharger(api, 'annee=2025');
  assert.equal(vide.status, 404);
  assert.equal(JSON.parse(vide.contenu.toString('utf8')).error, 'Aucun reçu n\'est joint aux dépenses de cette période.');
  assert.deepEqual((await api.get('/api/rapports/recus?annee=2025')).data, { nombre: 0, taille: 0 });

  // Comme les registres : réservé à l'administration et à la comptabilité.
  assert.equal((await api.post('/api/users', { username: 'employe', password: MOT_DE_PASSE, role: 'employe' })).status, 201);
  assert.equal((await api.post('/api/auth/login', { username: 'employe', password: MOT_DE_PASSE })).status, 200);
  assert.equal((await telecharger(api, 'annee=2026')).status, 403);
});
