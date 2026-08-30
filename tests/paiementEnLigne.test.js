/**
 * Paiement des factures en ligne.
 *
 * Ce qui est éprouvé ici n'est pas « Stripe répond » — c'est le faux serveur qui
 * répond — mais les deux propriétés dont dépend la justesse des comptes :
 *
 *  - un règlement encaissé une seule fois, quel que soit le nombre de relevés ;
 *  - un règlement qui n'a pas pu être imputé qui reste visible plutôt que de
 *    disparaître.
 *
 * Le troisième point de vigilance est la clé d'API : elle ne doit ni ressortir
 * par l'API, ni dormir en clair dans une base que les sauvegardes recopient
 * vers un dossier synchronisé.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer, MOT_DE_PASSE } = require('./helpers.js');
const { reset: resetRateLimit } = require('../rateLimit.js');
const { demarrerFauxStripe } = require('./fauxStripe.js');
const { encoderFormulaire, cleValide, modeDeLaCle } = require('../stripeService.js');
const { relever } = require('../paiementEnLigneService.js');

/**
 * Clés fictives.
 *
 * Les soulignés ne sont pas décoratifs : une suite de lettres et de chiffres
 * assez longue après `rk_live_` est reconnue par l'analyse de secrets de GitHub,
 * qui refuse alors la publication du dépôt entier. Une clé d'exemple doit donc
 * être manifestement une clé d'exemple, y compris pour une machine.
 */
const CLE_TEST = 'rk_test_CLE_FICTIVE_SANS_VALEUR_REELLE';
const CLE_LIVE = 'rk_live_CLE_FICTIVE_SANS_VALEUR_REELLE';

/**
 * Serveur applicatif, faux Stripe, administrateur connecté.
 *
 * `CLORA_STRIPE_BASE` n'est honorée que sous `NODE_ENV=test` : en production,
 * une variable d'environnement ne doit pas pouvoir détourner la clé d'API vers
 * un autre serveur.
 */
async function withStripe(t, { cle = CLE_LIVE, actif = true, refuserConfort = false } = {}) {
  resetRateLimit();

  const stripe = await demarrerFauxStripe({ refuserConfort });
  const ancienneBase = process.env.CLORA_STRIPE_BASE;
  process.env.CLORA_STRIPE_BASE = stripe.base;

  const api = await startTestServer();
  t.after(async () => {
    await api.close();
    await stripe.close();
    if (ancienneBase === undefined) delete process.env.CLORA_STRIPE_BASE;
    else process.env.CLORA_STRIPE_BASE = ancienneBase;
  });

  const setup = await api.post('/api/auth/setup', { username: 'patron', password: MOT_DE_PASSE });
  assert.equal(setup.status, 200, JSON.stringify(setup.data));

  if (cle) {
    const res = await api.put('/api/settings', {
      entreprise_nom: 'Plomberie Tremblay',
      stripe_cle: cle,
      stripe_actif: actif ? 1 : 0
    });
    assert.equal(res.status, 200, JSON.stringify(res.data));
  }

  return { api, stripe };
}

/** Crée un client et une facture, et renvoie la facture avec son solde. */
async function facture(api, { montant = 100, province = 'QC' } = {}) {
  const client = await api.post('/api/clients', {
    nom_entreprise: 'Boulangerie Côté',
    email: 'info@cote.ca',
    province
  });
  assert.equal(client.status, 201, JSON.stringify(client.data));

  const creee = await api.post('/api/factures', {
    client_id: client.data.client.id,
    date_emission: '2026-08-01',
    lignes: [{ description: 'Travaux', quantite: 1, prix_unitaire: montant }]
  });
  assert.equal(creee.status, 201, JSON.stringify(creee.data));

  const solde = await api.get(`/api/factures/${creee.data.facture.id}/solde`);
  return solde.data;
}

const demanderLien = (api, id) => api.post(`/api/paiements-en-ligne/factures/${id}/lien`);

// --- L'encodage réellement envoyé --------------------------------------------

test('les paramètres imbriqués sont encodés comme Stripe les attend', () => {
  const encode = encoderFormulaire({
    line_items: [{ price: 'price_1', quantity: 1 }],
    metadata: { facture: 'FAC-2026-0001' }
  }).join('&');

  // Stripe n'accepte pas un JSON ni un formulaire à plat : la structure passe
  // par des crochets, et la liste par un indice.
  assert.match(encode, /line_items%5B0%5D%5Bprice%5D=price_1/);
  assert.match(encode, /line_items%5B0%5D%5Bquantity%5D=1/);
  assert.match(encode, /metadata%5Bfacture%5D=FAC-2026-0001/);
});

test('une clé mal formée est reconnue avant tout appel réseau', () => {
  for (const bruit of ['', 'bonjour', 'pk_live_abc', null, undefined, 'rk_live_court']) {
    assert.equal(cleValide(bruit), false, JSON.stringify(bruit));
  }
  assert.equal(cleValide(CLE_LIVE), true);
  assert.equal(modeDeLaCle(CLE_TEST), 'test');
  assert.equal(modeDeLaCle(CLE_LIVE), 'live');
});

// --- La création du lien ------------------------------------------------------

test('sans configuration, aucune facture ne porte de lien et rien ne part', async (t) => {
  const { api, stripe } = await withStripe(t, { cle: null });
  const f = await facture(api);

  const res = await demanderLien(api, f.id);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.lien, null);
  assert.equal(stripe.appels.length, 0, 'aucun appel ne doit partir vers Stripe');
});

test('le lien porte le solde restant, et non le total facturé', async (t) => {
  const { api, stripe } = await withStripe(t);
  const f = await facture(api, { montant: 100 });

  // Un acompte de 50 $ a déjà été encaissé : demander le total au client
  // reviendrait à le faire payer deux fois une partie de la facture.
  const acompte = await api.post(`/api/factures/${f.id}/paiements`, { montant: 50 });
  assert.equal(acompte.status, 200, JSON.stringify(acompte.data));

  const res = await demanderLien(api, f.id);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.ok(res.data.lien.url.startsWith('https://buy.stripe.example/'));

  const prix = stripe.appels.find((a) => a.chemin === '/v1/prices');
  assert.equal(Number(prix.champs.unit_amount), Math.round((f.solde_restant - 50) * 100));
  assert.equal(prix.champs.currency, 'cad');
  assert.equal(res.data.lien.montant, Math.round((f.solde_restant - 50) * 100) / 100);
});

test('la requête porte la clé et la version d\'API figée', async (t) => {
  const { api, stripe } = await withStripe(t);
  const f = await facture(api);
  await demanderLien(api, f.id);

  const appel = stripe.appels.find((a) => a.chemin === '/v1/payment_links');
  assert.equal(appel.entetes.authorization, `Bearer ${CLE_LIVE}`);
  assert.match(appel.entetes['stripe-version'], /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(appel.entetes['idempotency-key'], 'un rejeu ne doit pas créer un second lien');
  assert.equal(appel.champs['metadata[facture]'], (await api.get(`/api/factures/${f.id}/solde`)).data.numero_facture);
});

test('un second affichage réutilise le lien au lieu d\'en créer un autre', async (t) => {
  const { api, stripe } = await withStripe(t);
  const f = await facture(api);

  const premier = await demanderLien(api, f.id);
  const second = await demanderLien(api, f.id);

  assert.equal(second.data.lien.url, premier.data.lien.url);
  // Deux liens vivants pour une même facture, c'est un client qui peut payer
  // deux fois : c'est le défaut que cette réutilisation existe pour empêcher.
  assert.equal(stripe.compter('/v1/payment_links'), 1);
});

test('un acompte encaissé entre-temps retire l\'ancien lien et en crée un juste', async (t) => {
  const { api, stripe } = await withStripe(t);
  const f = await facture(api, { montant: 100 });

  const premier = await demanderLien(api, f.id);
  await api.post(`/api/factures/${f.id}/paiements`, { montant: 40 });
  const second = await demanderLien(api, f.id);

  assert.notEqual(second.data.lien.url, premier.data.lien.url);
  assert.equal(stripe.compter('/v1/payment_links'), 2);

  // L'ancien lien portait l'ancien montant : le laisser vivant ferait payer au
  // client une somme qu'il ne doit plus.
  const ancien = stripe.liens.get('plink_2');
  assert.equal(ancien.active, false, 'le lien périmé doit être désactivé chez Stripe');
});

test('un retour au montant d\'origine ne ressort pas le lien désactivé', async (t) => {
  const { api, stripe } = await withStripe(t);
  const f = await facture(api, { montant: 100 });

  const premier = await demanderLien(api, f.id);

  // Acompte, puis annulation de cet acompte : le solde redevient exactement
  // celui du départ. Stripe rejoue une clé d'idempotence pendant vingt-quatre
  // heures — si la clé ne dépendait que du montant, il rendrait ici le tout
  // premier lien, celui qu'on vient justement de désactiver, et le client
  // recevrait une adresse morte.
  const acompte = await api.post(`/api/factures/${f.id}/paiements`, { montant: 40 });
  await demanderLien(api, f.id);

  const paiement = await api.db.get('SELECT id FROM paiements WHERE facture_id = ?', [f.id]);
  const annulation = await api.del(`/api/factures/paiements/${paiement.id}`, { motif: 'chèque sans provision' });
  assert.equal(annulation.status, 200, JSON.stringify(annulation.data));
  assert.ok(acompte.data);

  const troisieme = await demanderLien(api, f.id);
  assert.notEqual(troisieme.data.lien.url, premier.data.lien.url);

  // Le lien proposé doit être vivant chez Stripe : c'est tout l'enjeu.
  const rendu = stripe.liens.get(`plink_${troisieme.data.lien.url.split('/').pop()}`);
  assert.ok(rendu, 'le lien rendu doit exister chez Stripe');
  assert.equal(rendu.active, true);
});

test('un paramètre refusé par Stripe donne un lien dépouillé, jamais rien du tout', async (t) => {
  const { api } = await withStripe(t, { refuserConfort: true });
  const f = await facture(api);

  const res = await demanderLien(api, f.id);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.ok(res.data.lien.url, 'la facture doit rester payable');
});

test('une facture soldée ou annulée ne propose pas de lien', async (t) => {
  const { api } = await withStripe(t);
  const f = await facture(api, { montant: 100 });

  await api.post(`/api/factures/${f.id}/paiements`, { montant: f.solde_restant });
  const soldee = await demanderLien(api, f.id);
  assert.equal(soldee.data.lien, null);

  const autre = await facture(api, { montant: 100 });
  await api.put(`/api/factures/${autre.id}/cancel`, {});
  const annulee = await demanderLien(api, autre.id);
  assert.equal(annulee.data.lien, null);
});

// --- Le relevé des règlements -------------------------------------------------

test('un règlement reçu est porté aux comptes, et une seule fois', async (t) => {
  const { api, stripe } = await withStripe(t);
  const f = await facture(api, { montant: 100 });

  const lien = await demanderLien(api, f.id);
  stripe.payer('plink_2', { montant: f.solde_restant });

  const premier = await api.post('/api/paiements-en-ligne/relever', {});
  assert.equal(premier.status, 200, JSON.stringify(premier.data));
  assert.equal(premier.data.inscrits, 1);

  const apres = await api.get(`/api/factures/${f.id}/solde`);
  assert.equal(apres.data.solde_restant, 0);
  assert.equal(apres.data.statut, 'Payée');

  // Le planificateur repasse toutes les heures : le même règlement ne doit pas
  // s'inscrire une seconde fois. C'est la contrainte d'unicité sur la session
  // qui l'empêche, et non la prudence de l'appelant.
  const second = await api.post('/api/paiements-en-ligne/relever', {});
  assert.equal(second.data.inscrits, 0);

  const paiements = await api.db.all('SELECT montant, note FROM paiements WHERE facture_id = ?', [f.id]);
  assert.equal(paiements.length, 1);
  assert.match(paiements[0].note, /Stripe/);

  assert.ok(lien.data.lien.url);
});

test('un débit préautorisé encore en cours n\'est pas encaissé', async (t) => {
  const { api, stripe } = await withStripe(t);
  const f = await facture(api, { montant: 100 });
  await demanderLien(api, f.id);

  // La session est ouverte, le mandat signé, mais l'argent n'est pas arrivé :
  // porter ce règlement aux comptes maintenant serait inscrire une somme qui
  // peut encore être refusée par la banque.
  stripe.payer('plink_2', { montant: f.solde_restant, etat: 'unpaid' });

  const bilan = await api.post('/api/paiements-en-ligne/relever', {});
  assert.equal(bilan.data.inscrits, 0);

  const apres = await api.get(`/api/factures/${f.id}/solde`);
  assert.equal(apres.data.solde_restant, f.solde_restant);

  // Le règlement se dénoue quelques jours plus tard : il doit alors être repris.
  stripe.sessions[0].payment_status = 'paid';
  const rattrapage = await api.post('/api/paiements-en-ligne/relever', {});
  assert.equal(rattrapage.data.inscrits, 1);
});

test('un règlement qu\'on ne peut pas imputer est consigné, pas perdu', async (t) => {
  const { api, stripe } = await withStripe(t);
  const f = await facture(api, { montant: 100 });
  await demanderLien(api, f.id);

  // Le client paie en ligne pendant que la facture est marquée réglée à la
  // main : l'argent est bien arrivé chez Stripe et doit rester visible.
  await api.post(`/api/factures/${f.id}/paiements`, { montant: f.solde_restant });
  stripe.payer('plink_2', { montant: f.solde_restant });

  const bilan = await api.post('/api/paiements-en-ligne/relever', {});
  assert.equal(bilan.data.inscrits, 0);
  assert.equal(bilan.data.refuses, 1);

  const souffrance = await api.get('/api/paiements-en-ligne/en-souffrance');
  assert.equal(souffrance.data.encaissements.length, 1);
  assert.equal(souffrance.data.encaissements[0].montant, f.solde_restant);
  assert.ok(souffrance.data.encaissements[0].message, 'le motif du refus doit être conservé');

  // Et le solde de la facture n'a pas bougé : rien n'a été encaissé deux fois.
  const apres = await api.get(`/api/factures/${f.id}/solde`);
  assert.equal(apres.data.montant_paye, f.solde_restant);
});

test('le lien est retiré de la circulation dès que la facture est soldée', async (t) => {
  const { api, stripe } = await withStripe(t);
  const f = await facture(api, { montant: 100 });
  await demanderLien(api, f.id);

  stripe.payer('plink_2', { montant: f.solde_restant });
  await api.post('/api/paiements-en-ligne/relever', {});

  assert.equal(stripe.liens.get('plink_2').active, false);

  // Le relevé suivant ne s'y intéresse plus : sans cela, chaque facture payée
  // resterait interrogée à chaque passage horaire, indéfiniment.
  const avant = stripe.compter('/v1/checkout/sessions', 'GET');
  await api.post('/api/paiements-en-ligne/relever', {});
  assert.equal(stripe.compter('/v1/checkout/sessions', 'GET'), avant);
});

test('l\'encaissement en ligne est consigné au journal d\'audit', async (t) => {
  const { api, stripe } = await withStripe(t);
  const f = await facture(api, { montant: 100 });
  await demanderLien(api, f.id);
  stripe.payer('plink_2', { montant: f.solde_restant });

  await api.post('/api/paiements-en-ligne/relever', {});

  const journal = await api.get('/api/audit');
  const serialise = JSON.stringify(journal.data);
  assert.match(serialise, /paiement\.en_ligne/);
  assert.match(serialise, /cs_test_1/);
});

test('une panne passagère diffère l\'encaissement au lieu de le condamner', async (t) => {
  const { api, stripe } = await withStripe(t);
  const f = await facture(api, { montant: 100 });
  await demanderLien(api, f.id);
  stripe.payer('plink_2', { montant: f.solde_restant });

  // Base momentanément inutilisable. Consigner ce règlement comme définitivement
  // refusé l'exclurait de tous les passages suivants : un encaissement bien réel
  // resterait hors des comptes pour une panne d'une minute.
  await api.db.exec('ALTER TABLE paiements RENAME TO paiements_hs');
  const pendant = await relever(api.db);
  assert.equal(pendant.inscrits, 0);
  assert.ok(pendant.erreurs >= 1, 'la panne doit être comptée, non passée sous silence');

  const consigne = await api.db.get('SELECT COUNT(*) AS n FROM encaissements_stripe');
  assert.equal(consigne.n, 0, 'aucun refus définitif ne doit être écrit');

  await api.db.exec('ALTER TABLE paiements_hs RENAME TO paiements');
  const apres = await relever(api.db);
  assert.equal(apres.inscrits, 1, 'le passage suivant doit rattraper le règlement');
});

test('le relevé ne lève pas quand Stripe est injoignable', async (t) => {
  const { api, stripe } = await withStripe(t);
  const f = await facture(api, { montant: 100 });
  await demanderLien(api, f.id);

  // Le planificateur appelle ce service toutes les heures : une panne de réseau
  // ne doit pas empêcher les relances ni la sauvegarde de s'exécuter ensuite.
  await stripe.close();

  const bilan = await relever(api.db);
  assert.equal(bilan.erreurs, 1);
  assert.equal(bilan.inscrits, 0);
});

// --- Le mode test -------------------------------------------------------------

test('une clé de test est signalée jusque sur la facture', async (t) => {
  const { api, stripe } = await withStripe(t, { cle: CLE_TEST });
  const f = await facture(api, { montant: 100 });

  const lien = await demanderLien(api, f.id);
  assert.equal(lien.data.lien.mode, 'test', "l'interface doit pouvoir l'afficher au client");

  const etat = await api.get('/api/paiements-en-ligne/etat');
  assert.equal(etat.data.mode, 'test');

  // L'argent est fictif : la note portée à l'encaissement doit le dire, sans
  // quoi rien ne distinguerait plus tard un essai d'un vrai règlement.
  stripe.payer('plink_2', { montant: f.solde_restant });
  await api.post('/api/paiements-en-ligne/relever', {});

  const paiement = await api.db.get('SELECT note FROM paiements WHERE facture_id = ?', [f.id]);
  assert.match(paiement.note, /MODE TEST/);
});

// --- La clé d'API -------------------------------------------------------------

test('la clé ne ressort jamais par l\'API et n\'est pas en clair dans la base', async (t) => {
  const { api } = await withStripe(t);

  const settings = await api.get('/api/settings');
  assert.equal(settings.data.stripe_cle_chiffree, undefined);
  assert.equal(JSON.stringify(settings.data).includes(CLE_LIVE), false, 'la clé ne doit pas transiter');
  assert.equal(settings.data.stripe_cle_definie, true);
  assert.equal(settings.data.stripe_mode, 'live');

  // En base, la valeur porte le préfixe posé par le coffre — ici « clair: »,
  // faute d'Electron sous test — et non la clé telle qu'elle a été saisie.
  const ligne = await api.db.get('SELECT stripe_cle_chiffree FROM settings LIMIT 1');
  assert.notEqual(ligne.stripe_cle_chiffree, CLE_LIVE);
  assert.match(ligne.stripe_cle_chiffree, /^(coffre|clair):/);
});

test('une clé mal formée est refusée à l\'enregistrement', async (t) => {
  const { api } = await withStripe(t, { cle: null });

  const res = await api.put('/api/settings', {
    entreprise_nom: 'Plomberie Tremblay',
    stripe_cle: 'pk_live_ceci_est_une_cle_publiable'
  });
  assert.equal(res.status, 400, JSON.stringify(res.data));
  assert.match(res.data.error, /rk_live_/);
});

test('activer le paiement en ligne sans clé est refusé', async (t) => {
  const { api } = await withStripe(t, { cle: null });

  const res = await api.put('/api/settings', {
    entreprise_nom: 'Plomberie Tremblay',
    stripe_actif: 1
  });
  assert.equal(res.status, 400, JSON.stringify(res.data));
  assert.match(res.data.error, /clé Stripe/i);
});

test('une clé devenue illisible désactive le paiement sans le taire', async (t) => {
  const { api } = await withStripe(t);

  // C'est l'état d'une base restaurée sur une autre machine : le coffre du
  // système ne sait plus déchiffrer ce qu'un autre poste a écrit.
  await api.db.run("UPDATE settings SET stripe_cle_chiffree = 'coffre:AAAA'");

  const etat = await api.get('/api/paiements-en-ligne/etat');
  assert.equal(etat.data.actif, false);
  assert.equal(etat.data.cle_illisible, true);

  const settings = await api.get('/api/settings');
  assert.equal(settings.data.stripe_cle_illisible, true);
});

test('le retrait de la clé coupe le paiement en ligne', async (t) => {
  const { api } = await withStripe(t);

  const res = await api.put('/api/settings', {
    entreprise_nom: 'Plomberie Tremblay',
    stripe_cle_effacer: true
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.settings.stripe_cle_definie, false);
  assert.equal(res.data.settings.stripe_actif, 0);
});

test('la vérification de connexion éprouve la lecture des règlements', async (t) => {
  const { api, stripe } = await withStripe(t);

  const res = await api.post('/api/settings/stripe/test', {});
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.mode, 'live');
  assert.equal(res.data.nom, 'Plomberie Tremblay');

  // Une clé qui saurait créer des liens sans pouvoir relire les sessions
  // passerait un contrôle plus complaisant, et l'utilisateur ne s'en
  // apercevrait qu'au premier encaissement jamais inscrit.
  assert.ok(stripe.appels.some((a) => a.chemin === '/v1/checkout/sessions' && a.methode === 'GET'));
});

test('une clé refusée par Stripe donne un message lisible', async (t) => {
  const { api } = await withStripe(t, { cle: 'rk_live_mauvaise_cle_totalement_invalide' });

  const res = await api.post('/api/settings/stripe/test', {});
  assert.equal(res.status, 400, JSON.stringify(res.data));
  assert.match(res.data.error, /Invalid API Key/);
});

// --- Les rôles ----------------------------------------------------------------

test('un employé demande un lien mais ne relève pas les règlements', async (t) => {
  const { api } = await withStripe(t);
  const f = await facture(api, { montant: 100 });

  await api.post('/api/users', { username: 'employe', password: MOT_DE_PASSE, role: 'employe' });
  api.clearCookie();
  await api.post('/api/auth/login', { username: 'employe', password: MOT_DE_PASSE });

  // Il envoie les factures qu'il émet : lui refuser le lien reviendrait à lui
  // faire envoyer des factures amputées de leur moyen de paiement.
  const lien = await demanderLien(api, f.id);
  assert.equal(lien.status, 200, JSON.stringify(lien.data));
  assert.ok(lien.data.lien.url);

  // Le relevé porte des sommes aux comptes : c'est de la trésorerie.
  const releve = await api.post('/api/paiements-en-ligne/relever', {});
  assert.equal(releve.status, 403, JSON.stringify(releve.data));
});
