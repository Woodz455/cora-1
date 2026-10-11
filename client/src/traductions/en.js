/**
 * Dictionnaire français → anglais de l'interface.
 *
 * La clé est le texte français tel qu'il est écrit dans le code ; la valeur,
 * son équivalent anglais. Les marqueurs `{nom}` sont remplacés à l'affichage
 * et doivent figurer des deux côtés.
 *
 * Anglais canadien des affaires, selon `docs/glossaire-anglais.md` : quote,
 * credit note, catalogue, GST/QST/HST. Un test refuse toute clé employée dans
 * l'interface sans sa traduction ici.
 *
 * Ce fichier ne contient que des données : le test le lit sans dépendre de
 * l'interface.
 */
export default {
  // --- Navigation et titres d'écran --------------------------------------
  'Tableau de bord': 'Dashboard',
  'Aperçu de vos performances financières': 'An overview of your financial performance',
  'Factures': 'Invoices',
  'Gérez vos factures et suivez les paiements': 'Manage your invoices and track payments',
  'Devis': 'Quotes',
  'Gestion des devis': 'Quotes',
  'Vos propositions commerciales': 'Your proposals to clients',
  'Clients': 'Clients',
  'Répertoire clients': 'Client directory',
  'Gérez vos contacts et entreprises': 'Manage your contacts and businesses',
  'Catalogue': 'Catalogue',
  'Catalogue de services': 'Service catalogue',
  'Vos produits et services fréquents': 'Your frequent products and services',
  'Abonnements': 'Subscriptions',
  'Facturation récurrente': 'Recurring billing',
  'Gestion des abonnements et factures automatiques': 'Subscriptions and automatic invoices',
  'Banque': 'Banking',
  'Rapprochement bancaire': 'Bank reconciliation',
  'Importation et liaison des transactions': 'Import and match transactions',
  'Dépenses': 'Expenses',
  'Dépenses et achats': 'Expenses and purchases',
  'Suivez vos charges et taxes payées': 'Track your costs and the taxes you paid',
  'Rapports': 'Reports',
  'Statistiques et performances financières': 'Statistics and financial performance',
  'Journal': 'Audit log',
  "Journal d'audit": 'Audit log',
  'Qui a fait quoi, et quand': 'Who did what, and when',
  'Paramètres': 'Settings',
  "Configuration de l'entreprise et des taxes": 'Business and tax settings',
  'Navigation principale': 'Main navigation',

  // --- Rôles ---------------------------------------------------------------
  'admin': 'admin',
  'comptable': 'accountant',
  'employe': 'employee',

  // --- Coquille --------------------------------------------------------------
  'Chargement…': 'Loading…',
  'Dossier': 'Company file',
  'Changer de dossier': 'Switch company file',
  'Ajouter une entreprise': 'Add a business',
  'Mode clair': 'Light mode',
  'Mode sombre': 'Dark mode',
  'Se déconnecter': 'Sign out',
  "Langue de l'interface": 'Interface language',
  'Clora {derniere} est disponible. Vous utilisez la {courante}.':
    'Clora {derniere} is available. You are using {courante}.',
  'Voir la version': 'See what’s new',
  "Masquer l'avis de mise à jour": 'Dismiss the update notice',
  'Impossible de joindre le serveur.': 'Unable to reach the server.',
  'Erreur {statut}': 'Error {statut}',

  // --- Connexion et premier lancement ---------------------------------------
  'Connexion à Clora': 'Sign in to Clora',
  "Nom d'utilisateur": 'Username',
  'Mot de passe': 'Password',
  'Connexion en cours…': 'Signing in…',
  'Se connecter': 'Sign in',
  'Bienvenue sur Clora': 'Welcome to Clora',
  'Première utilisation : nommez votre entreprise et créez le compte administrateur qui protégera vos données.':
    'First time here: name your business and create the administrator account that will protect your data.',
  "Nom de l'entreprise": 'Business name',
  'Mot de passe (au moins {n} caractères)': 'Password (at least {n} characters)',
  'Confirmez le mot de passe': 'Confirm the password',
  'Création en cours…': 'Creating…',
  'Créer mon compte': 'Create my account',
  'Les mots de passe ne correspondent pas.': 'The passwords do not match.',
  'Le mot de passe doit contenir au moins {n} caractères.': 'The password must contain at least {n} characters.',
  'Choisissez le profil qui décrit le mieux votre entreprise.': 'Choose the profile that best describes your business.',

  // --- Dossiers et profils ---------------------------------------------------
  'Quel dossier ouvrir ?': 'Which company file do you want to open?',
  "Chaque dossier a sa propre comptabilité. Rien n'y est partagé avec les autres.":
    'Each company file has its own books. Nothing is shared with the others.',
  'Ouverture…': 'Opening…',
  'Créer le dossier': 'Create the company file',
  'Nouveau dossier': 'New company file',
  'Choisissez le profil qui décrit le mieux cette entreprise.': 'Choose the profile that best describes this business.',
  'Quel profil décrit le mieux cette entreprise ?': 'Which profile best describes this business?',
  "Le profil règle des valeurs de départ et l'ordre des premiers pas. Il ne retire aucune fonction, et se change à tout moment dans Paramètres.":
    'The profile sets starting values and the order of the first steps. It removes no feature, and you can change it at any time in Settings.',
  'Travailleur autonome': 'Self-employed',
  'Vous facturez seul. Vos clients paient à la réception, vos déplacements comptent.':
    'You invoice on your own. Your clients pay on receipt, and your travel counts.',
  'Startup en démarrage': 'Early-stage startup',
  'Des abonnements, le paiement en ligne, et des clients à faire grandir.':
    'Subscriptions, online payments, and a client base to grow.',
  'PME établie': 'Established small business',
  'Une équipe, un comptable, et un relevé bancaire à rapprocher.':
    'A team, an accountant, and a bank statement to reconcile.',
  'Non précisé': 'Not specified',

  // --- Composants communs ----------------------------------------------------
  'Annuler': 'Cancel',
  'Confirmer': 'Confirm',
  'Fermer le message': 'Close the message',
  'Précédent': 'Previous',
  'Suivant': 'Next',
  'Page {page} sur {total}': 'Page {page} of {total}',
  'Aide': 'Help'
};
