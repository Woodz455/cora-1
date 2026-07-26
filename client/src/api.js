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

/** Formate un montant pour l'affichage. */
export function formatMontant(valeur, devise = 'CAD') {
  const nombre = Number(valeur) || 0;
  const symbole = devise === 'USD' ? 'US$' : '$';
  return `${nombre.toFixed(2)} ${symbole}`;
}
