/**
 * Conditions de paiement.
 *
 * Le point délicat n'est pas le calcul de l'échéance, mais le fait que le terme
 * soit **figé** sur la facture : changer les conditions d'un client ne doit
 * jamais déplacer l'échéance d'un document déjà remis.
 */

const test = require('node:test');
const assert = require('node:assert');

const { createTestDb, insertClient, startTestServer, MOT_DE_PASSE } = require('./helpers.js');
const { reset: resetRateLimit } = require('../rateLimit.js');
const { createFacture } = require('../invoiceService.js');
const { createDevis, convertDevisToFacture } = require('../devisService.js');
const {
  calculerEcheance, joursDeCondition, normaliserCondition, libelleCondition, CONDITIONS
} = require('../paymentTerms.js');

const LIGNES = [{ description: 'Prestation', quantite: 1, prix_unitaire: 100 }];

async function prepare(t) {
  const db = await createTestDb();
  t.after(() => db.__cleanup());
  return db;
}

/** Crée un client portant le terme demandé. */
async function clientAvecTerme(db, terme, nom = 'Client') {
  const id = await insertClient(db, { nom, email: `${nom}@x.ca` });
  await db.run('UPDATE clients SET conditions_paiement = ? WHERE id = ?', [terme, id]);
  return id;
}

/* --- Le calcul --- */

test('chaque terme donne le bon nombre de jours', () => {
  assert.equal(joursDeCondition('reception'), 0);
  assert.equal(joursDeCondition('net15'), 15);
  assert.equal(joursDeCondition('net30'), 30);
  assert.equal(joursDeCondition('net60'), 60);
});

test('un terme inconnu retombe sur Net 30 sans lever', () => {
  // Une fiche client par ailleurs valide ne doit pas être rejetée à cause d'un
  // terme fantaisiste venu d'un import ou d'une version antérieure.
  assert.equal(normaliserCondition('net-quarante-deux'), 'net30');
  assert.equal(normaliserCondition(undefined), 'net30');
  assert.equal(normaliserCondition(null), 'net30');
  assert.equal(libelleCondition('net15'), 'Net 15 jours');
});

test('l\'échéance franchit correctement les fins de mois et les années', () => {
  assert.equal(calculerEcheance('2026-07-01', 'net30'), '2026-07-31');
  assert.equal(calculerEcheance('2026-07-15', 'reception'), '2026-07-15');
  // Février 2028 est bissextile : le calcul ne doit pas s'appuyer sur des mois
  // de trente jours.
  assert.equal(calculerEcheance('2028-02-01', 'net30'), '2028-03-02');
  assert.equal(calculerEcheance('2026-12-15', 'net60'), '2027-02-13');
});

test('le calcul ne dépend pas du fuseau horaire', () => {
  // Un `new Date('2026-07-01')` interprété en heure locale, puis décalé, peut
  // rendre le 30 juin sous un fuseau négatif : la date doit rester stable.
  const avant = process.env.TZ;
  try {
    process.env.TZ = 'America/Vancouver';
    assert.equal(calculerEcheance('2026-07-01', 'net30'), '2026-07-31');
    process.env.TZ = 'Pacific/Kiritimati';
    assert.equal(calculerEcheance('2026-07-01', 'net30'), '2026-07-31');
  } finally {
    process.env.TZ = avant;
  }
});

/* --- L'application au document --- */

test('la facture reprend le terme du client et en déduit son échéance', async (t) => {
  const db = await prepare(t);
  const clientId = await clientAvecTerme(db, 'net15');

  const facture = await createFacture(db, {
    client_id: clientId, date_emission: '2026-07-01'
  }, LIGNES);

  assert.equal(facture.conditions_paiement, 'net15');
  const enBase = await db.get('SELECT date_echeance FROM factures WHERE id = ?', [facture.id]);
  assert.equal(enBase.date_echeance, '2026-07-16');
});

test('une échéance saisie explicitement l\'emporte sur le terme', async (t) => {
  const db = await prepare(t);
  const clientId = await clientAvecTerme(db, 'net30');

  const facture = await createFacture(db, {
    client_id: clientId, date_emission: '2026-07-01', date_echeance: '2026-07-10'
  }, LIGNES);

  // Un accord ponctuel reste possible sans toucher à la fiche du client.
  const enBase = await db.get('SELECT date_echeance FROM factures WHERE id = ?', [facture.id]);
  assert.equal(enBase.date_echeance, '2026-07-10');
});

test('changer le terme d\'un client ne déplace pas les factures déjà émises', async (t) => {
  const db = await prepare(t);
  const clientId = await clientAvecTerme(db, 'net15');

  const facture = await createFacture(db, {
    client_id: clientId, date_emission: '2026-07-01'
  }, LIGNES);
  const avant = await db.get('SELECT date_echeance, conditions_paiement FROM factures WHERE id = ?', [facture.id]);

  await db.run('UPDATE clients SET conditions_paiement = ? WHERE id = ?', ['net60', clientId]);

  const apres = await db.get('SELECT date_echeance, conditions_paiement FROM factures WHERE id = ?', [facture.id]);
  assert.deepEqual(apres, avant, 'le terme est figé à l\'émission, comme les taux de taxe');
});

test('la conversion d\'un devis applique le terme du client', async (t) => {
  const db = await prepare(t);
  const clientId = await clientAvecTerme(db, 'net60');

  const devis = await createDevis(db, {
    client_id: clientId, date_emission: '2026-07-01', date_validite: '2026-07-31'
  }, LIGNES);
  const facture = await convertDevisToFacture(db, devis.id);

  assert.equal(facture.conditions_paiement, 'net60');

  // La facture est émise au jour de la conversion : son échéance doit être à
  // soixante jours de là, et non aux trente jours autrefois imposés à tous.
  const enBase = await db.get(
    'SELECT date_emission, date_echeance FROM factures WHERE id = ?', [facture.id]
  );
  assert.equal(enBase.date_echeance, calculerEcheance(enBase.date_emission, 'net60'));
});

test('un client sans terme enregistré retombe sur Net 30', async (t) => {
  const db = await prepare(t);
  const clientId = await insertClient(db, { nom: 'Sans terme' });
  await db.run('UPDATE clients SET conditions_paiement = NULL WHERE id = ?', [clientId]);

  const facture = await createFacture(db, {
    client_id: clientId, date_emission: '2026-07-01'
  }, LIGNES);

  assert.equal(facture.conditions_paiement, 'net30');
  const enBase = await db.get('SELECT date_echeance FROM factures WHERE id = ?', [facture.id]);
  assert.equal(enBase.date_echeance, '2026-07-31');
});

/* --- API et journal --- */

test('le terme se saisit et se relit par l\'API', async (t) => {
  resetRateLimit();
  const api = await startTestServer();
  t.after(() => api.close());
  await api.post('/api/auth/setup', { username: 'patron', password: MOT_DE_PASSE });

  const cree = await api.post('/api/clients', {
    nom_entreprise: 'Ateliers Roy', email: 'roy@x.ca', province: 'QC',
    nom_contact: 'Roy', adresse: '1 rue', conditions_paiement: 'net60'
  });
  assert.equal(cree.status, 201, JSON.stringify(cree.data));
  assert.equal(cree.data.client.conditions_paiement, 'net60');

  const modifie = await api.put(`/api/clients/${cree.data.client.id}`, {
    nom_entreprise: 'Ateliers Roy', email: 'roy@x.ca', province: 'QC',
    nom_contact: 'Roy', adresse: '1 rue', conditions_paiement: 'reception'
  });
  assert.equal(modifie.data.client.conditions_paiement, 'reception');

  // Le terme conditionne l'échéance de toutes les factures à venir : le voir
  // changer sans savoir qui l'a fait poserait le problème que le journal résout.
  const trace = await api.db.get(
    'SELECT details FROM logs_audit WHERE action = ? ORDER BY id DESC LIMIT 1',
    ['client.modification']
  );
  const { changements } = JSON.parse(trace.details);
  assert.deepEqual(changements.conditions_paiement, { avant: 'net60', apres: 'reception' });
});

test('les termes disponibles sont exposés à l\'interface', () => {
  assert.equal(CONDITIONS.length, 4);
  assert.deepEqual(CONDITIONS.map((c) => c.valeur), ['reception', 'net15', 'net30', 'net60']);
});

test('les deux copies des conditions restent alignées', () => {
  // La liste est dupliquée dans client/src/api.js, faute de module partagé
  // entre le serveur et l'interface — comme formatMontant. Une divergence
  // proposerait à l'écran un terme que le serveur ramènerait silencieusement
  // à Net 30, et l'échéance affichée ne serait pas celle enregistrée.
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'client', 'src', 'api.js'), 'utf8');

  const bloc = source.slice(source.indexOf('export const CONDITIONS'));
  for (const { valeur, libelle, jours } of CONDITIONS) {
    assert.ok(
      bloc.includes(`valeur: '${valeur}', libelle: '${libelle}', jours: ${jours}`),
      `le terme ${valeur} doit être identique côté interface`
    );
  }

  // Et le calcul d'échéance doit lui aussi raisonner en UTC des deux côtés.
  assert.match(bloc, /T00:00:00Z/, 'même construction de date');
  assert.match(bloc, /setUTCDate/, 'même décalage en UTC');
});

test('l\'API accepte une facture sans échéance et applique le terme', async (t) => {
  resetRateLimit();
  const api = await startTestServer();
  t.after(() => api.close());
  await api.post('/api/auth/setup', { username: 'patron', password: MOT_DE_PASSE });

  const client = await api.post('/api/clients', {
    nom_entreprise: 'Studio Ng', email: 'ng@x.ca', province: 'QC',
    nom_contact: 'Ng', adresse: '1 rue', conditions_paiement: 'net60'
  });

  // La route exigeait une date d'échéance avant même d'atteindre le service :
  // le calcul par terme n'était donc jamais atteint depuis l'interface.
  const cree = await api.post('/api/factures', {
    client_id: client.data.client.id,
    date_emission: '2026-07-01',
    lignes: [{ description: 'Prestation', quantite: 1, prix_unitaire: 100 }]
  });

  assert.equal(cree.status, 201, JSON.stringify(cree.data));
  assert.equal(cree.data.facture.conditions_paiement, 'net60');

  const enBase = await api.db.get(
    'SELECT date_echeance FROM factures WHERE id = ?', [cree.data.facture.id]
  );
  assert.equal(enBase.date_echeance, '2026-08-30');
});

test('une échéance mal formée reste refusée', async (t) => {
  resetRateLimit();
  const api = await startTestServer();
  t.after(() => api.close());
  await api.post('/api/auth/setup', { username: 'patron', password: MOT_DE_PASSE });

  const client = await api.post('/api/clients', {
    nom_entreprise: 'Client', email: 'c@x.ca', province: 'QC', nom_contact: 'C', adresse: '1 rue'
  });

  // Accepter l'absence ne doit pas revenir à accepter n'importe quoi : un champ
  // mal saisi ne doit pas passer pour une omission.
  const res = await api.post('/api/factures', {
    client_id: client.data.client.id,
    date_emission: '2026-07-01',
    date_echeance: '31-07-2026',
    lignes: [{ description: 'Prestation', quantite: 1, prix_unitaire: 100 }]
  });

  assert.equal(res.status, 400);
  assert.match(res.data.error, /échéance est invalide/);
});

test('modifier une facture sans renvoyer l\'échéance ne l\'efface pas', async (t) => {
  resetRateLimit();
  const api = await startTestServer();
  t.after(() => api.close());
  await api.post('/api/auth/setup', { username: 'patron', password: MOT_DE_PASSE });

  const client = await api.post('/api/clients', {
    nom_entreprise: 'Client', email: 'c@x.ca', province: 'QC', nom_contact: 'C', adresse: '1 rue'
  });
  const cree = await api.post('/api/factures', {
    client_id: client.data.client.id,
    date_emission: '2026-07-01',
    date_echeance: '2026-07-20',
    lignes: [{ description: 'Prestation', quantite: 1, prix_unitaire: 100 }]
  });

  // La colonne est NOT NULL : sans garde, la modification échouerait ou
  // effacerait une date convenue avec le client.
  const modifiee = await api.put(`/api/factures/${cree.data.facture.id}`, {
    client_id: client.data.client.id,
    lignes: [{ description: 'Prestation revue', quantite: 2, prix_unitaire: 100 }]
  });

  assert.equal(modifiee.status, 200, JSON.stringify(modifiee.data));
  const enBase = await api.db.get(
    'SELECT date_echeance FROM factures WHERE id = ?', [cree.data.facture.id]
  );
  assert.equal(enBase.date_echeance, '2026-07-20');
});
