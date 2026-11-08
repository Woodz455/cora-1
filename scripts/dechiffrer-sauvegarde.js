#!/usr/bin/env node
/**
 * Déchiffre une sauvegarde de Clora sans Clora.
 *
 * Une sauvegarde chiffrée ne doit pas devenir illisible le jour où le logiciel
 * ne démarre plus : avec la clé imprimée sur la feuille de secours, cet outil
 * rend la base SQLite, qu'on peut ouvrir avec n'importe quel lecteur SQLite ou
 * restaurer dans une nouvelle installation.
 *
 *   node scripts/dechiffrer-sauvegarde.js <sauvegarde.clora> <clé> [sortie.sqlite]
 *
 * La clé s'écrit comme sur la feuille, tirets compris ou non.
 */

const fs = require('fs');
const path = require('path');

const { dechiffrer } = require('../chiffrementSauvegardes.js');
const { normaliserCle } = require('../codesSecours.js');

function principal(argv) {
  const [source, saisie, sortieDemandee] = argv;
  if (!source || !saisie) {
    console.error('Usage : node scripts/dechiffrer-sauvegarde.js <sauvegarde.clora> <clé> [sortie.sqlite]');
    return 2;
  }
  const cle = normaliserCle(saisie);
  if (!cle) {
    console.error("Cette clé n'a pas la bonne forme : 24 caractères, en 6 groupes de 4.");
    return 2;
  }
  const sortie = sortieDemandee || source.replace(/\.clora$/, '') + '.sqlite';
  if (path.resolve(sortie) === path.resolve(source) || fs.existsSync(sortie)) {
    console.error(`${sortie} existe déjà : choisissez un autre nom de sortie.`);
    return 2;
  }
  try {
    fs.writeFileSync(sortie, dechiffrer(fs.readFileSync(source), cle));
  } catch (error) {
    console.error(`Déchiffrement impossible : ${error.message}.`);
    return 1;
  }
  console.log(`Base déchiffrée : ${sortie}`);
  return 0;
}

if (require.main === module) process.exitCode = principal(process.argv.slice(2));

module.exports = { principal };
