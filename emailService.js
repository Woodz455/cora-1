/**
 * Envoi de courriels avec la facture ou le devis en pièce jointe.
 *
 * La configuration du serveur d'envoi vient de la base — onglet
 * Paramètres → Courriel —, avec les variables d'environnement en repli.
 *
 * Elle venait auparavant uniquement d'un fichier `.env` lu à l'intérieur de
 * l'archive de l'application : sur une installation réelle, ce fichier était
 * inatteignable et l'envoi de courriels ne pouvait pas fonctionner du tout.
 */

const crypto = require('crypto');
const nodemailer = require('nodemailer');

const { dechiffrer } = require('./secretStorage.js');

/** Taille maximale de la pièce jointe, une fois décodée. */
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

/** Port par défaut : STARTTLS, accepté par la quasi-totalité des fournisseurs. */
const PORT_DEFAUT = 587;

/** Valeur d'exemple livrée dans `.env.exemple` : ce n'est pas un mot de passe. */
const MOT_DE_PASSE_EXEMPLE = 'VOTRE_MOT_DE_PASSE_ICI';

/**
 * Transporteur mémorisé, avec l'empreinte de la configuration qui l'a produit.
 *
 * Sans cette empreinte, un changement de serveur dans les Paramètres n'aurait
 * aucun effet avant le redémarrage de l'application : l'ancien transporteur,
 * mis en cache, aurait continué à servir.
 */
let cache = null;

/**
 * Résout la configuration d'envoi.
 *
 * La base l'emporte sur l'environnement : c'est l'interface qui fait foi, sinon
 * une variable système oubliée écraserait en silence ce que l'utilisateur vient
 * de saisir.
 *
 * @param {import('sqlite').Database} [db]
 * @returns {Promise<{host: string, port: number, user: string, pass: string, source: string}>}
 */
async function chargerConfiguration(db) {
  if (db) {
    try {
      const s = await db.get('SELECT smtp_host, smtp_port, smtp_user, smtp_pass_chiffre FROM settings LIMIT 1');
      if (s && s.smtp_host && s.smtp_user) {
        // Vide si la base a été restaurée sur une autre machine : le coffre du
        // système ne sait plus déchiffrer. L'appelant invitera à la ressaisie.
        const pass = dechiffrer(s.smtp_pass_chiffre);
        if (pass) {
          return {
            host: String(s.smtp_host),
            port: Number(s.smtp_port) || PORT_DEFAUT,
            user: String(s.smtp_user),
            pass,
            source: 'parametres'
          };
        }
      }
    } catch (e) {
      // Colonnes absentes sur une base ancienne : l'environnement prend le relais.
    }
  }

  const pass = process.env.SMTP_PASS;
  return {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || PORT_DEFAUT,
    user: process.env.SMTP_USER || '',
    pass: pass && pass !== MOT_DE_PASSE_EXEMPLE ? pass : '',
    source: 'environnement'
  };
}

/** Vraie dès que les trois champs indispensables sont présents. */
function configurationComplete(config) {
  return Boolean(config && config.host && config.user && config.pass);
}

/**
 * Indique si l'envoi de courriels est exploitable.
 * @param {import('sqlite').Database} [db]
 */
async function isConfigured(db) {
  return configurationComplete(await chargerConfiguration(db));
}

/**
 * Construit le transporteur SMTP, ou le réutilise si rien n'a changé.
 *
 * Aucune contrainte de chiffrement n'est imposée : la configuration d'origine
 * forçait `ciphers: 'SSLv3'`, un protocole obsolète qui dégradait la connexion
 * au lieu de la sécuriser. Node négocie la meilleure version de TLS disponible.
 */
function getTransporter(config) {
  // Le mot de passe entre dans l'empreinte sous forme de condensat : un
  // changement doit reconstruire le transporteur, sans conserver le secret
  // lui-même dans une variable qui survit à l'appel.
  const empreinte = [
    config.host,
    config.port,
    config.user,
    crypto.createHash('sha256').update(config.pass).digest('hex').slice(0, 16)
  ].join('|');

  if (cache && cache.empreinte === empreinte) return cache.transporter;

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
    requireTLS: config.port !== 465
  });

  cache = { empreinte, transporter };
  return transporter;
}

/** Vide le cache. Réservé aux tests. */
function reinitialiser() {
  cache = null;
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
function expediteurFrom(adresse, expediteur = {}) {
  const nomAffiche = (expediteur.entreprise_nom || '').trim();
  return nomAffiche ? `"${nomAffiche.replace(/"/g, '')}" <${adresse}>` : adresse;
}

/** Message unique : les routes et le service doivent dire la même chose. */
const SMTP_NON_CONFIGURE =
  "L'envoi de courriels n'est pas configuré. Ouvrez Paramètres → Courriel pour "
  + "renseigner votre serveur d'envoi.";

/**
 * Résout la configuration et refuse l'envoi si elle est incomplète.
 * @returns {Promise<Object>} la configuration, garantie exploitable
 */
async function exigerConfiguration(db) {
  const config = await chargerConfiguration(db);
  if (!configurationComplete(config)) {
    throw Object.assign(new Error(SMTP_NON_CONFIGURE), { status: 503, expose: true });
  }
  return config;
}

/**
 * Envoie un courriel simple, sans pièce jointe.
 * Utilisé par les relances automatiques, qui s'exécutent côté serveur, là où le
 * PDF — produit par le navigateur — n'est pas disponible.
 *
 * @param {import('sqlite').Database} db
 * @param {{to: string, cc?: string, subject: string, text: string}} message
 * @param {{entreprise_nom?: string}} [expediteur]
 */
async function sendEmail(db, { to, cc, subject, text }, expediteur = {}) {
  const config = await exigerConfiguration(db);

  return getTransporter(config).sendMail({
    from: expediteurFrom(config.user, expediteur),
    to,
    cc: cc || undefined,
    subject,
    text
  });
}

/**
 * Envoie un courriel avec une pièce jointe.
 *
 * @param {import('sqlite').Database} db
 * @param {Object} params
 * @param {{entreprise_nom?: string}} [expediteur] paramètres de l'entreprise
 */
async function sendEmailWithAttachment(db, { to, cc, subject, text, attachmentBase64, filename }, expediteur = {}) {
  const config = await exigerConfiguration(db);

  const content = extractBase64(attachmentBase64);

  return getTransporter(config).sendMail({
    from: expediteurFrom(config.user, expediteur),
    to,
    cc: cc || undefined,
    subject,
    text,
    attachments: [{ filename: filename || 'document.pdf', content, encoding: 'base64' }]
  });
}

/**
 * Vérifie la configuration puis envoie un courriel de contrôle.
 *
 * `verify()` seul confirme que le serveur accepte les identifiants, mais pas
 * qu'un message parvient à destination — un fournisseur peut authentifier puis
 * refuser l'expédition. Les deux étapes sont donc enchaînées, et l'échec
 * distingue laquelle a cédé.
 *
 * @param {import('sqlite').Database} db
 * @param {string} destinataire
 * @param {{entreprise_nom?: string}} [expediteur]
 */
async function envoyerCourrielTest(db, destinataire, expediteur = {}) {
  const config = await exigerConfiguration(db);
  const transporter = getTransporter(config);

  try {
    await transporter.verify();
  } catch (error) {
    throw Object.assign(
      new Error(`Le serveur a refusé la connexion ou les identifiants : ${error.message}`),
      { status: 502, expose: true }
    );
  }

  await transporter.sendMail({
    from: expediteurFrom(config.user, expediteur),
    to: destinataire,
    subject: 'Clora — courriel de test',
    text:
      'Ce message confirme que Clora peut envoyer des courriels depuis votre '
      + "compte.\n\nVous pouvez maintenant transmettre vos factures et vos devis "
      + 'directement depuis le logiciel.'
  });

  return { destinataire, serveur: config.host, expediteur: config.user };
}

module.exports = {
  sendEmail,
  sendEmailWithAttachment,
  envoyerCourrielTest,
  isConfigured,
  chargerConfiguration,
  reinitialiser,
  SMTP_NON_CONFIGURE,
  MAX_ATTACHMENT_BYTES,
  PORT_DEFAUT
};
