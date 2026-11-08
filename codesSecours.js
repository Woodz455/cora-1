/**
 * Codes de secours : la clé des sauvegardes et le code de récupération.
 *
 * Tous deux sont **générés** par Clora, jamais choisis : une phrase choisie est
 * presque toujours trop courte, et c'est le principe de la clé de récupération
 * de BitLocker, que les utilisateurs de Windows connaissent déjà. Ils sont
 * écrits en base 32 de Crockford, qui écarte les caractères qu'on confond à la
 * lecture (I, L, O, U) : une feuille imprimée se recopie sans hésitation, et
 * une saisie où l'on a tapé O pour 0 est corrigée d'elle-même.
 *
 * Les deux n'ont pas la même longueur, pour qu'on ne les confonde pas sur la
 * feuille de secours :
 * - clé des sauvegardes : 24 caractères, 6 groupes de 4, 120 bits ;
 * - code de récupération : 20 caractères, 5 groupes de 4, 100 bits.
 */

const crypto = require('crypto');

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const LONGUEUR_CLE = 24;
const LONGUEUR_RECUPERATION = 20;

/** Tire un code aléatoire de `longueur` caractères. */
function genererBrut(longueur) {
  const octets = crypto.randomBytes(Math.ceil((longueur * 5) / 8));
  let bits = 0;
  let tampon = 0;
  let sortie = '';
  for (const octet of octets) {
    tampon = (tampon << 8) | octet;
    bits += 8;
    while (bits >= 5 && sortie.length < longueur) {
      sortie += ALPHABET[(tampon >> (bits - 5)) & 31];
      bits -= 5;
    }
    tampon &= (1 << bits) - 1;
  }
  return sortie;
}

/** Présente un code par groupes de quatre : « ABCD-EFGH-… ». */
function formater(brut) {
  return brut.match(/.{1,4}/g).join('-');
}

/**
 * Ramène une saisie à sa forme brute, ou `null` si elle n'a pas la forme
 * attendue. Espaces, tirets et casse sont indifférents ; O se lit 0, I et L se
 * lisent 1.
 */
function normaliser(saisie, longueur) {
  const brut = String(saisie || '')
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (brut.length !== longueur) return null;
  for (const c of brut) if (!ALPHABET.includes(c)) return null;
  return brut;
}

const genererCle = () => genererBrut(LONGUEUR_CLE);
const genererCodeRecuperation = () => genererBrut(LONGUEUR_RECUPERATION);
const normaliserCle = (saisie) => normaliser(saisie, LONGUEUR_CLE);
const normaliserCodeRecuperation = (saisie) => normaliser(saisie, LONGUEUR_RECUPERATION);

module.exports = {
  genererCle,
  genererCodeRecuperation,
  normaliserCle,
  normaliserCodeRecuperation,
  formater,
  LONGUEUR_CLE,
  LONGUEUR_RECUPERATION
};
