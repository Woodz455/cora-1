/**
 * Envoi de courriels avec la facture ou le devis en pièce jointe.
 */

const nodemailer = require('nodemailer');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

/** Taille maximale de la pièce jointe, une fois décodée. */
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

let transporter = null;

/**
 * Construit le transporteur SMTP.
 *
 * Aucune contrainte de chiffrement n'est imposée : la configuration précédente
 * forçait `ciphers: 'SSLv3'`, un protocole obsolète qui dégradait la connexion
 * au lieu de la sécuriser. Node négocie désormais la meilleure version de TLS
 * disponible avec le serveur.
 */
function getTransporter() {
  if (transporter) return transporter;

  const port = Number(process.env.SMTP_PORT) || 587;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    requireTLS: port !== 465
  });
  return transporter;
}

/** Indique si la configuration SMTP est exploitable. */
function isConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.SMTP_PASS !== 'VOTRE_MOT_DE_PASSE_ICI'
  );
}

/**
 * Extrait les données utiles d'une pièce jointe en base64.
 *
 * html2pdf produit une chaîne du type
 * `data:application/pdf;filename=generated.pdf;base64,JVBER...`
 */
function extractBase64(input) {
  const marker = 'base64,';
  const index = input.indexOf(marker);
  const data = index >= 0 ? input.slice(index + marker.length) : input;
  const cleaned = data.replace(/\s/g, '');

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) {
    throw Object.assign(new Error('La pièce jointe est mal formée.'), { status: 400 });
  }
  // 4 caractères base64 encodent 3 octets.
  if ((cleaned.length * 3) / 4 > MAX_ATTACHMENT_BYTES) {
    throw Object.assign(new Error('La pièce jointe dépasse 15 Mo.'), { status: 400 });
  }
  return cleaned;
}

/**
 * Construit l'en-tête d'expéditeur.
 *
 * Le nom affiché reprend la raison sociale des paramètres : il était auparavant
 * codé en dur, ce qui empêchait toute autre entreprise d'utiliser le logiciel
 * sous son propre nom.
 */
function expediteurFrom(expediteur = {}) {
  const nomAffiche = (expediteur.entreprise_nom || '').trim();
  const adresse = process.env.SMTP_USER;
  return nomAffiche ? `"${nomAffiche.replace(/"/g, '')}" <${adresse}>` : adresse;
}

/** Message unique : les routes et le service doivent dire la même chose. */
const SMTP_NON_CONFIGURE =
  "L'envoi de courriels n'est pas configuré : renseignez SMTP_HOST, SMTP_USER et SMTP_PASS dans le fichier .env.";

function exigerConfiguration() {
  if (!isConfigured()) {
    throw Object.assign(new Error(SMTP_NON_CONFIGURE), { status: 503, expose: true });
  }
}

/**
 * Envoie un courriel simple, sans pièce jointe.
 * Utilisé par les relances automatiques, qui s'exécutent côté serveur, là où le
 * PDF — produit par le navigateur — n'est pas disponible.
 *
 * @param {{to: string, cc?: string, subject: string, text: string}} message
 * @param {{entreprise_nom?: string}} [expediteur]
 */
async function sendEmail({ to, cc, subject, text }, expediteur = {}) {
  exigerConfiguration();

  return getTransporter().sendMail({
    from: expediteurFrom(expediteur),
    to,
    cc: cc || undefined,
    subject,
    text
  });
}

/**
 * Envoie un courriel avec une pièce jointe.
 *
 * @param {Object} params
 * @param {{entreprise_nom?: string}} [expediteur] paramètres de l'entreprise
 */
async function sendEmailWithAttachment({ to, cc, subject, text, attachmentBase64, filename }, expediteur = {}) {
  exigerConfiguration();

  const content = extractBase64(attachmentBase64);

  return getTransporter().sendMail({
    from: expediteurFrom(expediteur),
    to,
    cc: cc || undefined,
    subject,
    text,
    attachments: [{ filename: filename || 'document.pdf', content, encoding: 'base64' }]
  });
}

module.exports = { sendEmail, sendEmailWithAttachment, isConfigured, SMTP_NON_CONFIGURE, MAX_ATTACHMENT_BYTES };
