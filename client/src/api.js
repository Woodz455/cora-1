/**
 * Client HTTP de l'application.
 *
 * Les composants appelaient `fetch` directement, souvent sans vérifier
 * `response.ok` : un enregistrement refusé par le serveur (montant invalide,
 * privilèges insuffisants) se soldait par un écran inchangé, sans le moindre
 * message. Ce module remonte systématiquement le message d'erreur du serveur.
 */

/** Erreur d'API portant le code de statut HTTP. */
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request(method, url, body) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw new ApiError('Impossible de joindre le serveur.', 0);
  }

  const contenu = response.headers.get('content-type') || '';
  const data = contenu.includes('application/json') ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const message = (data && data.error) || `Erreur ${response.status}`;
    throw new ApiError(message, response.status);
  }

  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body),
  put: (url, body) => request('PUT', url, body),
  del: (url) => request('DELETE', url)
};

/**
 * Écrit un montant dans les conventions du lecteur.
 *
 * Français canadien : « 1 149,75 $ », virgule décimale et espace insécable comme
 * séparateur de milliers. Anglais canadien : « $1,149.75 ». L'interface est en
 * français ; la langue n'est précisée que pour les documents destinés au client,
 * qui suivent la sienne.
 *
 * Cette fonction est dupliquée à l'identique dans `money.js` : le code de
 * l'interface (module ES) et celui du serveur (CommonJS) ne partagent pas de
 * module. Toute modification doit être reportée des deux côtés.
 */
export function formatMontant(valeur, devise = 'CAD', langue = 'fr') {
  const nombre = Number(valeur) || 0;
  const locale = langue === 'en' ? 'en-CA' : 'fr-CA';

  // Intl lève une RangeError sur un code de devise inconnu. Les données saisies
  // aujourd'hui sont validées, mais une ligne ancienne pourrait en porter un :
  // mieux vaut une facture en dollars canadiens qu'une facture blanche.
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: devise || 'CAD' }).format(nombre);
  } catch {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD' }).format(nombre);
  }
}
