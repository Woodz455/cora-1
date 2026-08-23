/**
 * Licence perpétuelle et maintenance annuelle.
 *
 * Une clé est un message signé cryptographiquement. L'application embarque la
 * clé **publique** et vérifie la signature sur place ; la clé privée ne quitte
 * jamais la machine de l'éditeur. Conséquences, toutes voulues :
 *
 *   - aucun serveur à bâtir, à payer ni à surveiller ;
 *   - aucun appel sortant — l'argument « vos données ne partent pas » reste
 *     vrai, ce qui compte sur un logiciel comptable ;
 *   - l'activation fonctionne hors ligne, sur un chantier ou dans un sous-sol.
 *
 * ## La règle qui rend le modèle applicable
 *
 * Chaque version publiée porte sa date. Si cette date dépasse l'échéance de
 * maintenance de la clé, **cette version-là** refuse de s'activer — mais toute
 * version antérieure continue de fonctionner indéfiniment. Le client qui cesse
 * de payer garde son logiciel et ses données pour toujours ; il ne reçoit
 * simplement plus les nouveautés. Rien à bloquer, rien à reprendre.
 *
 * ## Tant qu'aucune clé publique n'est configurée
 *
 * Le contrôle est inerte : ni essai, ni expiration. Une version compilée avant
 * que l'éditeur n'ait généré sa paire de clés ne doit pas se verrouiller toute
 * seule au trentième jour.
 */

const crypto = require('crypto');

const { CLE_PUBLIQUE } = require('./licencePublique.js');

/** Durée de l'essai, sans clé. */
const JOURS_ESSAI = 30;

/** États possibles d'une installation. */
const ETATS = {
  DESACTIVE: 'desactive',
  ESSAI: 'essai',
  ACTIVEE: 'activee',
  ESSAI_EXPIRE: 'essai_expire',
  MAINTENANCE_EXPIREE: 'maintenance_expiree'
};

/** Préfixe des clés, pour qu'une chaîne collée par erreur se reconnaisse. */
const PREFIXE = 'CLORA-';

/**
 * Clé publique en vigueur.
 *
 * Modifiable uniquement par `definirClePublique`, réservé aux tests : ceux-ci
 * ont besoin d'une vraie paire pour éprouver la vérification, et la clé de
 * l'éditeur n'existe pas dans le dépôt.
 */
let clePublique = CLE_PUBLIQUE;

/** Remplace la clé publique. Réservé aux tests. */
function definirClePublique(valeur) {
  clePublique = typeof valeur === 'string' ? valeur : CLE_PUBLIQUE;
}

/** Indique si l'éditeur a configuré sa clé publique. */
function controleActif() {
  return typeof clePublique === 'string' && clePublique.trim().length > 0;
}

/** Convertit une clé publique brute (base64) en objet de vérification. */
function cleDeVerification() {
  return crypto.createPublicKey({
    key: Buffer.concat([
      // En-tête DER d'une clé publique Ed25519 : 12 octets fixes, puis les 32
      // octets de la clé. L'assembler ici évite de stocker un PEM multiligne
      // dans un fichier de configuration.
      Buffer.from('302a300506032b6570032100', 'hex'),
      Buffer.from(clePublique, 'base64')
    ]),
    format: 'der',
    type: 'spki'
  });
}

/**
 * Vérifie une clé de licence.
 *
 * @param {string} cle
 * @returns {{valide: true, licence: Object} | {valide: false, motif: string}}
 */
function verifierCle(cle) {
  if (!controleActif()) return { valide: false, motif: "Aucune clé publique n'est configurée." };

  const texte = String(cle || '').trim().replace(/\s+/g, '');
  if (!texte.startsWith(PREFIXE)) {
    return { valide: false, motif: "Cette clé n'a pas le format attendu." };
  }

  const [charge, signature] = texte.slice(PREFIXE.length).split('.');
  if (!charge || !signature) {
    return { valide: false, motif: 'Cette clé est incomplète.' };
  }

  let donnees;
  try {
    donnees = Buffer.from(charge, 'base64url');
    const signee = crypto.verify(null, donnees, cleDeVerification(), Buffer.from(signature, 'base64url'));
    if (!signee) {
      // Signature invalide : clé inventée, ou modifiée après émission — un
      // client qui aurait repoussé lui-même son échéance de maintenance.
      return { valide: false, motif: "Cette clé n'est pas authentique." };
    }
  } catch (e) {
    return { valide: false, motif: 'Cette clé est illisible.' };
  }

  try {
    const licence = JSON.parse(donnees.toString('utf8'));
    if (!licence.titulaire || !licence.maintenance_jusqu_au) {
      return { valide: false, motif: 'Cette clé est incomplète.' };
    }
    return { valide: true, licence };
  } catch (e) {
    return { valide: false, motif: 'Cette clé est illisible.' };
  }
}

/** Date du jour au format AAAA-MM-JJ, en UTC. */
function jour(date = new Date()) {
  return date.toISOString().split('T')[0];
}

/**
 * Date de la version installée.
 *
 * `build-info.json` est écrit à la compilation. Absent — développement, ou
 * version antérieure à ce mécanisme —, on retombe sur aujourd'hui : une version
 * dont on ignore la date ne doit pas être présumée trop récente pour une clé.
 */
function dateDeVersion() {
  try {
    // eslint-disable-next-line global-require
    const info = require('./build-info.json');
    if (info && info.date) return String(info.date).split('T')[0];
  } catch (e) {
    // Fichier absent : voir ci-dessus.
  }
  return jour();
}

/**
 * Garde-fou d'horloge.
 *
 * Reculer la date de Windows prolongerait l'essai indéfiniment. On retient la
 * date la plus élevée jamais observée ; si l'horloge lui est antérieure, c'est
 * elle qui fait foi. Simple, et sans réseau.
 */
async function dateFiable(comptesDb, maintenant = new Date()) {
  const aujourdhui = jour(maintenant);

  const ligne = await comptesDb.get('SELECT date_max FROM licence WHERE id = 1');
  const connue = ligne && ligne.date_max ? ligne.date_max : null;

  if (!connue || aujourdhui > connue) {
    await comptesDb.run('UPDATE licence SET date_max = ? WHERE id = 1', [aujourdhui]);
    return aujourdhui;
  }
  return connue;
}

/** Nombre de jours entre deux dates AAAA-MM-JJ. */
function joursEntre(debut, fin) {
  const a = Date.parse(`${debut}T00:00:00Z`);
  const b = Date.parse(`${fin}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

/**
 * État de l'installation.
 *
 * @param {import('sqlite').Database} comptesDb registre, non base d'entreprise :
 *   une licence vaut pour l'installation, et la loger dans un dossier
 *   permettrait d'en créer un neuf pour repartir l'essai à zéro.
 */
async function etatLicence(comptesDb, options = {}) {
  const versionDate = options.dateVersion || dateDeVersion();

  if (!controleActif()) {
    return { etat: ETATS.DESACTIVE, utilisable: true, version_date: versionDate };
  }

  const aujourdhui = await dateFiable(comptesDb, options.maintenant);
  const ligne = await comptesDb.get('SELECT * FROM licence WHERE id = 1');

  if (ligne && ligne.cle) {
    const { valide, licence, motif } = verifierCle(ligne.cle);
    if (!valide) {
      // Clé enregistrée devenue invalide : impossible en pratique, sauf base
      // modifiée à la main. On retombe sur l'essai plutôt que de tout bloquer.
      return etatEssai(ligne, aujourdhui, versionDate, motif);
    }

    // La version installée est-elle couverte par la maintenance payée ?
    if (versionDate > licence.maintenance_jusqu_au) {
      return {
        etat: ETATS.MAINTENANCE_EXPIREE,
        utilisable: false,
        titulaire: licence.titulaire,
        maintenance_jusqu_au: licence.maintenance_jusqu_au,
        version_date: versionDate
      };
    }

    return {
      etat: ETATS.ACTIVEE,
      utilisable: true,
      titulaire: licence.titulaire,
      courriel: licence.courriel || null,
      maintenance_jusqu_au: licence.maintenance_jusqu_au,
      version_date: versionDate
    };
  }

  return etatEssai(ligne, aujourdhui, versionDate);
}

/** État d'une installation sans clé valide. */
function etatEssai(ligne, aujourdhui, versionDate, motif) {
  const debut = (ligne && ligne.essai_debut) || aujourdhui;
  const ecoules = joursEntre(debut, aujourdhui);
  const restants = Math.max(0, JOURS_ESSAI - ecoules);

  return {
    etat: restants > 0 ? ETATS.ESSAI : ETATS.ESSAI_EXPIRE,
    utilisable: restants > 0,
    essai_debut: debut,
    jours_restants: restants,
    version_date: versionDate,
    ...(motif ? { motif } : {})
  };
}

/**
 * Enregistre une clé, après l'avoir vérifiée.
 *
 * Une clé dont la maintenance ne couvre pas la version installée est refusée
 * *à l'activation* plutôt qu'acceptée puis bloquée : le message dit alors quoi
 * faire — renouveler, ou réinstaller une version antérieure.
 */
async function activer(comptesDb, cle, options = {}) {
  const { valide, licence, motif } = verifierCle(cle);
  if (!valide) {
    throw Object.assign(new Error(motif), { status: 400, expose: true });
  }

  const versionDate = options.dateVersion || dateDeVersion();
  if (versionDate > licence.maintenance_jusqu_au) {
    throw Object.assign(
      new Error(
        `Cette clé couvre la maintenance jusqu'au ${licence.maintenance_jusqu_au}, `
        + `et cette version date du ${versionDate}. Renouvelez la maintenance, ou `
        + 'installez une version antérieure — vos données restent intactes.'
      ),
      { status: 400, expose: true }
    );
  }

  await comptesDb.run(
    'UPDATE licence SET cle = ?, active_le = ? WHERE id = 1',
    [String(cle).trim(), jour()]
  );

  return etatLicence(comptesDb, options);
}

module.exports = {
  etatLicence,
  definirClePublique,
  activer,
  verifierCle,
  controleActif,
  dateDeVersion,
  dateFiable,
  joursEntre,
  ETATS,
  JOURS_ESSAI,
  PREFIXE
};
