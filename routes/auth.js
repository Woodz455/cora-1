/**
 * Routes d'authentification et de gestion de session.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { authMiddleware } = require('../authMiddleware.js');
const { getJwtSecret, isProduction, SESSION_HOURS } = require('../config.js');
const { loginRateLimit, recordFailure, recordSuccess } = require('../rateLimit.js');
const { asyncRoute, httpError } = require('../httpUtils.js');
const { sanitizeText } = require('../validators.js');

/**
 * Longueur minimale d'un mot de passe.
 * Le minimum précédent de 4 caractères ne résistait à aucune tentative
 * automatisée, même avec une limitation du nombre d'essais.
 */
const MIN_PASSWORD_LENGTH = 8;

const SESSION_MS = () => SESSION_HOURS * 60 * 60 * 1000;

/** Options du cookie de session. */
function cookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    maxAge: SESSION_MS()
  };
}

/** Émet un jeton de session et le dépose en cookie. */
function issueSession(res, user) {
  const token = jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    getJwtSecret(),
    { expiresIn: `${SESSION_HOURS}h` }
  );
  res.cookie('token', token, cookieOptions());
}

/** Valide un couple identifiant / mot de passe à la création. */
function validateCredentials(username, password) {
  const nom = sanitizeText(username, 60);
  if (nom.length < 3) {
    throw httpError(400, "Le nom d'utilisateur doit comporter au moins 3 caractères.");
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw httpError(400, `Le mot de passe doit comporter au moins ${MIN_PASSWORD_LENGTH} caractères.`);
  }
  return nom;
}

module.exports = function authRoutes(getDb) {
  const router = express.Router();

  /** Indique si la configuration initiale (création de l'admin) reste à faire. */
  router.get('/setup-status', asyncRoute(async (req, res) => {
    const admin = await getDb().get("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    res.json({ setupRequired: !admin, minPasswordLength: MIN_PASSWORD_LENGTH });
  }));

  /** Crée le tout premier compte administrateur. */
  router.post('/setup', asyncRoute(async (req, res) => {
    const db = getDb();
    const admin = await db.get("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    if (admin) {
      throw httpError(400, 'Un compte administrateur a déjà été configuré.');
    }

    const username = validateCredentials(req.body.username, req.body.password);
    const hash = await bcrypt.hash(req.body.password, 12);
    const result = await db.run(
      'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
      [username, hash, 'admin']
    );

    issueSession(res, { id: result.lastID, username, role: 'admin' });
    res.json({ success: true, message: 'Compte configuré avec succès.' });
  }));

  router.post('/login', loginRateLimit, asyncRoute(async (req, res) => {
    const { username, password } = req.body;
    const user = await getDb().get('SELECT * FROM users WHERE username = ?', [username]);

    // Le même message et le même code sont renvoyés pour un identifiant
    // inconnu et pour un mot de passe erroné, afin de ne pas révéler
    // quels comptes existent.
    const valide = user && typeof password === 'string' && await bcrypt.compare(password, user.password);
    if (!valide) {
      recordFailure(req.rateLimitKey);
      return res.status(401).json({ success: false, error: 'Identifiants invalides.' });
    }

    recordSuccess(req.rateLimitKey);
    issueSession(res, user);
    res.json({ success: true, message: 'Connexion réussie.' });
  }));

  /** Modification de ses propres identifiants. */
  router.put('/credentials', authMiddleware, asyncRoute(async (req, res) => {
    const db = getDb();
    const { currentPassword, newUsername, newPassword } = req.body;

    const user = await db.get('SELECT id, username, password FROM users WHERE username = ?', [req.user.username]);
    if (!user) throw httpError(404, 'Utilisateur non trouvé.');

    const isMatch = typeof currentPassword === 'string' && await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) throw httpError(401, 'Mot de passe actuel incorrect.');

    const username = validateCredentials(newUsername, newPassword);
    const hash = await bcrypt.hash(newPassword, 12);

    if (username !== user.username) {
      const collision = await db.get('SELECT id FROM users WHERE username = ? AND id != ?', [username, user.id]);
      if (collision) throw httpError(409, "Ce nom d'utilisateur est déjà pris.");
    }

    await db.run('UPDATE users SET username = ?, password = ? WHERE id = ?', [username, hash, user.id]);

    // La session est invalidée : l'utilisateur doit se reconnecter avec ses nouveaux identifiants.
    res.clearCookie('token');
    res.json({ success: true, message: 'Identifiants mis à jour avec succès.' });
  }));

  router.get('/check', authMiddleware, (req, res) => {
    res.json({ authenticated: true, role: req.user.role, username: req.user.username });
  });

  router.post('/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true, message: 'Déconnecté.' });
  });

  return router;
};

module.exports.MIN_PASSWORD_LENGTH = MIN_PASSWORD_LENGTH;
