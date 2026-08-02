/**
 * Registres exportables en CSV.
 *
 * Un export n'est utile que si le destinataire peut l'ouvrir : ces tests
 * portent autant sur l'encodage et l'échappement que sur les montants.
 */

const test = require('node:test');
const assert = require('node:assert');

const { startTestServer, insertClient, MOT_DE_PASSE } = require('./helpers.js');
const { reset: resetRateLimit } = require('../rateLimit.js');
const { versCSV, echapper, montant, nomFichier, BOM } = require('../exportService.js');

async function avecAdmin(t) {
  resetRateLimit();
  const api = await startTestServer();
  t.after(() => api.close());

  const res = await api.post('/api/auth/setup', { username: 'patron', password: MOT_DE_PASSE });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return api;
}

async function sessionPour(api, role) {
  const creation = await api.post('/api/users', {
    username: `compte_${role}`, password: MOT_DE_PASSE, role
  });
  assert.equal(creation.status, 201, JSON.stringify(creation.data));
  const login = await api.post('/api/auth/login', {
    username: `compte_${role}`, password: MOT_DE_PASSE
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));
}

/** Crée une facture et rend l'objet renvoyé par l'API. */
async function creerFacture(api, clientId, options = {}) {
  const res = await api.post('/api/factures', {
    client_id: clientId,
    date_emission: options.date_emission || '2026-07-15',
    date_echeance: options.date_echeance || '2026-08-14',
    lignes: [{ description: 'Prestation', quantite: 1, prix_unitaire: options.prix || 100 }]
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data.facture;
}

/** Récupère un export brut, sans passer par l'analyse JSON du client de test. */
async function telecharger(api, chemin) {
  const reponse = await fetch(`${api.base}${chemin}`, { headers: { Cookie: api.cookie() } });
  return { statut: reponse.status, entetes: reponse.headers, texte: await reponse.text() };
}

/** Découpe un CSV en tableau de champs, BOM retiré. */
function analyser(texte) {
  return texte.replace(/^﻿/, '').trim().split('\r\n').map((l) => l.split(';'));
}

/* --- Le format --- */

test('l\'échappement suit la RFC 4180', () => {
  assert.equal(echapper('simple'), 'simple');
  // Sans guillemets, un point-virgule dans un nom décalerait toutes les colonnes.
  assert.equal(echapper('Ateliers Bélanger; Cie'), '"Ateliers Bélanger; Cie"');
  assert.equal(echapper('Dit «"le grand"»'), '"Dit «""le grand""»"');
  assert.equal(echapper('deux\nlignes'), '"deux\nlignes"');
  assert.equal(echapper(null), '');
});

test('les montants sortent avec une virgule décimale', () => {
  assert.equal(montant(1234.5), '1234,50');
  assert.equal(montant(0), '0,00');
  // L'arithmétique binaire ne doit pas transparaître dans le fichier livré.
  assert.equal(montant(0.1 + 0.2), '0,30');
  assert.equal(montant(null), '');
});

test('le fichier porte le BOM et des fins de ligne Windows', () => {
  const csv = versCSV(
    [{ cle: 'nom', titre: 'Nom' }, { cle: 'total', titre: 'Total', type: 'montant' }],
    [{ nom: 'Bélanger', total: 12.3 }]
  );

  // Sans BOM, Excel lit l'UTF-8 comme de l'ANSI et affiche « BÃ©langer ».
  assert.ok(csv.startsWith(BOM), 'le BOM doit ouvrir le fichier');
  assert.ok(csv.includes('\r\n'), 'les fins de ligne doivent être Windows');
  assert.equal(analyser(csv)[1][0], 'Bélanger');
});

test('le nom de fichier reflète la période', () => {
  assert.equal(nomFichier('registre-ventes'), 'registre-ventes.csv');
  assert.equal(nomFichier('registre-ventes', { annee: '2026' }), 'registre-ventes-2026.csv');
  assert.equal(nomFichier('registre-ventes', { annee: '2026', mois: '7' }), 'registre-ventes-2026-07.csv');
});

/* --- Le registre des ventes --- */

test('le registre des ventes reprend les montants figés', async (t) => {
  const api = await avecAdmin(t);
  const clientId = await insertClient(api.db, { nom: 'Client Test', province: 'QC' });
  const facture = await creerFacture(api, clientId, { prix: 100 });

  const { statut, entetes, texte } = await telecharger(api, '/api/rapports/export/ventes');

  assert.equal(statut, 200);
  assert.match(entetes.get('content-type'), /text\/csv/);
  assert.match(entetes.get('content-disposition'), /attachment; filename="registre-ventes/);

  const lignes = analyser(texte);
  assert.equal(lignes[0][0], 'Numéro');
  assert.equal(lignes.length, 2, 'une facture, donc une ligne de données');

  const ligne = lignes[1];
  assert.equal(ligne[0], facture.numero_facture);
  assert.equal(ligne[3], 'Client Test');

  // Les montants exportés doivent être ceux arrêtés à l'émission, à l'identique.
  assert.equal(ligne[5], montant(facture.sous_total));
  assert.equal(ligne[10], montant(facture.montant_total));
});

test('un nom de client contenant un point-virgule ressort intact', async (t) => {
  const api = await avecAdmin(t);
  const clientId = await insertClient(api.db, { nom: 'Ateliers Bélanger; Cie' });
  await creerFacture(api, clientId);

  const { texte } = await telecharger(api, '/api/rapports/export/ventes');

  // Le champ est protégé par des guillemets : le découpage naïf ci-dessous le
  // rendrait donc en deux morceaux, ce qui prouve que la protection est là.
  assert.ok(texte.includes('"Ateliers Bélanger; Cie"'), 'le nom doit être entre guillemets');

  // Et une lecture respectueuse des guillemets retrouve bien le nom entier.
  const champs = texte.replace(/^﻿/, '').trim().split('\r\n')[1].match(/("[^"]*"|[^;]*)/g);
  assert.ok(champs.some((c) => c === '"Ateliers Bélanger; Cie"'));
});

test('une facture annulée est absente du registre', async (t) => {
  const api = await avecAdmin(t);
  const clientId = await insertClient(api.db, { nom: 'Client' });
  const gardee = await creerFacture(api, clientId);
  const annulee = await creerFacture(api, clientId);

  const res = await api.put(`/api/factures/${annulee.id}/cancel`);
  assert.equal(res.status, 200, JSON.stringify(res.data));

  const { texte } = await telecharger(api, '/api/rapports/export/ventes');

  assert.ok(texte.includes(gardee.numero_facture));
  assert.ok(!texte.includes(annulee.numero_facture), 'une facture annulée n\'a rien à déclarer');
});

test('le filtre de période restreint le registre', async (t) => {
  const api = await avecAdmin(t);
  const clientId = await insertClient(api.db, { nom: 'Client' });
  const juin = await creerFacture(api, clientId, { date_emission: '2026-06-10', date_echeance: '2026-07-10' });
  const juillet = await creerFacture(api, clientId, { date_emission: '2026-07-10', date_echeance: '2026-08-09' });

  const { texte } = await telecharger(api, '/api/rapports/export/ventes?annee=2026&mois=07');

  assert.ok(texte.includes(juillet.numero_facture));
  assert.ok(!texte.includes(juin.numero_facture));
});

/* --- Le registre des encaissements --- */

test('un paiement annulé n\'apparaît pas au registre des encaissements', async (t) => {
  const api = await avecAdmin(t);
  const clientId = await insertClient(api.db, { nom: 'Client' });
  const facture = await creerFacture(api, clientId, { prix: 100 });

  await api.post(`/api/factures/${facture.id}/paiements`, { montant: 20, note: 'Acompte conservé' });
  await api.post(`/api/factures/${facture.id}/paiements`, { montant: 30, note: 'Saisi à tort' });

  const aAnnuler = await api.db.get(
    'SELECT id FROM paiements WHERE note = ? LIMIT 1', ['Saisi à tort']
  );
  const annulation = await api.del(`/api/factures/paiements/${aAnnuler.id}`, { motif: 'Erreur' });
  assert.equal(annulation.status, 200, JSON.stringify(annulation.data));

  const { texte } = await telecharger(api, '/api/rapports/export/encaissements');
  const lignes = analyser(texte);

  assert.equal(lignes.length, 2, 'seul le paiement actif doit figurer');
  assert.ok(texte.includes('Acompte conservé'));
  // Un encaissement annulé gonflerait les rentrées déclarées au fisc.
  assert.ok(!texte.includes('Saisi à tort'));
});

test('l\'origine du paiement est indiquée', async (t) => {
  const api = await avecAdmin(t);
  const clientId = await insertClient(api.db, { nom: 'Client' });
  const facture = await creerFacture(api, clientId, { prix: 100 });
  await api.post(`/api/factures/${facture.id}/paiements`, { montant: 10 });

  const { texte } = await telecharger(api, '/api/rapports/export/encaissements');

  assert.ok(texte.includes('Saisie manuelle'));
});

/* --- Accès --- */

test('les registres sont réservés à l\'administration et à la comptabilité', async (t) => {
  const api = await avecAdmin(t);

  await sessionPour(api, 'employe');
  const refus = await telecharger(api, '/api/rapports/export/ventes');
  assert.equal(refus.statut, 403);

  await api.post('/api/auth/login', { username: 'patron', password: MOT_DE_PASSE });
  await sessionPour(api, 'comptable');
  const accepte = await telecharger(api, '/api/rapports/export/ventes');
  assert.equal(accepte.statut, 200);
});

test('une période invalide est refusée', async (t) => {
  const api = await avecAdmin(t);

  assert.equal((await telecharger(api, '/api/rapports/export/ventes?annee=26')).statut, 400);
  assert.equal((await telecharger(api, '/api/rapports/export/ventes?mois=13')).statut, 400);
});
