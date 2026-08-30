/**
 * Accès à l'API de Stripe, sans dépendance.
 *
 * Stripe expose une API REST ordinaire : des paramètres encodés comme ceux d'un
 * formulaire, une réponse en JSON, une clé passée en en-tête. Node sait déjà
 * tout faire ; la bibliothèque officielle n'apporterait ici qu'une arborescence
 * de plus à surveiller sur un logiciel qui détient une comptabilité.
 *
 * Deux précautions structurent ce module :
 *
 *  - **la version de l'API est figée.** Sans cela, Stripe ferait évoluer la
 *    forme des réponses sous une installation déjà livrée, que personne ne
 *    mettra à jour avant des mois.
 *  - **la clé ne sort jamais d'ici.** Elle n'est ni journalisée, ni renvoyée
 *    par l'API de Clora, ni écrite en clair dans la base (voir
 *    `secretStorage.js`). Les messages d'erreur de Stripe sont transmis tels
 *    quels — ils décrivent la requête, jamais le secret.
 */

const http = require('http');
const https = require('https');

/** Racine de l'API. */
const BASE_PRODUCTION = 'https://api.stripe.com';

/**
 * Version de l'API appelée.
 *
 * Figée volontairement : Stripe garantit qu'une version publiée continue de
 * répondre à l'identique, et c'est la seule façon qu'une version de Clora
 * installée aujourd'hui se comporte encore de la même manière dans deux ans.
 */
const VERSION_API = '2024-06-20';

/** Au-delà, la requête est abandonnée : une facture ne doit pas rester figée. */
const DELAI_MS = 20000;

/** Réponse maximale acceptée, pour qu'un flux inattendu ne sature pas la mémoire. */
const MAX_REPONSE = 2 * 1024 * 1024;

/** Préfixes de clés acceptés : clé restreinte, puis clé secrète complète. */
const PREFIXES_VALIDES = ['rk_live_', 'rk_test_', 'sk_live_', 'sk_test_'];

/**
 * Racine des appels.
 *
 * La redirection vers un serveur local est réservée aux tests. Sans cette
 * condition sur `NODE_ENV`, une simple variable d'environnement suffirait à
 * détourner la clé d'API d'une installation réelle vers un serveur tiers.
 */
function base() {
  if (process.env.NODE_ENV === 'test' && process.env.CLORA_STRIPE_BASE) {
    return process.env.CLORA_STRIPE_BASE;
  }
  return BASE_PRODUCTION;
}

/**
 * Encode un objet dans la notation attendue par Stripe.
 *
 * Les structures imbriquées s'écrivent `a[b][c]=v`, les listes `a[0]=v` — c'est
 * la convention de l'API, et non un simple `application/x-www-form-urlencoded`
 * à plat.
 */
function encoderFormulaire(valeur, prefixe = '') {
  if (valeur === undefined || valeur === null) return [];

  if (Array.isArray(valeur)) {
    return valeur.flatMap((v, i) => encoderFormulaire(v, `${prefixe}[${i}]`));
  }
  if (typeof valeur === 'object') {
    return Object.entries(valeur).flatMap(([cle, v]) => (
      encoderFormulaire(v, prefixe ? `${prefixe}[${cle}]` : cle)
    ));
  }
  return [`${encodeURIComponent(prefixe)}=${encodeURIComponent(String(valeur))}`];
}

/** Indique si la chaîne ressemble à une clé d'API utilisable. */
function cleValide(cle) {
  return typeof cle === 'string' && PREFIXES_VALIDES.some((p) => cle.startsWith(p)) && cle.length > 20;
}

/**
 * Mode d'une clé : les clés de test ne déplacent aucun argent réel.
 * @returns {'test'|'live'}
 */
function modeDeLaCle(cle) {
  return String(cle || '').includes('_test_') ? 'test' : 'live';
}

/** Vraie pour une clé restreinte, celle qu'il faut employer sur un poste client. */
function estRestreinte(cle) {
  return String(cle || '').startsWith('rk_');
}

/**
 * Construit l'erreur remontée à l'utilisateur à partir d'une réponse en échec.
 *
 * Le message de Stripe est conservé : « No such price » ou « Your account
 * cannot currently make live charges » dit quoi corriger, là où un « erreur
 * Stripe » poli n'apprend rien.
 */
function erreurStripe(statut, corps) {
  const detail = corps && corps.error ? corps.error : {};
  const message = detail.message || `Stripe a refusé la requête (code ${statut}).`;

  // 401 et 403 sont des erreurs de configuration côté utilisateur, pas des
  // pannes : les rendre telles quelles évite un « erreur interne » trompeur.
  const status = statut === 401 || statut === 403 ? 400 : (statut >= 500 ? 502 : 400);

  return Object.assign(new Error(message), {
    status,
    expose: true,
    stripeCode: detail.code || '',
    stripeType: detail.type || '',
    stripeParam: detail.param || ''
  });
}

/**
 * Effectue un appel à l'API.
 *
 * @param {string} cle clé d'API, déjà déchiffrée
 * @param {'GET'|'POST'} methode
 * @param {string} chemin par exemple `/v1/payment_links`
 * @param {Object} [params] paramètres, encodés en corps (POST) ou en requête (GET)
 * @param {{idempotence?: string}} [options]
 * @returns {Promise<Object>} corps de la réponse
 */
function appel(cle, methode, chemin, params = {}, options = {}) {
  if (!cleValide(cle)) {
    throw Object.assign(
      new Error('La clé Stripe est absente ou mal formée. Ouvrez Paramètres → Paiement en ligne.'),
      { status: 400, expose: true }
    );
  }

  const encodes = encoderFormulaire(params).join('&');
  const url = new URL(
    chemin + (methode === 'GET' && encodes ? `?${encodes}` : ''),
    base()
  );
  const transport = url.protocol === 'http:' ? http : https;

  const entetes = {
    Authorization: `Bearer ${cle}`,
    'Stripe-Version': VERSION_API
  };
  if (methode !== 'GET') {
    entetes['Content-Type'] = 'application/x-www-form-urlencoded';
    entetes['Content-Length'] = Buffer.byteLength(encodes);
  }
  // Une clé d'idempotence garantit qu'un appel rejoué — coupure réseau, reprise
  // du planificateur — ne crée pas un second lien de paiement pour la même
  // facture.
  if (options.idempotence) entetes['Idempotency-Key'] = options.idempotence;

  return new Promise((resolve, reject) => {
    const requete = transport.request(url, { method: methode, headers: entetes }, (reponse) => {
      const morceaux = [];
      let taille = 0;

      reponse.on('data', (bloc) => {
        taille += bloc.length;
        if (taille > MAX_REPONSE) {
          requete.destroy();
          reject(Object.assign(new Error('Réponse de Stripe anormalement volumineuse.'), { status: 502 }));
          return;
        }
        morceaux.push(bloc);
      });

      reponse.on('end', () => {
        let corps = null;
        try {
          corps = JSON.parse(Buffer.concat(morceaux).toString('utf8'));
        } catch (e) {
          corps = null;
        }

        if (reponse.statusCode >= 200 && reponse.statusCode < 300) {
          return resolve(corps || {});
        }
        return reject(erreurStripe(reponse.statusCode, corps));
      });
    });

    requete.setTimeout(DELAI_MS, () => {
      requete.destroy();
      reject(Object.assign(
        new Error('Stripe n\'a pas répondu dans le délai imparti.'),
        { status: 504, expose: true }
      ));
    });

    requete.on('error', (erreur) => reject(Object.assign(
      new Error(`Impossible de joindre Stripe : ${erreur.message}`),
      { status: 502, expose: true }
    )));

    if (methode !== 'GET') requete.write(encodes);
    requete.end();
  });
}

/**
 * Éprouve une clé et décrit le compte auquel elle donne accès.
 *
 * La vérification passe par la lecture des sessions de paiement — l'opération
 * dont le relevé automatique dépend. Une clé qui répond ici est une clé qui
 * permettra effectivement d'inscrire les encaissements ; interroger seulement
 * `/v1/account` aurait validé une clé incapable de faire le travail.
 */
async function verifierCle(cle) {
  await appel(cle, 'GET', '/v1/checkout/sessions', { limit: 1 });

  // Le nom du compte n'est qu'un confort d'affichage : une clé restreinte peut
  // légitimement ne pas avoir le droit de le lire, sans que cela n'empêche rien.
  let compte = null;
  try {
    compte = await appel(cle, 'GET', '/v1/account');
  } catch (e) {
    compte = null;
  }

  return {
    mode: modeDeLaCle(cle),
    restreinte: estRestreinte(cle),
    nom: compte?.settings?.dashboard?.display_name || compte?.business_profile?.name || '',
    pays: compte?.country || '',
    devise: compte?.default_currency ? String(compte.default_currency).toUpperCase() : ''
  };
}

/**
 * Paramètres qu'on peut perdre sans perdre le lien lui-même.
 *
 * Ils améliorent le lien — message de confirmation nommant la facture, refus
 * d'un second règlement — mais ne conditionnent pas son existence. Si Stripe
 * venait à en refuser un, mieux vaut un lien dépouillé qu'une facture qu'on ne
 * peut pas envoyer.
 */
function paramsConfort(numero) {
  return {
    after_completion: {
      type: 'hosted_confirmation',
      hosted_confirmation: {
        custom_message: `Merci. Votre paiement de la facture ${numero} a bien été reçu.`
      }
    },
    // Un lien ne doit pouvoir régler la facture qu'une fois : un client qui
    // rouvre son courriel un mois plus tard ne doit pas payer deux fois.
    restrictions: { completed_sessions: { limit: 1 } }
  };
}

/**
 * Crée un lien de paiement pour une facture.
 *
 * Les moyens de paiement proposés ne sont **pas** imposés ici : Stripe applique
 * ceux que l'entreprise a activés dans son tableau de bord. C'est délibéré. Le
 * débit préautorisé exige de toute façon une activation côté Stripe ; l'imposer
 * par paramètre ferait échouer la création du lien tant que ce n'est pas fait,
 * et priverait la facture de tout moyen de paiement en ligne pour rien.
 *
 * @param {string} cle
 * @param {{numero: string, montant: number, devise: string, metadata?: Object, idempotence?: string}} facture
 * @returns {Promise<{id: string, url: string, degrade: boolean}>}
 */
async function creerLien(cle, { numero, montant, devise, metadata = {}, idempotence }) {
  const cents = Math.round(Number(montant) * 100);
  if (!Number.isFinite(cents) || cents <= 0) {
    throw Object.assign(new Error('Le montant à payer est invalide.'), { status: 400, expose: true });
  }

  const prix = await appel(cle, 'POST', '/v1/prices', {
    unit_amount: cents,
    currency: String(devise || 'CAD').toLowerCase(),
    product_data: { name: `Facture ${numero}` }
  }, { idempotence: idempotence ? `${idempotence}-prix` : undefined });

  // Stripe n'accepte que du texte en métadonnée : un identifiant numérique
  // passé tel quel serait refusé sur certaines versions de l'API.
  const etiquettes = Object.fromEntries(
    Object.entries(metadata).map(([cleMeta, valeur]) => [cleMeta, String(valeur)])
  );
  const lignes = { line_items: [{ price: prix.id, quantity: 1 }], metadata: etiquettes };

  try {
    const lien = await appel(cle, 'POST', '/v1/payment_links', {
      ...lignes, ...paramsConfort(numero)
    }, { idempotence });
    return { id: lien.id, url: lien.url, degrade: false };
  } catch (erreur) {
    // Un paramètre de confort refusé ne doit pas empêcher d'être payé. On
    // recommence avec le strict nécessaire — et on le signale à l'appelant
    // plutôt que de laisser croire que la protection contre un second règlement
    // est en place.
    if (!confortRefuse(erreur)) throw erreur;

    console.warn(`Stripe a refusé un paramètre du lien de paiement (${erreur.message}). `
      + 'Lien créé sans message de confirmation ni protection contre un second règlement.');

    const lien = await appel(cle, 'POST', '/v1/payment_links', lignes, {
      idempotence: idempotence ? `${idempotence}-simple` : undefined
    });
    return { id: lien.id, url: lien.url, degrade: true };
  }
}

/**
 * Reconnaît un refus portant sur un paramètre de confort, et lui seul.
 *
 * Un compte incapable d'encaisser, une clé sans les droits nécessaires : ces
 * échecs-là doivent remonter tels quels. Réessayer ne les corrigerait pas, et
 * masquerait la vraie cause derrière un second message identique.
 */
function confortRefuse(erreur) {
  const parametre = String(erreur.stripeParam || '');
  if (parametre.startsWith('after_completion') || parametre.startsWith('restrictions')) return true;
  return /unknown parameter/i.test(erreur.message || '');
}

/**
 * Sessions de paiement ouvertes depuis un lien donné.
 *
 * Le filtrage se fait par lien plutôt que par date : un débit préautorisé met
 * plusieurs jours ouvrables à se dénouer, et une fenêtre temporelle laisserait
 * échapper les règlements les plus lents — exactement ceux qu'un relevé
 * automatique doit rattraper.
 */
async function sessionsDuLien(cle, lienId) {
  const reponse = await appel(cle, 'GET', '/v1/checkout/sessions', {
    payment_link: lienId,
    limit: 10
  });
  return Array.isArray(reponse.data) ? reponse.data : [];
}

/** Retire un lien de la circulation, sans le supprimer de l'historique Stripe. */
async function desactiverLien(cle, lienId) {
  return appel(cle, 'POST', `/v1/payment_links/${encodeURIComponent(lienId)}`, { active: false });
}

module.exports = {
  appel,
  creerLien,
  sessionsDuLien,
  desactiverLien,
  verifierCle,
  cleValide,
  modeDeLaCle,
  estRestreinte,
  encoderFormulaire,
  VERSION_API,
  PREFIXES_VALIDES
};
