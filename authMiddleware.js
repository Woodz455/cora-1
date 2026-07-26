const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('./config.js');

/** Rôles reconnus, du plus large au plus restreint. */
const ROLES = ['admin', 'comptable', 'employe'];

const authMiddleware = (req, res, next) => {
  const token = req.cookies && req.cookies.token;
  if (!token) {
    return res.status(401).json({ error: 'Accès refusé. Aucun jeton fourni.' });
  }

  try {
    req.user = jwt.verify(token, getJwtSecret());
    next();
  } catch (err) {
    res.status(401).json({ error: 'Jeton invalide ou expiré.' });
  }
};

/**
 * Restreint une route à une liste de rôles.
 *
 * À utiliser sur *toute* route métier : sans cela, un compte `employe`
 * authentifié atteint indifféremment n'importe quel point d'entrée de l'API.
 */
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Accès refusé. Privilèges insuffisants.' });
    }
    next();
  };
};

/** Raccourcis de lisibilité pour les groupes de rôles les plus fréquents. */
const anyRole = () => requireRole(ROLES);
const adminOnly = () => requireRole(['admin']);
const adminOrAccountant = () => requireRole(['admin', 'comptable']);

module.exports = { authMiddleware, requireRole, anyRole, adminOnly, adminOrAccountant, ROLES };
