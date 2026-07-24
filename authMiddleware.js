const jwt = require('jsonwebtoken');
require('dotenv').config();

const getJwtSecret = () => process.env.JWT_SECRET || 'safequick_local_secret_key_2026';

const authMiddleware = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).json({ error: 'Accès refusé. Aucun jeton fourni.' });
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Jeton invalide ou expiré.' });
  }
};

const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Accès refusé. Privilèges insuffisants.' });
    }
    next();
  };
};

module.exports = { authMiddleware, requireRole };
