/**
 * Routes de gestion des comptes utilisateurs. Réservées à l'administration.
 *
 * Les comptes sont communs à tous les dossiers — un comptable se connecte une
 * fois —, mais **le rôle est propre à chaque dossier** : on peut être
 * administrateur chez un client et simple employé chez un autre. L'identité vit
 * donc dans le registre, et le rôle dans la table des accès.
 *
 * Le journal d'audit, lui, reste dans le dossier concerné : « qui a créé ce
 * compte » est une question qu'on se pose dossier par dossier.
 */

const express = require('express');
const bcrypt = require('bcryptjs');

const { adminOnly, ROLES } = require('../authMiddleware.js');
const { journaliser, ACTIONS } = require('../auditService.js');
const { asyncRoute, httpError } = require('../httpUtils.js');
const { parseId, sanitizeText } = require('../validators.js');
const { MIN_PASSWORD_LENGTH } = require('./auth.js');

function validateRole(role) {
  if (!ROLES.includes(role)) throw httpError(400, `Rôle inconnu : ${role}.`);
  return role;
}

module.exports = function userRoutes(getDb, getComptesDb) {
  const router = express.Router();
  router.use(adminOnly());

  /** Identifiant du dossier ouvert, posé par l'intergiciel de session. */
  const dossierId = (req) => req.entreprise.id;

  /** Compte accessible depuis le dossier courant, avec son rôle ici. */
  const membre = (comptes, id, entrepriseId) => comptes.get(
    `SELECT u.id, u.username, a.role
     FROM users u JOIN acces a ON a.user_id = u.id
     WHERE u.id = ? AND a.entreprise_id = ?`,
    [id, entrepriseId]
  );

  /** Nombre d'administrateurs du dossier courant. */
  const compterAdmins = async (comptes, entrepriseId) => {
    const { count } = await comptes.get(
      "SELECT COUNT(*) AS count FROM acces WHERE entreprise_id = ? AND role = 'admin'",
      [entrepriseId]
    );
    return count;
  };

  router.get('/', asyncRoute(async (req, res) => {
    res.json(await getComptesDb().all(
      `SELECT u.id, u.username, a.role
       FROM users u JOIN acces a ON a.user_id = u.id
       WHERE a.entreprise_id = ?
       ORDER BY u.username ASC`,
      [dossierId(req)]
    ));
  }));

  router.post('/', asyncRoute(async (req, res) => {
    const comptes = getComptesDb();
    const username = sanitizeText(req.body.username, 60);
    const { password } = req.body;

    if (username.length < 3) {
      throw httpError(400, "Le nom d'utilisateur doit comporter au moins 3 caractères.");
    }
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      throw httpError(400, `Le mot de passe doit comporter au moins ${MIN_PASSWORD_LENGTH} caractères.`);
    }
    const role = validateRole(req.body.role || 'employe');

    // Les identifiants étant communs à tous les dossiers, la collision se
    // vérifie globalement. Rattacher un compte existant à un dossier
    // supplémentaire est un geste différent, qui viendra avec son propre écran.
    const existant = await comptes.get('SELECT id FROM users WHERE username = ?', [username]);
    if (existant) throw httpError(409, "Ce nom d'utilisateur est déjà pris.");

    const hash = await bcrypt.hash(password, 12);
    const result = await comptes.run(
      'INSERT INTO users (username, password) VALUES (?, ?)',
      [username, hash]
    );
    await comptes.run(
      'INSERT INTO acces (user_id, entreprise_id, role) VALUES (?, ?, ?)',
      [result.lastID, dossierId(req), role]
    );

    await journaliser(getDb(), req, {
      action: ACTIONS.UTILISATEUR_CREATION,
      entite: 'utilisateur',
      entite_id: result.lastID,
      details: { username, role }
    });

    res.status(201).json({ id: result.lastID, username, role });
  }));

  router.put('/:id', asyncRoute(async (req, res) => {
    const comptes = getComptesDb();
    const entrepriseId = dossierId(req);
    const id = parseId(req.params.id);
    if (!id) throw httpError(400, 'Identifiant invalide.');

    const cible = await membre(comptes, id, entrepriseId);
    if (!cible) throw httpError(404, 'Utilisateur non trouvé.');

    const username = sanitizeText(req.body.username, 60) || cible.username;
    if (username.length < 3) {
      throw httpError(400, "Le nom d'utilisateur doit comporter au moins 3 caractères.");
    }
    const role = req.body.role ? validateRole(req.body.role) : cible.role;

    // Empêche de retirer le dernier administrateur en le rétrogradant : sans ce
    // contrôle, plus personne n'accède aux paramètres ni aux comptes de ce
    // dossier. Le décompte est propre au dossier — être administrateur ailleurs
    // n'y donne aucun pouvoir.
    if (cible.role === 'admin' && role !== 'admin' && await compterAdmins(comptes, entrepriseId) <= 1) {
      throw httpError(400, 'Le dernier administrateur ne peut pas changer de rôle.');
    }

    const collision = await comptes.get('SELECT id FROM users WHERE username = ? AND id != ?', [username, id]);
    if (collision) throw httpError(409, "Ce nom d'utilisateur est déjà pris.");

    if (req.body.password) {
      if (req.body.password.length < MIN_PASSWORD_LENGTH) {
        throw httpError(400, `Le mot de passe doit comporter au moins ${MIN_PASSWORD_LENGTH} caractères.`);
      }
      const hash = await bcrypt.hash(req.body.password, 12);
      await comptes.run('UPDATE users SET username = ?, password = ? WHERE id = ?', [username, hash, id]);
    } else {
      await comptes.run('UPDATE users SET username = ? WHERE id = ?', [username, id]);
    }
    await comptes.run(
      'UPDATE acces SET role = ? WHERE user_id = ? AND entreprise_id = ?',
      [role, id, entrepriseId]
    );

    await journaliser(getDb(), req, {
      action: ACTIONS.UTILISATEUR_MODIFICATION,
      entite: 'utilisateur',
      entite_id: id,
      details: {
        username: cible.username === username ? username : { avant: cible.username, apres: username },
        role: cible.role === role ? role : { avant: cible.role, apres: role },
        mot_de_passe_change: Boolean(req.body.password)
      }
    });

    res.json({ id, username, role });
  }));

  /**
   * Retire un utilisateur du dossier courant.
   *
   * Le compte n'est supprimé que s'il ne donne plus accès à rien : le retirer
   * d'un dossier ne doit pas le priver des autres, où il travaille peut-être
   * tous les jours.
   */
  router.delete('/:id', asyncRoute(async (req, res) => {
    const comptes = getComptesDb();
    const entrepriseId = dossierId(req);
    const id = parseId(req.params.id);
    if (!id) throw httpError(400, 'Identifiant invalide.');

    // Le nom est relevé avant le retrait : ensuite l'accès n'existe plus, et une
    // trace qui ne nomme pas le compte concerné n'apprend rien.
    const cible = await membre(comptes, id, entrepriseId);
    if (!cible) throw httpError(404, 'Utilisateur non trouvé.');

    if (cible.id === req.user.sub) {
      throw httpError(400, 'Vous ne pouvez pas supprimer votre propre compte.');
    }
    if (cible.role === 'admin' && await compterAdmins(comptes, entrepriseId) <= 1) {
      throw httpError(400, 'Impossible de supprimer le dernier administrateur.');
    }

    await comptes.run('DELETE FROM acces WHERE user_id = ? AND entreprise_id = ?', [id, entrepriseId]);

    const restants = await comptes.get('SELECT COUNT(*) AS count FROM acces WHERE user_id = ?', [id]);
    if (restants.count === 0) {
      await comptes.run('DELETE FROM users WHERE id = ?', [id]);
    }

    await journaliser(getDb(), req, {
      action: ACTIONS.UTILISATEUR_SUPPRESSION,
      entite: 'utilisateur',
      entite_id: id,
      details: { username: cible.username, role: cible.role }
    });

    res.json({ success: true });
  }));

  return router;
};
