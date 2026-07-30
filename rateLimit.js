/**
 * Limitation des tentatives d'authentification, en mémoire.
 *
 * Sans elle, un mot de passe de quatre caractères tombe en quelques secondes.
 * Le compteur est volontairement local au processus : l'application est
 * mono-poste, une dépendance externe ne se justifie pas ici.
 */

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 8;

const attempts = new Map(); // clé -> { count, firstAt, blockedUntil }

function keyFor(req) {
  const username = req.body && typeof req.body.username === 'string' ? req.body.username.toLowerCase() : '';
  return `${req.ip}|${username}`;
}

/** Purge les entrées expirées pour éviter que la carte croisse indéfiniment. */
function prune(now) {
  for (const [key, entry] of attempts) {
    const expired = now - entry.firstAt > WINDOW_MS && (!entry.blockedUntil || entry.blockedUntil < now);
    if (expired) attempts.delete(key);
  }
}

/** Middleware à placer devant les routes de connexion. */
function loginRateLimit(req, res, next) {
  const now = Date.now();
  prune(now);

  const key = keyFor(req);
  const entry = attempts.get(key);

  if (entry && entry.blockedUntil && entry.blockedUntil > now) {
    const minutes = Math.ceil((entry.blockedUntil - now) / 60000);
    return res.status(429).json({
      error: `Trop de tentatives de connexion. Réessayez dans ${minutes} minute(s).`
    });
  }

  req.rateLimitKey = key;
  next();
}

/** À appeler après un échec d'authentification. */
function recordFailure(key) {
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || now - entry.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now, blockedUntil: null });
    return;
  }

  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.blockedUntil = now + WINDOW_MS;
  }
}

/** À appeler après une authentification réussie. */
function recordSuccess(key) {
  attempts.delete(key);
}

/** Réinitialise l'état complet (utilisé par les tests). */
function reset() {
  attempts.clear();
}

module.exports = { loginRateLimit, recordFailure, recordSuccess, reset, MAX_ATTEMPTS };
