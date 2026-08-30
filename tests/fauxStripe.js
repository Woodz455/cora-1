/**
 * Faux serveur Stripe, pour éprouver le paiement en ligne de bout en bout.
 *
 * Les tests passent par un vrai serveur HTTP plutôt que par une fonction
 * remplacée en mémoire : c'est le seul moyen de vérifier ce qui part réellement
 * sur le réseau — l'encodage des paramètres, l'en-tête d'autorisation, la
 * version d'API figée — et non seulement ce que le code croit envoyer.
 *
 * Il n'imite pas Stripe : il en imite le contrat, celui dont Clora dépend.
 */

const http = require('http');

/** Décompose un corps encodé en formulaire, sans reconstituer l'imbrication. */
function analyserFormulaire(texte) {
  const champs = {};
  for (const paire of String(texte || '').split('&')) {
    if (!paire) continue;
    const [cle, valeur = ''] = paire.split('=');
    champs[decodeURIComponent(cle)] = decodeURIComponent(valeur.replace(/\+/g, ' '));
  }
  return champs;
}

/**
 * Démarre le faux serveur.
 *
 * @returns {Promise<Object>} `url`, `appels`, et de quoi simuler un règlement
 */
async function demarrerFauxStripe(options = {}) {
  const appels = [];
  const liens = new Map();
  const sessions = [];
  const idempotence = new Map();
  let compteur = 0;

  // Reproduit le refus d'un paramètre que cette version de l'API ne connaîtrait
  // pas : Clora doit alors produire un lien dépouillé plutôt que rien du tout.
  const refuserConfort = Boolean(options.refuserConfort);

  const serveur = http.createServer((req, res) => {
    const morceaux = [];
    req.on('data', (bloc) => morceaux.push(bloc));
    req.on('end', () => {
      const corps = Buffer.concat(morceaux).toString('utf8');
      const url = new URL(req.url, 'http://interne');
      const champs = req.method === 'GET'
        ? Object.fromEntries(url.searchParams.entries())
        : analyserFormulaire(corps);

      appels.push({
        methode: req.method,
        chemin: url.pathname,
        champs,
        corps,
        entetes: req.headers
      });

      const repondre = (statut, donnees) => {
        res.writeHead(statut, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(donnees));
      };

      // Toute requête doit porter une clé : une requête anonyme prouverait que
      // Clora envoie des appels sans authentification.
      const autorisation = req.headers.authorization || '';
      if (!autorisation.startsWith('Bearer ')) {
        return repondre(401, { error: { type: 'invalid_request_error', message: 'No API key provided.' } });
      }
      if (autorisation.includes('mauvaise')) {
        return repondre(401, {
          error: { type: 'invalid_request_error', message: 'Invalid API Key provided.' }
        });
      }

      const cleIdempotence = req.headers['idempotency-key'];
      if (cleIdempotence && idempotence.has(cleIdempotence)) {
        return repondre(200, idempotence.get(cleIdempotence));
      }

      const memoriser = (donnees) => {
        if (cleIdempotence) idempotence.set(cleIdempotence, donnees);
        return donnees;
      };

      if (req.method === 'POST' && url.pathname === '/v1/prices') {
        compteur += 1;
        return repondre(200, memoriser({
          id: `price_${compteur}`,
          object: 'price',
          unit_amount: Number(champs.unit_amount),
          currency: champs.currency
        }));
      }

      if (req.method === 'POST' && url.pathname === '/v1/payment_links') {
        if (refuserConfort && Object.keys(champs).some((c) => c.startsWith('restrictions'))) {
          return repondre(400, {
            error: {
              type: 'invalid_request_error',
              param: 'restrictions',
              message: 'Received unknown parameter: restrictions'
            }
          });
        }
        compteur += 1;
        const lien = {
          id: `plink_${compteur}`,
          object: 'payment_link',
          url: `https://buy.stripe.example/${compteur}`,
          active: true,
          prix: champs['line_items[0][price]']
        };
        liens.set(lien.id, lien);
        return repondre(200, memoriser(lien));
      }

      const modification = url.pathname.match(/^\/v1\/payment_links\/([^/]+)$/);
      if (req.method === 'POST' && modification) {
        const lien = liens.get(modification[1]);
        if (!lien) {
          return repondre(404, { error: { type: 'invalid_request_error', message: 'No such payment link' } });
        }
        if (champs.active !== undefined) lien.active = champs.active === 'true';
        return repondre(200, lien);
      }

      if (req.method === 'GET' && url.pathname === '/v1/checkout/sessions') {
        const filtre = champs.payment_link;
        const donnees = sessions.filter((s) => !filtre || s.payment_link === filtre);
        return repondre(200, { object: 'list', data: donnees, has_more: false });
      }

      if (req.method === 'GET' && url.pathname === '/v1/account') {
        return repondre(200, {
          id: 'acct_test',
          country: 'CA',
          default_currency: 'cad',
          settings: { dashboard: { display_name: 'Plomberie Tremblay' } }
        });
      }

      return repondre(404, {
        error: { type: 'invalid_request_error', message: `Unrecognized request URL: ${url.pathname}` }
      });
    });
  });

  await new Promise((resolve) => serveur.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${serveur.address().port}`;

  return {
    base,
    appels,
    liens,
    sessions,

    /** Ajoute une session de paiement sur un lien, réglée ou non. */
    payer(lienId, { montant, devise = 'cad', etat = 'paid', id } = {}) {
      const session = {
        id: id || `cs_test_${sessions.length + 1}`,
        object: 'checkout.session',
        payment_link: lienId,
        payment_status: etat,
        amount_total: Math.round(montant * 100),
        currency: devise,
        created: Math.floor(Date.now() / 1000)
      };
      sessions.push(session);
      return session;
    },

    /** Nombre d'appels reçus sur un chemin, pour compter ce qui part vraiment. */
    compter(chemin, methode = 'POST') {
      return appels.filter((a) => a.chemin === chemin && a.methode === methode).length;
    },

    async close() {
      await new Promise((resolve) => serveur.close(resolve));
    }
  };
}

module.exports = { demarrerFauxStripe, analyserFormulaire };
