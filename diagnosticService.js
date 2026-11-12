/**
 * Rapport de diagnostic, à remettre au soutien.
 *
 * Quand quelque chose ne va pas sur un poste installé, la première question est
 * toujours la même : quelle version, quel système, que disent les sauvegardes,
 * et qu'a signalé l'application. Ce rapport y répond en un fichier que
 * l'utilisateur télécharge et transmet lui-même : Clora n'envoie rien.
 *
 * Il ne contient **aucune donnée comptable ni aucun secret** : ni nom de client,
 * ni montant, ni mot de passe, ni clé. Seulement des décomptes, des états et le
 * journal de fonctionnement.
 */

const fs = require('fs');
const os = require('os');

const { versionCourante, estEmpaquetee } = require('./updateService.js');
const { etatLicence } = require('./licenceService.js');
const { lireReglages, lireProtection, etatDesSauvegardes, dossierParDefaut, memeChemin } = require('./backupService.js');
const { coffreDisponible } = require('./secretStorage.js');
const { isConfigured } = require('./emailService.js');
const journal = require('./journalFichier.js');

const TABLES = ['clients', 'factures', 'devis', 'depenses', 'abonnements', 'paiements', 'logs_audit'];

/** Exécute une lecture sans jamais faire échouer le rapport. */
async function tenter(lecture, defaut = 'indisponible') {
  try {
    return await lecture();
  } catch (e) {
    return defaut;
  }
}

/**
 * Compose le rapport.
 *
 * @param {import('sqlite').Database} db base du dossier ouvert
 * @param {import('sqlite').Database} comptesDb registre
 * @param {{chemin?: string, nom?: string}} [entreprise]
 * @returns {Promise<string>} texte brut
 */
async function composerDiagnostic(db, comptesDb, entreprise = {}) {
  const lignes = [];
  const titre = (t) => lignes.push('', `== ${t} ==`);
  const dire = (cle, valeur) => lignes.push(`${cle} : ${valeur}`);
  const ouiNon = (v) => (v ? 'oui' : 'non');

  lignes.push('Diagnostic de Clora', `Produit le ${new Date().toISOString()}`);
  lignes.push('Ce fichier ne contient ni donnée comptable, ni nom de client, ni mot de passe, ni clé.');

  titre('Application');
  dire('Version', versionCourante());
  dire('Installée', ouiNon(estEmpaquetee()));
  dire('Electron', process.versions.electron || 'hors Electron');
  dire('Chromium', process.versions.chrome || '-');
  dire('Node', process.versions.node);
  dire('Système', `${os.type()} ${os.release()} (${process.arch})`);
  dire('Mémoire libre', `${Math.round(os.freemem() / 1048576)} Mo sur ${Math.round(os.totalmem() / 1048576)} Mo`);
  dire('Langue du système', Intl.DateTimeFormat().resolvedOptions().locale);
  dire('Fuseau', Intl.DateTimeFormat().resolvedOptions().timeZone);

  titre('Licence');
  const licence = await tenter(() => etatLicence(comptesDb), null);
  dire('État', licence ? licence.etat : 'indisponible');
  if (licence) dire('Utilisable', ouiNon(licence.utilisable));

  titre('Installation');
  dire('Dossiers d\'entreprise', await tenter(async () => (await comptesDb.get('SELECT COUNT(*) AS n FROM entreprises WHERE archive = 0')).n));
  dire('Comptes', await tenter(async () => (await comptesDb.get('SELECT COUNT(*) AS n FROM users')).n));

  titre('Dossier ouvert');
  dire('Taille de la base', await tenter(() => `${Math.round(fs.statSync(entreprise.chemin).size / 1024)} Ko`));
  dire('Intégrité', await tenter(async () => Object.values(await db.get('PRAGMA quick_check'))[0]));
  for (const table of TABLES) {
    dire(`Lignes dans ${table}`, await tenter(async () => (await db.get(`SELECT COUNT(*) AS n FROM ${table}`)).n));
  }

  titre('Sauvegardes');
  const reglages = await tenter(() => lireReglages(db), null);
  if (reglages) {
    dire('Actives', ouiNon(reglages.active));
    dire('Dossier par défaut', ouiNon(memeChemin(reglages.dossier, dossierParDefaut())));
    dire('Conservées', reglages.retention);
    const etat = await tenter(() => etatDesSauvegardes(db), null);
    dire('Dernière', etat && etat.derniere ? etat.derniere : 'aucune');
    dire('Alerte', etat && etat.alerte ? etat.alerte : 'aucune');
    const protection = await tenter(() => lireProtection(db), null);
    dire('Chiffrées', protection ? ouiNon(protection.active) : 'indisponible');
    if (protection && protection.active) dire('Clé lisible', ouiNon(protection.lisible));
  } else {
    dire('Réglages', 'illisibles');
  }

  titre('Services');
  dire('Coffre du système disponible', ouiNon(await tenter(() => coffreDisponible(), false)));
  dire('Courriel configuré', ouiNon(await tenter(() => isConfigured(db), false)));
  dire('Paiement en ligne actif', ouiNon(await tenter(async () => Boolean((await db.get('SELECT stripe_actif FROM settings LIMIT 1')).stripe_actif), false)));

  titre('Journal de fonctionnement (dernières lignes)');
  const fin = journal.dernieresLignes(300);
  lignes.push(...(fin.length ? fin : ['(aucun journal : il n\'est tenu que dans l\'application installée)']));

  return `${lignes.join('\n')}\n`;
}

module.exports = { composerDiagnostic };
