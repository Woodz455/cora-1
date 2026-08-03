/**
 * Produit tous les visuels dérivés à partir de l'œuvre d'origine.
 *
 * Le logo est fourni sous une seule forme : un logotype large, sur fond blanc.
 * L'application en a besoin sous deux formes et à plusieurs tailles, et Windows
 * exige en plus une icône carrée — un mot de 750 px de large réduit à 16 px
 * dans la barre des tâches ne se lit pas.
 *
 * Tout est recalculé depuis `image/clora-source.png` : le jour où le logo
 * change, une seule commande suffit.
 *
 *   npm run visuels
 */

const path = require('path');
const { writeFileSync } = require('fs');
const { PNG } = require('pngjs');

const RACINE = path.join(__dirname, '..');
const SOURCE = path.join(RACINE, 'image', 'clora-source.png');

/** Au-delà, un pixel est considéré comme du fond. */
const SEUIL_BLANC = 246;

/**
 * Écart au blanc d'une couleur pleinement opaque du logo.
 *
 * Sert de référence pour convertir un pixel lissé en opacité. Le bleu marine et
 * le vert de la marque donnent 225 et 209 : une valeur intermédiaire les traite
 * tous deux à quelques pour cent près, écart invisible à l'œil.
 */
const ECART_REFERENCE = 217;

/** Tailles d'une icône Windows. 16 est celle de la barre des tâches. */
const TAILLES_ICONE = [16, 24, 32, 48, 64, 128, 256];

function lire(chemin) {
  return PNG.sync.read(require('fs').readFileSync(chemin));
}

/**
 * Détoure le fond blanc.
 *
 * L'opacité se déduit de l'écart au blanc, et non d'un seuil : un seuil rendrait
 * des bords en escalier là où l'original est lissé. La couleur est ensuite
 * « démultipliée » pour retrouver la teinte pleine sous la transparence, sans
 * quoi les contours resteraient délavés.
 */
function detourer(png) {
  const sortie = new PNG({ width: png.width, height: png.height });

  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];

    const ecart = 255 - Math.min(r, g, b);
    const alpha = Math.max(0, Math.min(255, Math.round((ecart / ECART_REFERENCE) * 255)));

    if (alpha === 0) {
      sortie.data[i] = sortie.data[i + 1] = sortie.data[i + 2] = sortie.data[i + 3] = 0;
      continue;
    }

    // observé = a·couleur + (1−a)·255  ⟹  couleur = (observé − (1−a)·255) / a
    const a = alpha / 255;
    const plein = (c) => Math.max(0, Math.min(255, Math.round((c - (1 - a) * 255) / a)));

    sortie.data[i] = plein(r);
    sortie.data[i + 1] = plein(g);
    sortie.data[i + 2] = plein(b);
    sortie.data[i + 3] = alpha;
  }

  return sortie;
}

/**
 * Éclaircit le bleu marine du logotype, pour le thème sombre.
 *
 * Le panneau latéral passe en `rgba(30, 41, 59, 0.7)` quand l'utilisateur
 * choisit le mode sombre : un logotype bleu marine y devient invisible. Le vert
 * de la flèche, lui, ressort sur les deux fonds et n'est pas touché.
 */
function eclaircir(png, clair = [248, 250, 252]) {
  const sortie = new PNG({ width: png.width, height: png.height });
  png.data.copy(sortie.data);

  for (let i = 0; i < sortie.data.length; i += 4) {
    if (sortie.data[i + 3] === 0) continue;

    const r = sortie.data[i];
    const g = sortie.data[i + 1];
    const b = sortie.data[i + 2];

    // Le vert de marque a son canal vert dominant ; tout le reste est le bleu
    // marine du texte, qu'on remplace par la couleur de texte du thème sombre.
    if (g > b && g > r + 20) continue;

    [sortie.data[i], sortie.data[i + 1], sortie.data[i + 2]] = clair;
  }

  return sortie;
}

/** Rectangle occupé par les pixels non transparents. */
function emprise(png, filtre = () => true) {
  let minx = png.width; let miny = png.height; let maxx = -1; let maxy = -1;

  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const i = (png.width * y + x) << 2;
      if (png.data[i + 3] < 16) continue;
      if (!filtre(png.data[i], png.data[i + 1], png.data[i + 2])) continue;

      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
    }
  }

  if (maxx < 0) throw new Error('Aucun pixel visible trouvé.');
  return { x: minx, y: miny, largeur: maxx - minx + 1, hauteur: maxy - miny + 1 };
}

/** Découpe un rectangle. */
function recadrer(png, { x, y, largeur, hauteur }) {
  const sortie = new PNG({ width: largeur, height: hauteur });

  for (let ly = 0; ly < hauteur; ly += 1) {
    for (let lx = 0; lx < largeur; lx += 1) {
      const src = (png.width * (y + ly) + (x + lx)) << 2;
      const dst = (largeur * ly + lx) << 2;
      for (let c = 0; c < 4; c += 1) sortie.data[dst + c] = png.data[src + c];
    }
  }

  return sortie;
}

/**
 * Centre une image dans un canevas carré transparent.
 *
 * Une icône Windows doit être carrée. Déformer le motif pour y parvenir serait
 * pire que de l'entourer de vide.
 */
function carrer(png, marge = 0.08) {
  const cote = Math.round(Math.max(png.width, png.height) * (1 + marge * 2));
  const sortie = new PNG({ width: cote, height: cote, fill: true });
  sortie.data.fill(0);

  const dx = Math.round((cote - png.width) / 2);
  const dy = Math.round((cote - png.height) / 2);

  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const src = (png.width * y + x) << 2;
      const dst = (cote * (y + dy) + (x + dx)) << 2;
      for (let c = 0; c < 4; c += 1) sortie.data[dst + c] = png.data[src + c];
    }
  }

  return sortie;
}

/**
 * Redimensionne, en moyennant les pixels d'origine.
 *
 * Le moyennage compte : à 16 px, prendre un pixel sur douze ferait disparaître
 * un trait fin sur deux et rendrait la flèche méconnaissable.
 */
function redimensionner(png, largeur, hauteur) {
  const sortie = new PNG({ width: largeur, height: hauteur });
  const rx = png.width / largeur;
  const ry = png.height / hauteur;

  for (let y = 0; y < hauteur; y += 1) {
    for (let x = 0; x < largeur; x += 1) {
      const x0 = Math.floor(x * rx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * rx));
      const y0 = Math.floor(y * ry);
      const y1 = Math.max(y0 + 1, Math.floor((y + 1) * ry));

      let r = 0; let g = 0; let b = 0; let a = 0; let n = 0;

      for (let sy = y0; sy < Math.min(y1, png.height); sy += 1) {
        for (let sx = x0; sx < Math.min(x1, png.width); sx += 1) {
          const i = (png.width * sy + sx) << 2;
          const alpha = png.data[i + 3];
          // Couleurs pondérées par l'opacité : un pixel transparent ne doit pas
          // tirer la teinte du voisinage vers le noir.
          r += png.data[i] * alpha;
          g += png.data[i + 1] * alpha;
          b += png.data[i + 2] * alpha;
          a += alpha;
          n += 1;
        }
      }

      const dst = (largeur * y + x) << 2;
      sortie.data[dst] = a > 0 ? Math.round(r / a) : 0;
      sortie.data[dst + 1] = a > 0 ? Math.round(g / a) : 0;
      sortie.data[dst + 2] = a > 0 ? Math.round(b / a) : 0;
      sortie.data[dst + 3] = Math.round(a / n);
    }
  }

  return sortie;
}

const ecrire = (png, chemin) => {
  writeFileSync(chemin, PNG.sync.write(png));
  console.log(`  ${path.relative(RACINE, chemin).padEnd(40)} ${png.width}×${png.height}`);
};

async function main() {
  const source = detourer(lire(SOURCE));

  // --- Logotype : tout le tracé, marges retirées ---
  const logotype = recadrer(source, emprise(source));

  // --- Symbole : la flèche verte, seule partie assez carrée pour une icône ---
  // Le motif du « O » est vert lui aussi : on ne retient que le groupe le plus
  // à droite, qui est la flèche.
  const vert = (r, g, b) => g > b && g > r + 20;
  const tousLesVerts = emprise(source, vert);
  const moitieDroite = {
    ...tousLesVerts,
    x: tousLesVerts.x + Math.floor(tousLesVerts.largeur / 2)
  };
  moitieDroite.largeur = tousLesVerts.x + tousLesVerts.largeur - moitieDroite.x;

  const zoneFleche = emprise(recadrer(source, moitieDroite), vert);
  const symbole = carrer(recadrer(source, {
    x: moitieDroite.x + zoneFleche.x,
    y: moitieDroite.y + zoneFleche.y,
    largeur: zoneFleche.largeur,
    hauteur: zoneFleche.hauteur
  }));

  console.log('Visuels produits :');

  const logotypeClair = eclaircir(logotype);

  ecrire(logotype, path.join(RACINE, 'image', 'clora-logotype.png'));
  // Icône de la fenêtre Electron : carrée, donc le symbole.
  ecrire(symbole, path.join(RACINE, 'image', 'logo.png'));

  const publics = path.join(RACINE, 'client', 'public');
  ecrire(logotype, path.join(publics, 'images', 'logotype.png'));
  ecrire(logotypeClair, path.join(publics, 'images', 'logotype-sombre.png'));
  ecrire(symbole, path.join(publics, 'images', 'symbole.png'));
  ecrire(logotype, path.join(publics, 'banner.png'));

  // --- Icône Windows ---
  const { imagesToIco } = await import('png-to-ico');
  const base = redimensionner(symbole, 256, 256);
  const variantes = TAILLES_ICONE.map((t) => (t === 256 ? base : redimensionner(base, t, t)));

  const ico = path.join(RACINE, 'image', 'clora.ico');
  writeFileSync(ico, imagesToIco(variantes));
  console.log(`  ${path.relative(RACINE, ico).padEnd(40)} ${TAILLES_ICONE.join(', ')} px`);
}

// Exportées pour que les vérifications visuelles prévisualisent exactement ce
// qui entre dans l'icône, plutôt qu'une reproduction approchante.
module.exports = {
  detourer, eclaircir, emprise, recadrer, carrer, redimensionner, lire, TAILLES_ICONE
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
