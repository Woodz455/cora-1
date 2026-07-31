/**
 * Génère `image/clora.ico` à partir de `image/logo.png`.
 *
 * Windows ne pioche pas dans un PNG renommé : il lui faut une véritable icône
 * multi-résolution, sans quoi le raccourci du bureau, le menu Démarrer et la
 * barre des tâches retombent sur l'icône générique d'Electron.
 *
 * Le fichier produit est versionné : ce script n'a besoin d'être relancé que
 * si le logo change.
 *
 *   node scripts/generer-icone.js
 */

const path = require('path');
const { writeFileSync } = require('fs');

const SOURCE = path.join(__dirname, '..', 'image', 'logo.png');
const CIBLE = path.join(__dirname, '..', 'image', 'clora.ico');

// 256 sert aux grandes vignettes de l'explorateur, 16 à la barre de titre ;
// les tailles intermédiaires évitent un rééchantillonnage flou par Windows.
const TAILLES = [16, 24, 32, 48, 64, 128, 256];

async function main() {
  // png-to-ico est un module ES : import() est le seul moyen de le charger
  // depuis ce projet CommonJS.
  const { readPNG, resize } = await import('png-to-ico/lib/png.js');
  const { imagesToIco } = await import('png-to-ico');

  const source = await readPNG(SOURCE);
  if (source.width !== source.height) {
    throw new Error(`${SOURCE} doit être carré (reçu ${source.width}×${source.height}).`);
  }

  // On part d'un 256 unique pour que toutes les tailles descendent de la même
  // interpolation, plutôt que chacune depuis l'original.
  const base = source.width === 256 ? source : resize(source, 256, 256);
  const images = TAILLES.map((taille) => (
    taille === 256 ? base : resize(base, taille, taille)
  ));

  writeFileSync(CIBLE, imagesToIco(images));
  console.log(`Icône écrite : ${CIBLE} (${TAILLES.join(', ')} px)`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
