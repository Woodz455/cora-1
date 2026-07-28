/**
 * Relances automatiques des factures impayées.
 *
 * L'application ne savait envoyer un rappel que manuellement, en ouvrant la
 * facture et en cliquant. Les paliers configurés déclenchent désormais l'envoi
 * tout seuls, et le journal des envois garantit qu'un même palier ne part
 * jamais deux fois pour la même facture.
 *
 * Le courriel est envoyé en texte, sans le PDF : celui-ci est produit par le
 * navigateur au moment de l'impression, et n'existe donc pas côté serveur. Le
 * rappel reprend le numéro, le montant dû et l'échéance — ce qui suffit à un
 * rappel de paiement. L'envoi manuel, lui, conserve la pièce jointe.
 */

const { sendEmail, isConfigured } = require('./emailService.js');
const { formatMontant } = require('./money.js');

/** Paliers utilisés lorsque les paramètres n'en définissent aucun (jours après échéance). */
const PALIERS_PAR_DEFAUT = [7, 15, 30];

/** Nombre maximal de courriels envoyés lors d'un même passage. */
const MAX_ENVOIS_PAR_PASSAGE = 50;

const iso = (date) => date.toISOString().split('T')[0];

/**
 * Analyse la liste de paliers saisie dans les paramètres.
 * Accepte « 7,15,30 » ou « 7 ; 15 ; 30 », ignore ce qui n'est pas un entier positif.
 *
 * @param {string} valeur
 * @returns {number[]} paliers triés, sans doublon
 */
function parsePaliers(valeur) {
  if (typeof valeur !== 'string' || !valeur.trim()) return [...PALIERS_PAR_DEFAUT];

  const paliers = valeur
    .split(/[,;\s]+/)
    .map((p) => Number.parseInt(p, 10))
    .filter((p) => Number.isInteger(p) && p > 0 && p <= 365);

  return [...new Set(paliers)].sort((a, b) => a - b);
}

/** Journal des relances d'une facture, du plus récent au plus ancien. */
async function getRelances(db, factureId) {
  return db.all(
    `SELECT id, palier_jours, date_envoi, destinataire, origine, statut, erreur
     FROM relances WHERE facture_id = ?
     ORDER BY date_envoi DESC, id DESC`,
    [factureId]
  );
}

/** Nombre de jours écoulés depuis l'échéance, négatif si elle n'est pas atteinte. */
function joursDeRetard(dateEcheance, aujourdhui = new Date()) {
  const echeance = new Date(`${dateEcheance}T00:00:00Z`);
  const jour = new Date(`${iso(aujourdhui)}T00:00:00Z`);
  return Math.floor((jour - echeance) / 86400000);
}

/**
 * Compose le rappel, dans la langue du client.
 *
 * @returns {{sujet: string, corps: string}}
 */
function composerRappel(facture, entreprise, jours) {
  const isEn = facture.langue === 'en';
  const societe = (entreprise && entreprise.entreprise_nom) || '';
  const destinataire = facture.nom_contact || facture.nom_entreprise;

  // Même écriture que sur la facture imprimée, et dans la langue du client :
  // il doit retrouver un montant identique d'un document à l'autre.
  const montant = formatMontant(facture.solde_restant, facture.devise, isEn ? 'en' : 'fr');

  if (isEn) {
    return {
      sujet: `Payment reminder — invoice ${facture.numero_facture}`,
      corps: [
        `Hello ${destinataire},`,
        '',
        `Invoice ${facture.numero_facture}, issued on ${facture.date_emission}, was due on ${facture.date_echeance}`
          + ` — that is ${jours} ${jours > 1 ? 'days' : 'day'} ago.`,
        `Outstanding balance: ${montant}.`,
        '',
        'If payment has already been sent, please disregard this message.',
        '',
        societe ? `Thank you,\n${societe}` : 'Thank you.'
      ].join('\n')
    };
  }

  return {
    sujet: `Rappel de paiement — facture ${facture.numero_facture}`,
    corps: [
      `Bonjour ${destinataire},`,
      '',
      `La facture ${facture.numero_facture}, émise le ${facture.date_emission}, était due le ${facture.date_echeance}`
        + ` — soit il y a ${jours} ${jours > 1 ? 'jours' : 'jour'}.`,
      `Solde restant à régler : ${montant}.`,
      '',
      'Si votre paiement a déjà été effectué, merci de ne pas tenir compte de ce message.',
      '',
      societe ? `Merci de votre confiance,\n${societe}` : 'Merci.'
    ].join('\n')
  };
}

/**
 * Factures en retard pour lesquelles un palier reste à envoyer.
 *
 * Une facture annulée, soldée, entièrement créditée ou sans adresse courriel
 * est écartée d'office.
 */
async function getRelancesDues(db, paliers, aujourdhui = new Date()) {
  const { getFacturesAvecSoldes } = require('./invoiceService.js');
  const factures = await getFacturesAvecSoldes(db);
  const jour = iso(aujourdhui);

  const dues = [];
  for (const facture of factures) {
    if (facture.statut === 'Annulée' || facture.statut === 'Créditée') continue;
    if (facture.solde_restant <= 0.005) continue;
    if (facture.date_echeance >= jour) continue;

    const client = await db.get('SELECT email, nom_contact, nom_entreprise, langue FROM clients WHERE id = ?', [facture.client_id]);
    if (!client || !client.email) continue;

    const retard = joursDeRetard(facture.date_echeance, aujourdhui);
    // Le palier le plus élevé déjà franchi, pour ne pas envoyer trois rappels
    // d'un coup à une facture oubliée depuis des mois.
    const atteints = paliers.filter((p) => retard >= p);
    if (atteints.length === 0) continue;
    const palier = atteints[atteints.length - 1];

    const dejaEnvoye = await db.get(
      "SELECT id FROM relances WHERE facture_id = ? AND palier_jours = ? AND statut = 'Envoyée'",
      [facture.id, palier]
    );
    if (dejaEnvoye) continue;

    dues.push({ ...facture, ...client, palier, retard });
  }

  return dues;
}

/**
 * Envoie les relances dues et journalise chaque tentative.
 *
 * @param {import('sqlite').Database} db
 * @param {{aujourdhui?: Date, envoyer?: Function}} [options] `envoyer` sert aux tests
 * @returns {Promise<{envoyees: number, erreurs: number, ignorees: number}>}
 */
async function envoyerRelancesDues(db, options = {}) {
  const aujourdhui = options.aujourdhui || new Date();
  const settings = await db.get('SELECT * FROM settings LIMIT 1');

  if (!settings || !settings.relances_actives) {
    return { envoyees: 0, erreurs: 0, ignorees: 0, inactif: true };
  }

  const envoyer = options.envoyer || defaultEnvoyer;
  if (!options.envoyer && !isConfigured()) {
    return { envoyees: 0, erreurs: 0, ignorees: 0, smtpManquant: true };
  }

  const paliers = parsePaliers(settings.relances_paliers);
  const dues = await getRelancesDues(db, paliers, aujourdhui);

  let envoyees = 0;
  let erreurs = 0;
  const jour = iso(aujourdhui);

  for (const facture of dues.slice(0, MAX_ENVOIS_PAR_PASSAGE)) {
    const { sujet, corps } = composerRappel(facture, settings, facture.retard);

    try {
      await envoyer({ to: facture.email, subject: sujet, text: corps }, settings);

      await db.run(
        `INSERT INTO relances (facture_id, palier_jours, date_envoi, destinataire, origine, statut)
         VALUES (?, ?, ?, ?, 'automatique', 'Envoyée')`,
        [facture.id, facture.palier, jour, facture.email]
      );
      // Le compteur porté par la facture reste alimenté : c'est lui qu'affiche
      // la liste des factures.
      await db.run(
        'UPDATE factures SET relances_envoyees = relances_envoyees + 1, date_derniere_relance = ? WHERE id = ?',
        [jour, facture.id]
      );
      envoyees += 1;
    } catch (error) {
      erreurs += 1;
      // L'échec est journalisé pour être visible, sans bloquer les suivantes.
      await db.run(
        `INSERT INTO relances (facture_id, palier_jours, date_envoi, destinataire, origine, statut, erreur)
         VALUES (?, ?, ?, ?, 'automatique', 'Échec', ?)`,
        [facture.id, facture.palier, jour, facture.email, String(error.message).slice(0, 300)]
      );
      console.error(`Relance impossible pour ${facture.numero_facture} :`, error.message);
    }
  }

  return { envoyees, erreurs, ignorees: Math.max(0, dues.length - MAX_ENVOIS_PAR_PASSAGE) };
}

/** Envoi réel, par courriel texte. */
async function defaultEnvoyer(message, settings) {
  return sendEmail(message, settings);
}

module.exports = {
  envoyerRelancesDues,
  getRelancesDues,
  getRelances,
  parsePaliers,
  joursDeRetard,
  composerRappel,
  PALIERS_PAR_DEFAUT
};
