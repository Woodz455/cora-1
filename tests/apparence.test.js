/**
 * Les bandes de couleur des conteneurs.
 *
 * Chaque carte de l'application portait une bande de couleur épaisse sur un
 * côté : trois teintes alignées sur la rangée d'indicateurs du tableau de bord,
 * cinq sur celle des rapports. C'est ce qui donnait à l'application un air de
 * démonstration plutôt que d'outil comptable, et c'est le seul reproche retenu
 * sur le design de la 1.7.0.
 *
 * Les conteneurs sont désormais délimités par le contour gris de `--glass-border`,
 * qui était jusque-là blanc, donc invisible sur le fond perle.
 *
 * Une décision de design qui n'est écrite nulle part revient d'elle-même au bout
 * de trois écrans. Celle-ci est écrite ici.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const COMPOSANTS = path.join(__dirname, '..', 'client', 'src', 'components');

/**
 * Deux gabarits d'impression sont exclus : ce sont des documents, pas des
 * écrans de travail. La facture part chez le client et le compte rendu se
 * transforme en PDF ; l'un et l'autre ont leurs propres conventions, et se
 * regardent imprimés.
 */
const DOCUMENTS = new Set(['InvoicePrintTemplate.jsx', 'RapportSommaire.jsx']);

/**
 * Une bande, par opposition à un filet : trois pixels ou plus sur un seul côté.
 * En dessous, c'est une séparation de tableau ou un marqueur de sélection, qui
 * ne sont pas en cause.
 */
const BANDE = /border(?:Left|Top|Right|Bottom)\s*:\s*[`'"]\s*([3-9]|[1-9]\d)px\s+solid\s+([^`'"]+)/g;

/** Un gris ou une variable neutre : ce sont eux qui délimitent, désormais. */
const NEUTRES = [
  '--glass-border', '--border-color', '--hover-border', '--input-border', '--border',
  'transparent', 'currentColor'
];

function fichiersJsx(dossier) {
  return fs.readdirSync(dossier)
    .filter((f) => f.endsWith('.jsx'))
    .filter((f) => !DOCUMENTS.has(f));
}

test('aucun conteneur de l\'application ne porte de bande de couleur', () => {
  const fautives = [];

  for (const fichier of fichiersJsx(COMPOSANTS)) {
    const source = fs.readFileSync(path.join(COMPOSANTS, fichier), 'utf8');
    const lignes = source.split('\n');

    BANDE.lastIndex = 0;
    let trouve;
    while ((trouve = BANDE.exec(source)) !== null) {
      const couleur = trouve[2].trim();
      if (NEUTRES.some((n) => couleur.includes(n))) continue;
      const ligne = source.slice(0, trouve.index).split('\n').length;
      fautives.push(`${fichier}:${ligne} → ${trouve[0].trim()}`
        + `\n      ${lignes[ligne - 1].trim().slice(0, 100)}`);
    }
  }

  assert.deepEqual(fautives, [],
    'Ces conteneurs ont retrouvé une bande de couleur. Le contour gris de '
    + '--glass-border délimite les panneaux ; une couleur épaisse sur un côté '
    + `fait « jeu ».\n    ${fautives.join('\n    ')}`);
});

test('le contour des conteneurs est un gris visible, non du blanc', () => {
  const css = fs.readFileSync(
    path.join(__dirname, '..', 'client', 'src', 'index.css'), 'utf8'
  );

  const valeurs = [...css.matchAll(/--glass-border:\s*([^;]+);/g)].map((m) => m[1].trim());
  assert.equal(valeurs.length, 2, 'un jeton par thème, clair et sombre');

  // Le thème clair posait `rgba(255, 255, 255, 0.9)` sur un fond `#f8fafc` :
  // un contour blanc sur un fond presque blanc ne se voit pas, et la bande de
  // couleur restait la seule limite visible d'une carte.
  const [clair, sombre] = valeurs;
  assert.match(clair, /rgba\(\s*15\s*,\s*23\s*,\s*42\s*,/,
    'en thème clair le contour doit être une encre translucide, pas du blanc');

  // En thème sombre, le contour est bien blanc translucide, mais il était à
  // 0,05 : tout aussi invisible.
  const alphaSombre = Number(sombre.match(/,\s*([\d.]+)\s*\)/)[1]);
  assert.ok(alphaSombre >= 0.1,
    `en thème sombre le contour est à ${alphaSombre}, trop faible pour délimiter`);
});
