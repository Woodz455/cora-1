#!/usr/bin/env node
/**
 * Émission des licences Clora.
 *
 * ⚠️ Cet outil n'est **jamais empaqueté** avec l'application : il détient la
 * capacité d'émettre des licences, et la clé privée qu'il manipule ne doit
 * exister que sur votre machine. Un test le vérifie sur le paquet produit,
 * plutôt que de s'en remettre à une relecture de la configuration.
 *
 * Deux usages.
 *
 * 1. Une seule fois, pour créer votre paire de clés :
 *
 *        node scripts/generer-licence.js --nouvelle-paire
 *
 *    Écrit `clef-privee-licence.pem` (ignoré par git) et renseigne
 *    `licencePublique.js`, qui lui est versionné.
 *
 * 2. À chaque vente, pour émettre une clé :
 *
 *        node scripts/generer-licence.js --titulaire "Plomberie Tremblay" \
 *          --courriel marc@tremblay.ca --mois 12
 *
 *    Affiche la clé à transmettre au client.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const FICHIER_PRIVE = path.join(RACINE, 'clef-privee-licence.pem');
const FICHIER_PUBLIC = path.join(RACINE, 'licencePublique.js');

/** Préfixe repris de `licenceService`, seule source de vérité du format. */
const { PREFIXE } = require('../licenceService.js');

/** Lit les arguments de la ligne de commande. */
function arguments_() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const cle = argv[i].slice(2);
    const suivant = argv[i + 1];
    if (suivant === undefined || suivant.startsWith('--')) args[cle] = true;
    else { args[cle] = suivant; i += 1; }
  }
  return args;
}

/**
 * Crée la paire de clés.
 *
 * Refuse d'écraser une clé privée existante : la remplacer invaliderait
 * d'un coup toutes les licences déjà émises, et vos clients se retrouveraient
 * bloqués sans comprendre pourquoi.
 */
function nouvellePaire() {
  if (fs.existsSync(FICHIER_PRIVE)) {
    console.error(
      `Une clé privée existe déjà : ${FICHIER_PRIVE}\n`
      + "La remplacer invaliderait toutes les licences déjà émises. Supprimez-la\n"
      + 'vous-même si c\'est bien ce que vous voulez.'
    );
    process.exit(1);
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

  fs.writeFileSync(
    FICHIER_PRIVE,
    privateKey.export({ format: 'pem', type: 'pkcs8' }),
    { mode: 0o600 }
  );

  // Les 32 derniers octets de l'export DER sont la clé publique elle-même ;
  // l'en-tête de 12 octets qui les précède est fixe pour Ed25519.
  const brute = publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('base64');

  const source = fs.readFileSync(FICHIER_PUBLIC, 'utf8');
  fs.writeFileSync(
    FICHIER_PUBLIC,
    source.replace(/const CLE_PUBLIQUE = '[^']*';/, `const CLE_PUBLIQUE = '${brute}';`)
  );

  console.log('Paire de clés créée.\n');
  console.log(`  Clé privée  : ${FICHIER_PRIVE}`);
  console.log(`  Clé publique: inscrite dans licencePublique.js\n`);
  console.log('À FAIRE MAINTENANT :');
  console.log('  1. Sauvegardez la clé privée ailleurs que sur ce disque.');
  console.log('     La perdre, c\'est ne plus pouvoir émettre ni renouveler aucune licence.');
  console.log('  2. Ne la versionnez jamais. Elle est déjà dans .gitignore.');
  console.log('  3. Versionnez licencePublique.js, puis republiez l\'application :');
  console.log('     le contrôle de licence reste inerte tant que la version installée');
  console.log('     ne porte pas cette clé publique.');
}

/** Ajoute des mois à une date, en UTC. */
function dansNMois(mois, depuis = new Date()) {
  const d = new Date(Date.UTC(depuis.getUTCFullYear(), depuis.getUTCMonth(), depuis.getUTCDate()));
  d.setUTCMonth(d.getUTCMonth() + Number(mois));
  return d.toISOString().split('T')[0];
}

/** Émet une clé pour un client. */
function emettre(args) {
  if (!fs.existsSync(FICHIER_PRIVE)) {
    console.error(
      `Aucune clé privée : ${FICHIER_PRIVE}\n`
      + 'Lancez d\'abord : node scripts/generer-licence.js --nouvelle-paire'
    );
    process.exit(1);
  }

  const titulaire = typeof args.titulaire === 'string' ? args.titulaire.trim() : '';
  if (!titulaire) {
    console.error('Le titulaire est requis : --titulaire "Nom de l\'entreprise"');
    process.exit(1);
  }

  const mois = Number(args.mois || 12);
  if (!Number.isInteger(mois) || mois < 1 || mois > 120) {
    console.error('La durée de maintenance doit être un nombre de mois entre 1 et 120.');
    process.exit(1);
  }

  const licence = {
    titulaire,
    courriel: typeof args.courriel === 'string' ? args.courriel.trim() : '',
    achat: new Date().toISOString().split('T')[0],
    maintenance_jusqu_au: args.jusqu_au || dansNMois(mois)
  };

  const charge = Buffer.from(JSON.stringify(licence), 'utf8');
  const privee = crypto.createPrivateKey(fs.readFileSync(FICHIER_PRIVE));
  const signature = crypto.sign(null, charge, privee);

  const cle = `${PREFIXE}${charge.toString('base64url')}.${signature.toString('base64url')}`;

  console.log(`\nTitulaire   : ${licence.titulaire}`);
  if (licence.courriel) console.log(`Courriel    : ${licence.courriel}`);
  console.log(`Maintenance : jusqu'au ${licence.maintenance_jusqu_au}`);
  console.log('\nClé à transmettre au client :\n');
  console.log(cle);
  console.log('');
}

const args = arguments_();
if (args['nouvelle-paire']) nouvellePaire();
else emettre(args);
