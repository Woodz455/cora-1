/**
 * Routes de gestion des comptes utilisateurs. Réservées à l'administration.
 */

const express = require('express');
const bcrypt = require('bcryptjs');

const { adminOnly, ROLES } = require('../authMiddleware.js');
const { asyncRoute, httpError } = require('../httpUtils.js');
const { parseId, sanitizeText } = require('../validators.js');
const { MIN_PASSWORD_LENGTH } = require('./auth.js');

function validateRole(role) {
  if (!ROLES.includes(role)) throw httpError(400, `Rôle inconnu : ${role}.`);
  return role;
}

module.exports = function userRoutes(getDb) {
  const router = express.Router();
  router.use(adminOnly());

  router.get('/', asyncRoute(async (req, res) => {
    res.json(await getDb().all('SELECT id, username, role FROM users ORDER BY username ASC'));
  }));

  router.post('/', asyncRoute(async (req, res) => {
    const db = getDb();
    const username = sanitizeText(req.body.username, 60);
    const { password } = req.body;

    if (username.length < 3) {
      throw httpError(400, "Le nom d'utilisateur doit comporter au moins 3 caractères.");
    }
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      throw httpError(400, `Le mot de passe doit comporter au moins ${MIN_PASSWORD_LENGTH} caractères.`);
    }
    const role = validateRole(req.body.role || 'employe');

    const existant = await db.get('SELECT id FROM users WHERE username = ?', [username]);
    if (existant) throw httpError(409, "Ce nom d'utilisateur est déjà pris.");

    const hash = await bcrypt.hash(password, 12);
    const result = await db.run(
      'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
      [username, hash, role]
    );
    res.status(201).json({ id: result.lastID, username, role });
  }));

  router.put('/:id', asyncRoute(async (req, res) => {
    const db = getDb();
    const id = parseId(req.params.id);
    if (!id) throw httpError(400, 'Identifiant invalide.');

    const cible = await db.get('SELECT id, username, role FROM users WHERE id = ?', [id]);
    if (!cible) throw httpError(404, 'Utilisateur non trouvé.');

    const username = sanitizeText(req.body.username, 60) || cible.username;
    if (username.length < 3) {
      throw httpError(400, "Le nom d'utilisateur doit comporter au moins 3 caractères.");
    }
    const role = req.body.role ? validateRole(req.body.role) : cible.role;

    // Empêche de retirer le dernier administrateur en le rétrogradant : sans ce
    // contrôle, plus personne ne peut accéder aux paramètres ni aux comptes.
    if (cible.role === 'admin' && role !== 'admin') {
      const { count } = await db.get("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'");
      if (count <= 1) throw httpError(400, 'Le dernier administrateur ne peut pas changer de rôle.');
    }

    const collision = await db.get('SELECT id FROM users WHERE username = ? AND id != ?', [username, id]);
    if (collision) throw httpError(409, "Ce nom d'utilisateur est déjà pris.");

    if (req.body.password) {
      if (req.body.password.length < MIN_PASSWORD_LENGTH) {
        throw httpError(400, `Le mot de passe doit comporter au moins ${MIN_PASSWORD_LENGTH} caractères.`);
      }
      const hash = await bcrypt.hash(req.body.password, 12);
      await db.run('UPDATE users SET username = ?, role = ?, password = ? WHERE id = ?', [username, role, hash, id]);
    } else {
      await db.run('UPDATE users SET username = ?, role = ? WHERE id = ?', [username, role, id]);
    }

    res.json({ id, username, role });
  }));

  router.delete('/:id', asyncRoute(async (req, res) => {
    const db = getDb();
    const id = parseId(req.params.id);
    if (!id) throw httpError(400, 'Identifiant invalide.');

    const cible = await db.get('SELECT id, role FROM users WHERE id = ?', [id]);
    if (!cible) throw httpError(404, 'Utilisateur non trouvé.');

    if (cible.id === req.user.sub) {
      throw httpError(400, 'Vous ne pouvez pas supprimer votre propre compte.');
    }
    if (cible.role === 'admin') {
      const { count } = await db.get("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'");
      if (count <= 1) throw httpError(400, 'Impossible de supprimer le dernier administrateur.');
    }

    await db.run('DELETE FROM users WHERE id = ?', [id]);
    res.json({ success: true });
  }));

  return router;
};
