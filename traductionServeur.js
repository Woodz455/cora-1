/**
 * Messages du serveur, en anglais pour un utilisateur anglophone.
 *
 * Les messages restent écrits en français dans le code, là où ils sont levés :
 * c'est là qu'on les lit, et c'est le français qui les explique. Ils sont
 * traduits à la sortie, dans la langue que l'interface annonce par l'en-tête
 * `X-Clora-Langue`. L'en-tête plutôt que la session : l'écran de connexion
 * doit pouvoir afficher « Invalid username or password » à quelqu'un qui n'a
 * pas encore de session.
 *
 * Un message absent de ce dictionnaire part en français, jamais vide. Un test
 * relit les fichiers déjà traduits et refuse tout message qui n'y figure pas.
 */

/** Messages fixes. */
const EXACTS = new Map([
  // Session et comptes
  ['Identifiants invalides.', 'Invalid username or password.'],
  ['Connexion réussie.', 'Signed in.'],
  ['Déconnecté.', 'Signed out.'],
  ['Compte configuré avec succès.', 'Account set up.'],
  ['Identifiants mis à jour avec succès.', 'Sign-in details updated.'],
  ['Un compte administrateur a déjà été configuré.', 'An administrator account has already been set up.'],
  ['Utilisateur non trouvé.', 'User not found.'],
  ['Mot de passe actuel incorrect.', 'Current password is incorrect.'],
  ["Ce nom d'utilisateur est déjà pris.", 'This username is already taken.'],
  ["Le nom d'utilisateur doit comporter au moins 3 caractères.", 'The username must be at least 3 characters long.'],
  ['Langue inconnue.', 'Unknown language.'],
  ['Accès refusé. Aucun jeton fourni.', 'Access denied. You are not signed in.'],
  ['Jeton invalide ou expiré.', 'Your session has expired. Please sign in again.'],
  ['Accès refusé. Privilèges insuffisants.', 'Access denied. Your role does not allow this.'],

  // Dossiers d'entreprise
  ["Aucun dossier d'entreprise n'est ouvert. Choisissez-en un pour continuer.",
    'No company file is open. Choose one to continue.'],
  ['Ce dossier ne vous est plus accessible.', 'You no longer have access to this company file.'],
  ["Ce dossier n'existe pas ou ne vous est pas accessible.",
    'This company file does not exist or you do not have access to it.'],
  ["Le nom de l'entreprise est requis.", 'The business name is required.'],

  // Licence
  ['Saisissez votre clé de licence.', 'Enter your licence key.'],
  ["Votre période d'essai est terminée.", 'Your trial period has ended.'],
  ['La maintenance de votre licence ne couvre pas cette version de Clora.',
    'Your licence maintenance does not cover this version of Clora.'],

  // Générique
  ['Erreur interne du serveur.', 'Internal server error.']
]);

/**
 * Messages qui portent une valeur. Le motif reconnaît le français, la fonction
 * rend l'anglais avec la même valeur.
 */
const MOTIFS = [
  [/^Le mot de passe doit comporter au moins (\d+) caractères\.$/,
    (m) => `The password must be at least ${m[1]} characters long.`],
  [/^Trop de tentatives de connexion\. Réessayez dans (\d+) minute\(s\)\.$/,
    (m) => `Too many sign-in attempts. Try again in ${m[1]} minute${m[1] === '1' ? '' : 's'}.`],
  [/^Profil inconnu : (.*)\.$/, (m) => `Unknown profile: ${m[1]}.`],
  [/^Route inconnue : (\S+) (.*)$/, (m) => `Unknown route: ${m[1]} ${m[2]}`]
];

/** Traduit un message du serveur ; le rend tel quel s'il n'est pas connu. */
function traduire(texte, langue) {
  if (langue !== 'en' || typeof texte !== 'string') return texte;
  if (EXACTS.has(texte)) return EXACTS.get(texte);
  for (const [motif, rendre] of MOTIFS) {
    const m = texte.match(motif);
    if (m) return rendre(m);
  }
  return texte;
}

/** Langue annoncée par l'interface ; le français par défaut. */
function langueDeRequete(req) {
  return req.get('x-clora-langue') === 'en' ? 'en' : 'fr';
}

/**
 * Traduit les champs `error` et `message` de toute réponse JSON.
 *
 * Posé sur `res.json` plutôt que dans le gestionnaire d'erreurs : plusieurs
 * routes répondent directement, la connexion la première (« Identifiants
 * invalides »), et ne passent jamais par lui.
 */
function traductionDesReponses(req, res, next) {
  const langue = langueDeRequete(req);
  if (langue === 'fr') return next();

  const envoyer = res.json.bind(res);
  res.json = (corps) => {
    if (corps && typeof corps === 'object' && !Array.isArray(corps)) {
      const traduit = { ...corps };
      for (const cle of ['error', 'message']) {
        if (typeof traduit[cle] === 'string') traduit[cle] = traduire(traduit[cle], langue);
      }
      return envoyer(traduit);
    }
    return envoyer(corps);
  };
  return next();
}

module.exports = { traduire, langueDeRequete, traductionDesReponses, EXACTS, MOTIFS };
