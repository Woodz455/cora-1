/**
 * Archive ZIP écrite au fil de l'eau.
 *
 * Sert à remettre au comptable les reçus d'une période en un seul fichier. Les
 * reçus sont des PDF et des photos, déjà comprimés : les ranger tels quels
 * (méthode « stockée ») coûte à peine plus de place et rien en calcul. Chaque
 * fichier est écrit dès qu'il est lu, si bien qu'une année de reçus ne passe
 * jamais en entier par la mémoire.
 *
 * Pas de dépendance : le format est simple, et une bibliothèque de plus serait
 * une surface d'attaque de plus pour une seule fonction.
 */

/** Table du CRC-32 (polynôme 0xEDB88320), celui qu'exige le format ZIP. */
const TABLE_CRC = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(tampon) {
  let crc = 0xffffffff;
  for (let i = 0; i < tampon.length; i += 1) crc = TABLE_CRC[(crc ^ tampon[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Date et heure au format MS-DOS, celui des en-têtes ZIP (heure locale). */
function dateDos(date) {
  const annee = Math.max(1980, date.getFullYear());
  return {
    heure: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    jour: ((annee - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

/** Au-delà, il faudrait le format ZIP64 : une limite qu'aucune PME n'approche. */
const LIMITE_ZIP32 = 0xffffffff;

/** Indique que les noms sont en UTF-8 : « reçu_Bédard.pdf » reste lisible. */
const DRAPEAU_UTF8 = 0x0800;

class ArchiveZip {
  /** @param {import('stream').Writable} flux là où l'archive s'écrit */
  constructor(flux) {
    this.flux = flux;
    this.position = 0;
    this.entrees = [];
  }

  /**
   * Écrit en respectant le débit du destinataire. Un destinataire qui s'en va
   * (téléchargement annulé) interrompt l'archive au lieu de la laisser
   * attendre indéfiniment.
   */
  async ecrire(tampon) {
    if (this.flux.destroyed) throw new Error('archive interrompue : le destinataire est parti');
    this.position += tampon.length;
    if (this.flux.write(tampon)) return;
    await new Promise((resolve, reject) => {
      const reprendre = () => { this.flux.off('close', abandonner); resolve(); };
      const abandonner = () => {
        this.flux.off('drain', reprendre);
        reject(new Error('archive interrompue : le destinataire est parti'));
      };
      this.flux.once('drain', reprendre);
      this.flux.once('close', abandonner);
    });
  }

  /**
   * Ajoute un fichier.
   *
   * @param {string} nom chemin dans l'archive, avec des « / »
   * @param {Buffer} contenu
   * @param {Date} [date]
   */
  async ajouter(nom, contenu, date = new Date()) {
    const nomOctets = Buffer.from(nom, 'utf8');
    const crc = crc32(contenu);
    const { heure, jour } = dateDos(date);
    const decalage = this.position;
    if (this.entrees.length >= 0xffff || decalage + contenu.length > LIMITE_ZIP32) {
      throw new Error('archive trop volumineuse pour le format ZIP');
    }

    const entete = Buffer.alloc(30);
    entete.writeUInt32LE(0x04034b50, 0); // signature d'un fichier
    entete.writeUInt16LE(20, 4); // version nécessaire : 2.0
    entete.writeUInt16LE(DRAPEAU_UTF8, 6);
    entete.writeUInt16LE(0, 8); // méthode : stocké
    entete.writeUInt16LE(heure, 10);
    entete.writeUInt16LE(jour, 12);
    entete.writeUInt32LE(crc, 14);
    entete.writeUInt32LE(contenu.length, 18); // taille comprimée
    entete.writeUInt32LE(contenu.length, 22); // taille réelle
    entete.writeUInt16LE(nomOctets.length, 26);
    entete.writeUInt16LE(0, 28); // pas de champ supplémentaire

    await this.ecrire(Buffer.concat([entete, nomOctets]));
    await this.ecrire(contenu);
    this.entrees.push({ nomOctets, crc, taille: contenu.length, heure, jour, decalage });
  }

  /** Écrit le répertoire central et ferme l'archive. */
  async terminer() {
    const debut = this.position;
    for (const e of this.entrees) {
      const entete = Buffer.alloc(46);
      entete.writeUInt32LE(0x02014b50, 0); // signature du répertoire central
      entete.writeUInt16LE(20, 4); // version qui a créé l'archive
      entete.writeUInt16LE(20, 6); // version nécessaire
      entete.writeUInt16LE(DRAPEAU_UTF8, 8);
      entete.writeUInt16LE(0, 10);
      entete.writeUInt16LE(e.heure, 12);
      entete.writeUInt16LE(e.jour, 14);
      entete.writeUInt32LE(e.crc, 16);
      entete.writeUInt32LE(e.taille, 20);
      entete.writeUInt32LE(e.taille, 24);
      entete.writeUInt16LE(e.nomOctets.length, 28);
      // Champ supplémentaire, commentaire, disque, attributs : vides.
      entete.writeUInt32LE(e.decalage, 42);
      await this.ecrire(Buffer.concat([entete, e.nomOctets]));
    }
    const taille = this.position - debut;

    const fin = Buffer.alloc(22);
    fin.writeUInt32LE(0x06054b50, 0); // fin du répertoire central
    fin.writeUInt16LE(this.entrees.length, 8);
    fin.writeUInt16LE(this.entrees.length, 10);
    fin.writeUInt32LE(taille, 12);
    fin.writeUInt32LE(debut, 16);
    await this.ecrire(fin);
    this.flux.end();
  }
}

module.exports = { ArchiveZip, crc32 };
