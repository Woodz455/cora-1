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
const {
  listerPourUtilisateur, creerEntreprise, nommerSiVierge, ouvrirEntreprise
} = require('../companyStore.js');
const { parseProfil } = require('../profils.js');
const { genererCodeRecuperation, normaliserCodeRecuperation, formater } = require('../codesSecours.js');

/**
 * Longueur minimale d'un mot de passe.
 * Le minimum précédent de 4 caractères ne résistait à aucune tentative
 * automatisée, même avec une limitation du nombre d'essais.
 */
const MIN_PASSWORD_LENGTH = 8;

/** Langues de l'interface. Toute autre valeur est ramenée au français. */
const LANGUES = ['fr', 'en'];
const parseLangue = (valeur) => (LANGUES.includes(valeur) ? valeur : 'fr');

const SESSION_MS = () => SESSION_HOURS * 60 * 60 * 1000;

/**
 * Tire un nouveau code de récupération pour un compte et en garde l'empreinte.
 *
 * Le code n'est rendu qu'une fois, à l'appelant qui l'affiche : Clora ne peut
 * pas le montrer de nouveau, seulement en tirer un autre, qui remplace le
 * précédent.
 *
 * @returns {Promise<string>} le code, par groupes de quatre
 */
async function nouveauCodeDeRecuperation(comptesDb, userId) {
  const brut = genererCodeRecuperation();
  await comptesDb.run(
    "UPDATE users SET recuperation_empreinte = ?, recuperation_le = datetime('now') WHERE id = ?",
    [await bcrypt.hash(brut, 12), userId]
  );
  return formater(brut);
}

/**
 * Empreinte témoin : comparer le code à quelque chose, même quand le compte
 * n'existe pas ou n'a pas de code, pour que la durée de la réponse ne le
 * révèle pas.
 */
let empreinteTemoin = null;
async function temoin() {
  if (!empreinteTemoin) empreinteTemoin = await bcrypt.hash('code-de-recuperation-inexistant', 12);
  return empreinteTemoin;
}

/**
 * Consigne un événement de compte au journal de chaque dossier du compte.
 *
 * Le compte vit dans le registre, qui n'a pas de journal : l'écriture y
 * échouait en silence, et un changement d'identifiants ne laissait aucune
 * trace. Il touche l'accès à chacun des dossiers du compte ; chacun le
 * consigne donc, avec le rôle que le compte y tient.
 */
async function journaliserPourLeCompte(comptesDb, req, userId, evenement) {
  const dossiers = await listerPourUtilisateur(comptesDb, userId);
  for (const dossier of dossiers) {
    try {
      const base = await ouvrirEntreprise(dossier.chemin);
      await journaliser(base, { user: { username: req.user.username, role: dossier.role } }, evenement);
    } catch (error) {
      console.error(`Journal du dossier « ${dossier.nom} » inaccessible :`, error.message);
    }
  }
}

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
    // Validé avant d'écrire quoi que ce soit : un profil inconnu ne doit pas
    // laisser derrière lui un compte créé sans dossier.
    const profil = parseProfil(req.body.profil);
    const hash = await bcrypt.hash(req.body.password, 12);

    // La langue choisie sur l'écran de premier lancement devient celle du
    // compte : l'administrateur n'a pas à la choisir une seconde fois.
    const result = await db.run(
      'INSERT INTO users (username, password, langue) VALUES (?, ?, ?)',
      [username, hash, parseLangue(req.body.langue)]
    );

    // Un dossier peut déjà exister sans qu'aucun compte n'y donne accès : c'est
    // le cas d'une base héritée d'une version mono-entreprise dont la table des
    // comptes était vide. En créer un second placerait l'utilisateur devant un
    // dossier vierge, sa comptabilité restant invisible à côté.
    const existants = await db.all('SELECT id, nom, chemin FROM entreprises WHERE archive = 0 ORDER BY id');
    const nomSaisi = sanitizeText(req.body.entreprise, 200);

    let ouvert;
    if (existants.length === 0) {
      ouvert = await creerEntreprise(db, { nom: nomSaisi || 'Mon entreprise', userId: result.lastID, profil });
    } else {
      // Un seul dossier, resté vierge : c'est la base vide qu'une version
      // antérieure créait au premier lancement, pas une comptabilité héritée.
      // Elle prend le nom et le profil que l'utilisateur vient de saisir.
      if (existants.length === 1 && (nomSaisi || profil)) {
        const pose = await nommerSiVierge(db, existants[0], { nom: nomSaisi || existants[0].nom, profil });
        if (pose) existants[0].nom = pose;
      }

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
      entreprise: { id: ouvert.id, nom: ouvert.nom },
      // Affiché une fois, avant d'entrer dans l'application : c'est le seul
      // moyen de rentrer si le mot de passe est oublié.
      code_recuperation: await nouveauCodeDeRecuperation(db, result.lastID)
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
      langue: parseLangue(user.langue),
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
    await journaliserPourLeCompte(db, req, user.id, {
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
    const compte = await db.get(
      'SELECT langue, visite_vue, recuperation_le FROM users WHERE id = ?', [req.user.sub]
    );

    return res.json({
      authenticated: true,
      username: req.user.username,
      langue: parseLangue(compte && compte.langue),
      visite_vue: Boolean(compte && compte.visite_vue),
      recuperation_le: (compte && compte.recuperation_le) || null,
      role: ouvert ? ouvert.role : null,
      entreprises: dossiers.map(({ id, nom, role }) => ({ id, nom, role })),
      ouvert: ouvert ? { id: ouvert.id, nom: ouvert.nom, role: ouvert.role } : null
    });
  }));

  /**
   * Langue de l'interface du compte connecté.
   *
   * Elle est propre à chaque compte : changer la sienne ne touche ni les autres
   * utilisateurs du dossier, ni la langue des documents, qui suit celle de
   * chaque client.
   */
  router.put('/langue', authMiddleware, asyncRoute(async (req, res) => {
    if (!LANGUES.includes(req.body.langue)) {
      throw httpError(400, 'Langue inconnue.');
    }
    await getDb().run('UPDATE users SET langue = ? WHERE id = ?', [req.body.langue, req.user.sub]);
    res.json({ langue: req.body.langue });
  }));

  /**
   * La visite guidée a été vue, jusqu'au bout ou passée : elle ne se relance
   * plus d'elle-même pour ce compte. Le bouton de l'en-tête la rouvre à volonté.
   */
  router.put('/visite', authMiddleware, asyncRoute(async (req, res) => {
    await getDb().run('UPDATE users SET visite_vue = 1 WHERE id = ?', [req.user.sub]);
    res.json({ visite_vue: true });
  }));

  /**
   * Crée ou remplace le code de récupération du compte connecté. Le mot de
   * passe actuel est demandé : une session laissée ouverte ne doit pas suffire
   * à s'approprier l'accès de secours.
   */
  router.post('/recuperation', authMiddleware, asyncRoute(async (req, res) => {
    const db = getDb();
    const user = await db.get('SELECT id, password, recuperation_empreinte FROM users WHERE id = ?', [req.user.sub]);
    const motDePasse = req.body && req.body.motDePasse;
    const valide = user && typeof motDePasse === 'string' && await bcrypt.compare(motDePasse, user.password);
    if (!valide) throw httpError(401, 'Mot de passe actuel incorrect.');

    const code = await nouveauCodeDeRecuperation(db, user.id);
    await journaliserPourLeCompte(db, req, user.id, {
      action: ACTIONS.CODE_RECUPERATION,
      entite: 'utilisateur',
      entite_id: user.id,
      details: { remplacement: Boolean(user.recuperation_empreinte) }
    });
    res.json({ code_recuperation: code });
  }));

  /**
   * Mot de passe oublié : un nouveau mot de passe contre le code de
   * récupération.
   *
   * Les tentatives sont limitées comme à la connexion, et la réponse est la
   * même pour un compte inconnu, un compte sans code et un code erroné. Le code
   * ne sert qu'une fois : un nouveau est aussitôt tiré et rendu.
   */
  router.post('/reinitialiser', loginRateLimit, asyncRoute(async (req, res) => {
    const db = getDb();
    const { username, code, nouveauMotDePasse } = req.body || {};
    validateCredentials(username, nouveauMotDePasse);

    const user = typeof username === 'string'
      ? await db.get('SELECT id, username, recuperation_empreinte FROM users WHERE username = ?', [username])
      : null;
    const brut = normaliserCodeRecuperation(code);
    const empreinte = (user && user.recuperation_empreinte) || await temoin();
    const valide = await bcrypt.compare(brut || 'saisie-invalide', empreinte)
      && Boolean(user && user.recuperation_empreinte && brut);
    if (!valide) {
      recordFailure(req.rateLimitKey);
      throw httpError(401, 'Identifiant ou code de récupération invalide.');
    }
    recordSuccess(req.rateLimitKey);

    await db.run('UPDATE users SET password = ? WHERE id = ?', [await bcrypt.hash(nouveauMotDePasse, 12), user.id]);
    const nouveau = await nouveauCodeDeRecuperation(db, user.id);
    await journaliserPourLeCompte(db, { user: { username: user.username } }, user.id, {
      action: ACTIONS.MOT_DE_PASSE_REINITIALISATION,
      entite: 'utilisateur',
      entite_id: user.id,
      details: { username: user.username }
    });

    res.clearCookie('token');
    res.json({
      success: true,
      message: 'Mot de passe réinitialisé. Notez votre nouveau code de récupération : l\'ancien ne servira plus.',
      code_recuperation: nouveau
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
