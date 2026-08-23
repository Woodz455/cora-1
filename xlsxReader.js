/**
 * Lecture minimale d'un classeur `.xlsx`.
 *
 * Un fichier Excel est une archive ZIP contenant du XML. Pour importer une
 * liste de clients, il suffit d'en extraire deux entrées : la table des chaînes
 * partagées et la première feuille. Node sait déjà décompresser ; rien d'autre
 * n'est nécessaire.
 *
 * Ce lecteur existe pour ne pas ajouter de dépendance. La bibliothèque de
 * référence est figée sur npm depuis 2022 avec des failles connues, et les
 * alternatives complètes pèsent plusieurs mégaoctets pour lire une liste de
 * noms. Sur un logiciel qui détient une comptabilité, chaque dépendance est une
 * surface qu'il faudra surveiller pendant des années.
 *
 * Ce qu'il ne fait pas, volontairement : les formules (la valeur mise en cache
 * par Excel est lue à leur place), les styles, les feuilles multiples. Un
 * import se prévisualise avant d'être écrit : ce qui serait mal lu se voit.
 */

const zlib = require('zlib');

/** Signature de fin d'archive ZIP (End of Central Directory). */
const FIN_CENTRALE = 0x06054b50;

/** Signature d'une entrée du répertoire central. */
const ENTREE_CENTRALE = 0x02014b50;

/** Au-delà, on refuse : un tableur de facturation n'atteint pas cette taille. */
const MAX_DECOMPRESSE = 64 * 1024 * 1024;

/**
 * Localise le répertoire central et rend la liste des entrées.
 *
 * Le répertoire est en fin de fichier, précédé d'un commentaire de longueur
 * variable : on remonte donc depuis la fin à la recherche de la signature.
 */
function lireRepertoire(tampon) {
  const debutRecherche = Math.max(0, tampon.length - 66 * 1024);
  let fin = -1;
  for (let i = tampon.length - 22; i >= debutRecherche; i -= 1) {
    if (tampon.readUInt32LE(i) === FIN_CENTRALE) { fin = i; break; }
  }
  if (fin < 0) throw new Error("Ce fichier n'est pas un classeur Excel valide.");

  const nombre = tampon.readUInt16LE(fin + 10);
  let position = tampon.readUInt32LE(fin + 16);

  const entrees = new Map();
  for (let i = 0; i < nombre; i += 1) {
    if (tampon.readUInt32LE(position) !== ENTREE_CENTRALE) break;

    const compression = tampon.readUInt16LE(position + 10);
    const tailleCompressee = tampon.readUInt32LE(position + 20);
    const tailleReelle = tampon.readUInt32LE(position + 24);
    const longueurNom = tampon.readUInt16LE(position + 28);
    const longueurExtra = tampon.readUInt16LE(position + 30);
    const longueurCommentaire = tampon.readUInt16LE(position + 32);
    const decalageLocal = tampon.readUInt32LE(position + 42);
    const nom = tampon.toString('utf8', position + 46, position + 46 + longueurNom);

    entrees.set(nom, { compression, tailleCompressee, tailleReelle, decalageLocal });
    position += 46 + longueurNom + longueurExtra + longueurCommentaire;
  }
  return entrees;
}

/** Décompresse une entrée nommée, ou rend une chaîne vide si elle est absente. */
function extraire(tampon, entrees, nom) {
  const entree = entrees.get(nom);
  if (!entree) return '';

  if (entree.tailleReelle > MAX_DECOMPRESSE) {
    throw new Error('Ce classeur est trop volumineux pour être importé.');
  }

  // L'en-tête local répète le nom et les champs supplémentaires, dont les
  // longueurs diffèrent de celles du répertoire central : il faut les relire ici.
  const base = entree.decalageLocal;
  const longueurNom = tampon.readUInt16LE(base + 26);
  const longueurExtra = tampon.readUInt16LE(base + 28);
  const debut = base + 30 + longueurNom + longueurExtra;
  const brut = tampon.subarray(debut, debut + entree.tailleCompressee);

  if (entree.compression === 0) return brut.toString('utf8');
  if (entree.compression === 8) return zlib.inflateRawSync(brut, { maxOutputLength: MAX_DECOMPRESSE }).toString('utf8');
  throw new Error('Ce classeur utilise une compression non prise en charge.');
}

/** Remplace les entités XML par les caractères qu'elles représentent. */
function decoder(texte) {
  return texte
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Table des chaînes partagées.
 *
 * Excel ne répète pas un texte identique dans plusieurs cellules : il le range
 * ici et n'écrit qu'un indice. Une chaîne peut être découpée en plusieurs
 * fragments `<t>` — mise en forme partielle —, qu'il faut recoller.
 */
function lireChaines(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(([, contenu]) => (
    [...contenu.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(([, t]) => decoder(t)).join('')
  ));
}

/** Convertit une référence de cellule (« BC12 ») en indice de colonne, base 0. */
function indiceColonne(reference) {
  const lettres = String(reference).replace(/\d+$/, '');
  let n = 0;
  for (const c of lettres) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Extrait les lignes d'une feuille.
 *
 * Les cellules vides ne sont pas écrites par Excel : c'est la référence de
 * chaque cellule qui donne sa colonne, et non son rang d'apparition. S'en
 * remettre à l'ordre décalerait toutes les colonnes suivant un trou.
 */
function lireFeuille(xml, chaines) {
  const lignes = [];

  for (const [, contenuLigne] of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cellules = [];

    for (const [, attributs, contenu] of contenuLigne.matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const reference = (attributs.match(/r="([A-Z]+\d+)"/) || [])[1];
      const type = (attributs.match(/t="([^"]+)"/) || [])[1];
      const colonne = reference ? indiceColonne(reference) : cellules.length;

      let valeur = '';
      if (contenu) {
        if (type === 'inlineStr') {
          valeur = [...contenu.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(([, t]) => decoder(t)).join('');
        } else {
          // `<v>` porte la valeur ; pour une formule, c'est le résultat mis en
          // cache par Excel, ce qui est exactement ce qu'on veut importer.
          const v = (contenu.match(/<v\b[^>]*>([\s\S]*?)<\/v>/) || [])[1];
          if (v !== undefined) {
            valeur = type === 's' ? (chaines[Number(v)] ?? '') : decoder(v);
          }
        }
      }

      while (cellules.length < colonne) cellules.push('');
      cellules[colonne] = valeur;
    }

    lignes.push(cellules);
  }

  return lignes;
}

/**
 * Lit la première feuille d'un classeur.
 *
 * @param {Buffer} tampon contenu du fichier `.xlsx`
 * @returns {string[][]} lignes de cellules, en texte
 */
function lireClasseur(tampon) {
  const entrees = lireRepertoire(tampon);

  // Le nom de la première feuille est presque toujours `sheet1.xml`, mais rien
  // ne l'impose : à défaut, on prend la première feuille rencontrée.
  const nomFeuille = entrees.has('xl/worksheets/sheet1.xml')
    ? 'xl/worksheets/sheet1.xml'
    : [...entrees.keys()].find((n) => n.startsWith('xl/worksheets/') && n.endsWith('.xml'));

  if (!nomFeuille) throw new Error('Ce classeur ne contient aucune feuille lisible.');

  const chaines = lireChaines(extraire(tampon, entrees, 'xl/sharedStrings.xml'));
  return lireFeuille(extraire(tampon, entrees, nomFeuille), chaines);
}

module.exports = { lireClasseur, lireChaines, lireFeuille, indiceColonne, decoder };
