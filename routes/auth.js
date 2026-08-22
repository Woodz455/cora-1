/**
 * Routes d'authentification et de gestion de session.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { authMiddleware } = require('../authMiddleware.js');
const { journaliser, ACTIONS } = require('../auditService.js');
const { getJwtSecret, isProduction, SESSION_HOURS } = require('../config.js');
const { loginRateLimit, recordFailure, recordSuccess } = require('../rateLimit.js');
const { asyncRoute, httpError } = require('../httpUtils.js');
const { sanitizeText } = require('../validators.js');
const { listerPourUtilisateur, creerEntreprise } = require('../companyStore.js');

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

/**
 * Émet un jeton de session et le dépose en cookie.
 *
 * En mode multi-dossier, le jeton désigne le dossier ouvert mais **ne porte pas
 * le rôle** : celui-ci dépend du dossier et se relit à chaque requête, pour
 * qu'un accès retiré prenne effet aussitôt plutôt qu'à l'expiration de la
 * session douze heures plus tard.
 */
function issueSession(res, user) {
  const charge = { sub: user.id, username: user.username };
  if (user.role) charge.role = user.role;
  if (user.entreprise) charge.entreprise = user.entreprise;

  const token = jwt.sign(charge, getJwtSecret(), { expiresIn: `${SESSION_HOURS}h` });
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

  /**
   * Le tout premier compte.
   *
   * Les rôles ayant quitté la table des comptes pour celle des accès — un rôle
   * dépend désormais du dossier —, c'est l'existence d'un compte, quel qu'il
   * soit, qui dit si la configuration initiale est faite.
   */
  const premierCompte = (db) => db.get('SELECT id FROM users LIMIT 1');

  /** Indique si la configuration initiale (création de l'admin) reste à faire. */
  router.get('/setup-status', asyncRoute(async (req, res) => {
    const admin = await premierCompte(getDb());
    res.json({ setupRequired: !admin, minPasswordLength: MIN_PASSWORD_LENGTH });
  }));

  /** Crée le tout premier compte administrateur, et son premier dossier. */
  router.post('/setup', asyncRoute(async (req, res) => {
    const db = getDb();
    if (await premierCompte(db)) {
      throw httpError(400, 'Un compte administrateur a déjà été configuré.');
    }

    const username = validateCredentials(req.body.username, req.body.password);
    const hash = await bcrypt.hash(req.body.password, 12);

    const result = await db.run(
      'INSERT INTO users (username, password) VALUES (?, ?)',
      [username, hash]
    );

    // Un dossier peut déjà exister sans qu'aucun compte n'y donne accès : c'est
    // le cas d'une base héritée d'une version mono-entreprise dont la table des
    // comptes était vide. En créer un second placerait l'utilisateur devant un
    // dossier vierge, sa comptabilité restant invisible à côté.
    const existants = await db.all('SELECT id, nom FROM entreprises WHERE archive = 0 ORDER BY id');

    let ouvert;
    if (existants.length === 0) {
      const nom = sanitizeText(req.body.entreprise, 200) || 'Mon entreprise';
      ouvert = await creerEntreprise(db, { nom, userId: result.lastID });
    } else {
      for (const dossier of existants) {
        await db.run(
          "INSERT INTO acces (user_id, entreprise_id, role) VALUES (?, ?, 'admin')",
          [result.lastID, dossier.id]
        );
      }
      ouvert = existants[0];
    }

    issueSession(res, { id: result.lastID, username, entreprise: ouvert.id });
    return res.json({
      success: true,
      message: 'Compte configuré avec succès.',
      entreprise: { id: ouvert.id, nom: ouvert.nom }
    });
  }));

  router.post('/login', loginRateLimit, asyncRoute(async (req, res) => {
    const db = getDb();
    const { username, password } = req.body;
    const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);

    // Le même message et le même code sont renvoyés pour un identifiant
    // inconnu et pour un mot de passe erroné, afin de ne pas révéler
    // quels comptes existent.
    const valide = user && typeof password === 'string' && await bcrypt.compare(password, user.password);
    if (!valide) {
      recordFailure(req.rateLimitKey);
      return res.status(401).json({ success: false, error: 'Identifiants invalides.' });
    }

    recordSuccess(req.rateLimitKey);

    const dossiers = await listerPourUtilisateur(db, user.id);

    // Un seul dossier accessible : il s'ouvre de lui-même. Imposer un choix
    // entre une seule possibilité serait une friction quotidienne pour tous
    // ceux qui n'ont qu'une entreprise, c'est-à-dire la plupart.
    const unique = dossiers.length === 1 ? dossiers[0] : null;
    issueSession(res, { id: user.id, username: user.username, entreprise: unique ? unique.id : null });

    return res.json({
      success: true,
      message: 'Connexion réussie.',
      entreprises: dossiers.map(({ id, nom, role }) => ({ id, nom, role })),
      ouvert: unique ? { id: unique.id, nom: unique.nom, role: unique.role } : null
    });
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

    // Ni l'ancien ni le nouveau mot de passe n'entrent au journal : seul le
    // fait qu'ils aient changé est consigné.
    await journaliser(db, req, {
      action: ACTIONS.IDENTIFIANTS_MODIFICATION,
      entite: 'utilisateur',
      entite_id: user.id,
      details: {
        username: username === user.username ? username : { avant: user.username, apres: username },
        mot_de_passe_change: true
      }
    });

    // La session est invalidée : l'utilisateur doit se reconnecter avec ses nouveaux identifiants.
    res.clearCookie('token');
    res.json({ success: true, message: 'Identifiants mis à jour avec succès.' });
  }));

  /**
   * État de la session.
   *
   * Ce routeur est monté avant l'intergiciel qui ouvre le dossier : le rôle
   * doit donc être résolu ici, il n'est pas déjà sur `req.user`.
   */
  router.get('/check', authMiddleware, asyncRoute(async (req, res) => {
    const db = getDb();
    const dossiers = await listerPourUtilisateur(db, req.user.sub);
    const ouvert = dossiers.find((d) => d.id === req.user.entreprise) || null;

    return res.json({
      authenticated: true,
      username: req.user.username,
      role: ouvert ? ouvert.role : null,
      entreprises: dossiers.map(({ id, nom, role }) => ({ id, nom, role })),
      ouvert: ouvert ? { id: ouvert.id, nom: ouvert.nom, role: ouvert.role } : null
    });
  }));

  router.post('/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true, message: 'Déconnecté.' });
  });

  return router;
};

module.exports.MIN_PASSWORD_LENGTH = MIN_PASSWORD_LENGTH;
// Le routeur des dossiers réémet la session à chaque bascule : il lui faut la
// même fabrique de jeton, pour qu'il n'existe qu'une façon d'ouvrir une session.
module.exports.emettreSession = issueSession;
