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
  ['Erreur interne du serveur.', 'Internal server error.'],

  // Saisie des documents (validators.js)
  ['Au moins une ligne est requise.', 'At least one line is required.'],
  ['Le taux de change doit être un nombre strictement positif.', 'The exchange rate must be a number greater than zero.'],
  ['Un document ne peut pas comporter plus de 200 lignes.', 'A document cannot have more than 200 lines.'],
  ['Une adresse courriel valide est requise.', 'A valid email address is required.'],
  ['Un client doit être sélectionné.', 'A client must be selected.'],
  ["La date d'émission est requise (format AAAA-MM-JJ).", 'The issue date is required (format YYYY-MM-DD).'],
  ["La date d'échéance est invalide (format AAAA-MM-JJ).", 'The due date is invalid (format YYYY-MM-DD).'],
  ["La date d'échéance ne peut pas précéder la date d'émission.", 'The due date cannot be before the issue date.'],
  ['La date de validité est requise (format AAAA-MM-JJ).', 'The expiry date is required (format YYYY-MM-DD).'],
  ["La date de validité ne peut pas précéder la date d'émission.", 'The expiry date cannot be before the issue date.'],

  // Factures et paiements
  ['Facture créée avec succès.', 'Invoice created.'],
  ['Facture non trouvée.', 'Invoice not found.'],
  ['Facture annulée avec succès.', 'Invoice cancelled.'],
  ['Facture supprimée avec succès.', 'Invoice deleted.'],
  ['Identifiant de facture invalide.', 'Invalid invoice ID.'],
  ['Identifiant de paiement invalide.', 'Invalid payment ID.'],
  ['Client introuvable.', 'Client not found.'],
  ['Cette facture est déjà annulée.', 'This invoice is already cancelled.'],
  ['Cette facture est déjà soldée.', 'This invoice is already paid in full.'],
  ['Une facture annulée ne peut pas recevoir de paiement.', 'A cancelled invoice cannot receive a payment.'],
  ['Une facture comportant un paiement ne peut pas être annulée. Émettez une note de crédit.',
    'An invoice with a payment cannot be cancelled. Issue a credit note.'],
  ['Une facture comportant un paiement ne peut pas être modifiée.', 'An invoice with a payment cannot be edited.'],
  ['Cette facture comporte un paiement encaissé et ne peut pas être supprimée. Annulez-la ou émettez une note de crédit.',
    'This invoice has a payment received and cannot be deleted. Cancel it or issue a credit note.'],
  ["Cette facture provient d'un devis converti et ne peut pas être supprimée.",
    'This invoice comes from a converted quote and cannot be deleted.'],
  ['Cette facture porte déjà une note de crédit : elle ne peut plus être annulée.',
    'This invoice already has a credit note: it can no longer be cancelled.'],
  ['Cette facture porte une note de crédit : modifier ses montants rendrait ce crédit incohérent.',
    'This invoice has a credit note: changing its amounts would make that credit inconsistent.'],
  ['Cette facture porte une note de crédit, qui est elle-même une pièce comptable : elle ne peut pas être supprimée.',
    'This invoice has a credit note, which is an accounting document in its own right: it cannot be deleted.'],
  ['Le montant du paiement doit être strictement positif.', 'The payment amount must be greater than zero.'],
  ['Le montant du paiement est invalide.', 'The payment amount is invalid.'],
  ['La date du paiement est invalide (format AAAA-MM-JJ).', 'The payment date is invalid (format YYYY-MM-DD).'],
  ['Paiement ajouté avec succès.', 'Payment added.'],
  ['Paiement annulé.', 'Payment cancelled.'],
  ['Paiement non trouvé.', 'Payment not found.'],
  ['Ce paiement est déjà annulé.', 'This payment is already cancelled.'],
  ["Le compte rendu porte sur une année, un trimestre ou un mois : indiquez l'année.",
    'The report covers a year, a quarter or a month: enter the year.'],

  // Notes de crédit
  ['Note de crédit non trouvée.', 'Credit note not found.'],
  ['Identifiant de note de crédit invalide.', 'Invalid credit note ID.'],
  ['La facture à créditer doit être précisée.', 'The invoice to credit must be specified.'],
  ['Le montant de la note de crédit doit être strictement positif.', 'The credit note amount must be greater than zero.'],
  ["Une facture annulée n'a rien à créditer.", 'A cancelled invoice has nothing to credit.'],
  ['La facture rattachée comporte un paiement : cette note de crédit ne peut plus être supprimée.',
    'The related invoice has a payment: this credit note can no longer be deleted.'],

  // Devis
  ['Devis non trouvé.', 'Quote not found.'],
  ['Identifiant de devis invalide.', 'Invalid quote ID.'],
  ['Devis mis à jour.', 'Quote updated.'],
  ['Devis refusé.', 'Quote declined.'],
  ['Ce devis est déjà refusé.', 'This quote is already declined.'],
  ['Ce devis a déjà été converti en facture.', 'This quote has already been converted to an invoice.'],
  ['Seul un devis en attente peut être modifié.', 'Only a pending quote can be edited.'],
  ['Un devis converti en facture ne peut pas être refusé.', 'A quote converted to an invoice cannot be declined.'],
  ['Un devis sans ligne ne peut pas être converti.', 'A quote with no lines cannot be converted.'],

  // Clients et catalogue
  ['Client créé avec succès.', 'Client created.'],
  ['Client modifié avec succès.', 'Client updated.'],
  ['Client non trouvé.', 'Client not found.'],
  ['Identifiant de client invalide.', 'Invalid client ID.'],
  ['Article introuvable.', 'Item not found.'],
  ["Identifiant d'article invalide.", 'Invalid item ID.'],
  ['Le nom du service est requis.', 'The service name is required.'],
  ['Le prix unitaire doit être un nombre positif.', 'The unit price must be a positive number.'],

  // Courriels
  ['Courriel envoyé avec succès.', 'Email sent.'],
  ["L'adresse en copie est invalide.", 'The Cc address is invalid.'],
  ['La pièce jointe est requise.', 'The attachment is required.'],
  ['Le destinataire est invalide.', 'The recipient is invalid.'],
  ['La pièce jointe dépasse 15 Mo.', 'The attachment is larger than 15 MB.'],
  ['La pièce jointe est mal formée.', 'The attachment is malformed.'],
  ["L'envoi de courriels n'est pas configuré. Ouvrez Paramètres → Courriel pour renseigner votre serveur d'envoi.",
    'Sending email is not set up. Open Settings → Email to enter your outgoing mail server.'],

  // Import d'un tableur
  ['Aucun fichier reçu.', 'No file received.'],
  ['Le fichier est mal formé.', 'The file is malformed.'],
  ['Le fichier dépasse 10 Mo.', 'The file is larger than 10 MB.'],
  ["Aucune ligne de ce fichier n'est importable en l'état.", 'No row of this file can be imported as it is.'],
  ['Ce fichier ne contient aucune donnée.', 'This file contains no data.'],
  ['Ce classeur est trop volumineux pour être importé.', 'This workbook is too large to import.'],
  ['Ce classeur ne contient aucune feuille lisible.', 'This workbook has no readable sheet.'],
  ['Ce classeur utilise une compression non prise en charge.', 'This workbook uses an unsupported compression.'],
  ["Ce fichier n'est pas un classeur Excel valide.", 'This file is not a valid Excel workbook.'],
  ['Ce courriel apparaît deux fois dans le fichier.', 'This email appears twice in the file.'],
  ["Le nom de l'article est requis.", 'The item name is required.'],
  // Libellés des colonnes (importService.js)
  ["Nom de l'entreprise", 'Business name'],
  ['Courriel', 'Email'],
  ['Personne-ressource', 'Contact person'],
  ['Adresse', 'Address'],
  ['Province', 'Province'],
  ['Langue', 'Language'],
  ['Conditions de paiement', 'Payment terms'],
  ['Nom', 'Name'],
  ['Prix unitaire', 'Unit price'],
  ['Description', 'Description']
]);

/**
 * Réécrit en anglais un montant que le serveur a écrit en français :
 * « 1 234,56 $ » devient « $1,234.56 », « 1 234,56 $ US » devient
 * « US$1,234.56 ». Un texte qui n'en est pas un est rendu tel quel.
 */
function montantEn(texte) {
  const m = String(texte).match(/^(-?[\d\s\u00a0\u202f]+),(\d{2})\s*(\$\s*US|\$)?$/);
  if (!m) return texte;
  const valeur = Number(`${m[1].replace(/[^\d-]/g, '')}.${m[2]}`);
  const devise = m[3] && m[3].includes('US') ? 'USD' : 'CAD';
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: devise }).format(valeur);
}

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
  [/^Route inconnue : (\S+) (.*)$/, (m) => `Unknown route: ${m[1]} ${m[2]}`],
  [/^Province inconnue : (.*)\.$/, (m) => `Unknown province: ${m[1]}.`],
  [/^Ligne (\d+) : la description est requise\.$/, (m) => `Line ${m[1]}: the description is required.`],
  [/^Ligne (\d+) : la quantité doit être un nombre strictement positif\.$/,
    (m) => `Line ${m[1]}: the quantity must be a number greater than zero.`],
  [/^Ligne (\d+) : le prix unitaire doit être un nombre positif\.$/,
    (m) => `Line ${m[1]}: the unit price must be a positive number.`],
  [/^Le paiement \((.+)\) dépasse le solde restant \((.+)\)\.$/,
    (m) => `The payment (${montantEn(m[1])}) exceeds the balance due (${montantEn(m[2])}).`],
  [/^Le crédit \((.+)\) dépasse le montant créditable de la facture (\S+) \((.+)\)\.$/,
    (m) => `The credit (${montantEn(m[1])}) exceeds the amount that can be credited on invoice ${m[2]} (${montantEn(m[3])}).`],
  [/^Seules les factures « (.+) » peuvent être modifiées\.$/,
    (m) => `Only “${traduireStatut(m[1])}” invoices can be edited.`],
  [/^Un devis « (.+) » ne peut pas être converti en facture\.$/,
    (m) => `A “${traduireStatut(m[1])}” quote cannot be converted to an invoice.`],
  [/^Note de crédit (\S+) supprimée\.$/, (m) => `Credit note ${m[1]} deleted.`],
  [/^Le serveur a refusé la connexion ou les identifiants : (.*)$/s,
    (m) => `The server refused the connection or the credentials: ${m[1]}`],
  [/^Ce fichier compte plus de (\d+) lignes\. Découpez-le pour l'importer\.$/,
    (m) => `This file has more than ${m[1]} rows. Split it to import it.`],
  [/^Type d'import inconnu : (.*)\.$/, (m) => `Unknown import type: ${m[1]}.`],
  [/^(\d+) client\(s\) importé\(s\)\.$/,
    (m) => `${m[1]} client${m[1] === '1' ? '' : 's'} imported.`],
  [/^(\d+) article\(s\) importé\(s\)\.$/,
    (m) => `${m[1]} item${m[1] === '1' ? '' : 's'} imported.`],
  [/^Prix illisible ou négatif : « (.*) »\.$/s, (m) => `Unreadable or negative price: “${m[1]}”.`]
];

/** Statuts cités dans un message, traduits comme à l'écran. */
const STATUTS_EN = {
  'En attente': 'Pending', 'Partiellement payée': 'Partially paid', 'Payée': 'Paid',
  'Créditée': 'Credited', 'Annulée': 'Cancelled', 'Refusé': 'Declined', 'Converti': 'Converted'
};
function traduireStatut(statut) {
  return STATUTS_EN[statut] || statut;
}

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

module.exports = { traduire, langueDeRequete, traductionDesReponses, montantEn, EXACTS, MOTIFS };
