/**
 * Clé publique de vérification des licences.
 *
 * Ce fichier est versionné et livré avec l'application ; il ne contient que la
 * moitié publique de la paire. **La clé privée ne doit jamais entrer dans ce
 * dépôt** — elle seule permet d'émettre des licences, et une clé privée
 * diffusée ne se rappelle pas.
 *
 * Pour la produire, sur votre machine :
 *
 *     node scripts/generer-licence.js --nouvelle-paire
 *
 * La commande écrit la clé privée dans `clef-privee-licence.pem`, ignoré par
 * git, et remplit la constante ci-dessous. Sauvegardez ce fichier ailleurs que
 * sur votre disque de travail : le perdre revient à ne plus pouvoir émettre de
 * licence, ni renouveler celles de vos clients.
 *
 * Tant que cette valeur est vide, le contrôle de licence est **inerte** :
 * l'application ne compte aucun essai et n'expire jamais. Une version compilée
 * avant que la paire n'existe ne doit pas se verrouiller d'elle-même.
 */

/** Clé publique Ed25519, 32 octets en base64. Vide = contrôle désactivé. */
const CLE_PUBLIQUE = '';

module.exports = { CLE_PUBLIQUE };
