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

/**
 * Les émojis de l'interface.
 *
 * Il y en avait trente-quatre, dans quatorze fichiers. Deux raisons de les
 * avoir remplacés par des icônes dessinées, en plus de l'avis du propriétaire.
 *
 * La première : un émoji est rendu par la police du système, donc son trait, sa
 * couleur et son épaisseur échappent au produit. Le bouton « Supprimer » avait
 * un texte rouge et une corbeille grise, parce qu'un émoji ignore la couleur de
 * son bouton ; une icône `lucide`, tracée en `currentColor`, la prend et la suit
 * au survol. Le drapeau `🇨🇦` de l'écran Rapports ne s'affichait même pas sous
 * Windows, qui ne compose pas les paires d'indicateurs régionaux et montrait
 * deux lettres encadrées.
 *
 * La seconde : aucun titre de panneau de l'application n'a jamais porté d'icône.
 * Les cinq titres illustrés de l'écran Rapports étaient les seuls, et c'est ce
 * qui ne s'alignait pas avec le reste.
 *
 * `\p{Regional_Indicator}` est nécessaire en plus de `\p{Extended_Pictographic}` :
 * au sens d'Unicode un drapeau n'est pas un pictogramme, et c'est justement
 * celui qui ne s'affichait pas.
 *
 * Le relevé porte sur **tout `client/src`, sans exception**, y compris les deux
 * gabarits d'impression : le document garde ses conventions, mais les émojis
 * qu'ils portaient étaient sur leurs boutons à l'écran, pas dans la page
 * imprimée.
 */
test("l'interface ne porte aucun émoji", () => {
  const PICTOGRAMME = /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u;
  const SOURCE = path.join(__dirname, '..', 'client', 'src');
  const fautives = [];

  const parcourir = (dossier) => {
    for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
      const chemin = path.join(dossier, entree.name);
      if (entree.isDirectory()) { parcourir(chemin); continue; }
      if (!/\.(jsx|js|css|html)$/.test(entree.name)) continue;
      fs.readFileSync(chemin, 'utf8').split('\n').forEach((ligne, i) => {
        const trouves = [...ligne].filter((c) => PICTOGRAMME.test(c));
        if (trouves.length) {
          fautives.push(`${path.relative(SOURCE, chemin)}:${i + 1} → ${trouves.join(' ')}`);
        }
      });
    }
  };
  parcourir(SOURCE);

  assert.deepEqual(fautives, [],
    "Des émojis sont revenus dans l'interface. Les icônes de Clora sont "
    + 'dessinées : `lucide-react`, `size={16}` sur un bouton, `size={20}` dans la '
    + `navigation.\n    ${fautives.join('\n    ')}`);
});

/**
 * Le rouge des indicateurs est conditionnel.
 *
 * Les cinq chiffres de l'écran Rapports portaient chacun une couleur fixe, qui
 * étiquetait au lieu de signaler : le bénéfice net était violet qu'il fût
 * positif ou négatif, et les dépenses rouges même à zéro. Elles sont parties.
 *
 * Deux chiffres gardent le rouge, mais seulement quand ils annoncent quelque
 * chose : le montant en retard du tableau de bord au-dessus de zéro, et le
 * bénéfice net en dessous. Chacun porte aussi un triangle, parce qu'une couleur
 * seule ne signale rien à qui ne la distingue pas.
 *
 * Ce test refuse qu'une couleur d'étiquette revienne par cette porte : sur ces
 * deux écrans, `--status-danger` posé sur un indicateur doit dépendre d'une
 * condition. Il ne juge pas la condition, seulement son existence.
 */
test('le rouge des indicateurs reste conditionnel', () => {
  /**
   * Le relevé ne porte que sur le chiffre des cartes, repéré par sa taille :
   * c'est lui qui portait une couleur d'étiquette. Le panneau des alertes de
   * trésorerie en contient d'autres, mais il ne se rend pas du tout s'il n'y a
   * aucune facture en retard : sa condition est son existence même.
   *
   * Les deux tailles sont les deux seules de cet ordre dans ces fichiers. Si
   * l'une disparaît, le test échoue en le disant plutôt que de cesser
   * silencieusement de surveiller.
   */
  const CHIFFRES = { 'Dashboard.jsx': '2.3rem', 'ReportDashboard.jsx': '1.9rem' };
  const fautives = [];

  for (const [fichier, taille] of Object.entries(CHIFFRES)) {
    const lignes = fs.readFileSync(path.join(COMPOSANTS, fichier), 'utf8').split('\n');

    // La déclaration de style du chiffre s'étale sur quelques lignes : on lit
    // depuis `fontSize` jusqu'à la fin de l'objet de style.
    const debut = lignes.findIndex((l) => l.includes(`fontSize: '${taille}'`));
    assert.ok(debut >= 0,
      `le chiffre des cartes de ${fichier} ne se trouve plus à ${taille} : `
      + 'ce test ne surveille plus rien, il faut le rattacher.');

    const bloc = lignes.slice(debut, debut + 4).join(' ');
    const couleur = bloc.match(/color:\s*([^,}]+)/);
    assert.ok(couleur, `aucune couleur sur le chiffre des cartes de ${fichier}`);

    const valeur = couleur[1].trim();
    const conditionnelle = valeur.includes('?');
    const neutre = valeur.includes('--text-main');
    if (!conditionnelle && !neutre) fautives.push(`${fichier}:${debut + 1} → color: ${valeur}`);
  }

  assert.deepEqual(fautives, [],
    "Le chiffre d'une carte porte une couleur fixe. Une couleur qui ne dépend "
    + "de rien étiquette au lieu de signaler, et c'est ce qui donnait à ces deux "
    + `écrans un air de démonstration.\n    ${fautives.join('\n    ')}`);
});

/**
 * Les couleurs des cellules de tableau.
 *
 * La colonne des taxes des dépenses était peinte en `#8b5cf6`, la valeur
 * Tailwind retirée des cartes des rapports : 4,12:1 sur un panneau clair et
 * 3,84:1 sur un panneau sombre, sous le seuil de 4,5:1 exigé du texte courant,
 * et posée sans condition, si bien qu'un « 0,00 $ » s'annonçait en crédit de
 * taxes.
 *
 * La règle est propre à vérifier : ces deux lignes étaient les seules cellules
 * de toute l'application à porter une couleur écrite en dur. Toutes les autres
 * passent par un jeton, qui suit les deux thèmes.
 */
test('aucune cellule de tableau ne porte de couleur écrite en dur', () => {
  const CELLULE = /<t[dh][^>]*#[0-9a-fA-F]{3,8}/g;
  const fautives = [];

  for (const fichier of fichiersJsx(COMPOSANTS)) {
    const source = fs.readFileSync(path.join(COMPOSANTS, fichier), 'utf8');
    CELLULE.lastIndex = 0;
    let trouve;
    while ((trouve = CELLULE.exec(source)) !== null) {
      const ligne = source.slice(0, trouve.index).split('\n').length;
      fautives.push(`${fichier}:${ligne} → ${trouve[0].trim().slice(0, 90)}`);
    }
  }

  assert.deepEqual(fautives, [],
    "Une cellule de tableau porte une couleur écrite en dur. Les couleurs de "
    + "l'application passent par un jeton, qui suit le thème clair et le thème "
    + `sombre.\n    ${fautives.join('\n    ')}`);
});

/**
 * La bulle d'aide est atteignable.
 *
 * `InfoTooltip` n'était qu'un `<span>` écoutant le survol de la souris : rien ne
 * l'ouvrait au clavier, un lecteur d'écran n'en voyait ni nom ni rôle, et le
 * doigt n'avait aucune prise. Son déclencheur est un bouton, ce qui règle les
 * trois d'un coup et lui donne l'anneau de focus que la feuille de style
 * accorde déjà à tous les boutons.
 *
 * La bulle n'est pas non plus posée dans un `<label>` : le nom accessible de son
 * bouton entrerait dans celui du champ. Le dépôt avait déjà tranché cela pour
 * les en-têtes de tri, où la propriété `suffixe` d'`EnTeteTri` existe pour que
 * la bulle reste hors du bouton.
 *
 * Le dépôt n'a pas de bibliothèque de test de rendu : ce test lit la source.
 * Le comportement au clavier se vérifie à l'écran, pas ici.
 */
test("la bulle d'aide est atteignable au clavier, et hors des libellés", () => {
  const source = fs.readFileSync(path.join(COMPOSANTS, 'InfoTooltip.jsx'), 'utf8');

  assert.match(source, /<button/,
    'le déclencheur doit être un bouton : un `<span>` ne prend pas le focus');
  assert.match(source, /aria-label=/,
    "le bouton doit porter un nom accessible : son icône n'en est pas un");
  assert.match(source, /role="tooltip"/, 'la bulle doit annoncer son rôle');
  assert.match(source, /'Escape'/,
    'la bulle doit se fermer au clavier, comme l\'exige la règle sur le contenu '
    + 'qui apparaît au survol');
  assert.match(source, /createPortal/,
    'la bulle doit sortir de ses ancêtres : elle était rognée par le conteneur '
    + 'de défilement des tableaux');

  const niches = [];
  for (const fichier of fichiersJsx(COMPOSANTS)) {
    const jsx = fs.readFileSync(path.join(COMPOSANTS, fichier), 'utf8');
    for (const bloc of jsx.matchAll(/<label[^>]*>([\s\S]*?)<\/label>/g)) {
      if (bloc[1].includes('InfoTooltip')) niches.push(`${fichier} → ${bloc[0].slice(0, 70)}`);
    }
  }

  assert.deepEqual(niches, [],
    "Une bulle d'aide est posée dans un `<label>` : le nom accessible de son "
    + `bouton entre alors dans celui du champ.\n    ${niches.join('\n    ')}`);
});

/**
 * Les polices sont embarquées, et portent le nom qu'il faut.
 *
 * Elles étaient nommées dans la feuille de style sans être chargées nulle part :
 * `--font-body` demandait « Inter », et rien dans l'application ne fournissait
 * Inter. Un poste Windows affichait Segoe UI à sa place, et le produit n'avait
 * pas la typographie qu'il croyait avoir. Le défaut était invisible sur un poste
 * de développement où la police est installée, ce qui est la pire espèce.
 *
 * Le piège, une fois les fichiers embarqués, est le nom : les paquets déclarent
 * « Inter Variable » et « Outfit Variable ». Demander « Inter » ne charge rien.
 *
 * Ce test lit les sources du dépôt et non `client/node_modules`, parce que la
 * suite s'exécute avant l'installation des dépendances de l'interface. Quand
 * elles sont là, il vérifie en plus le nom auprès des paquets eux-mêmes.
 */
test('les polices du produit sont embarquées et correctement nommées', () => {
  const CLIENT = path.join(__dirname, '..', 'client');
  const ATTENDUES = [
    { paquet: '@fontsource-variable/inter', famille: 'Inter Variable', jeton: '--font-body' },
    { paquet: '@fontsource-variable/outfit', famille: 'Outfit Variable', jeton: '--font-display' }
  ];

  const manifeste = JSON.parse(fs.readFileSync(path.join(CLIENT, 'package.json'), 'utf8'));
  const entree = fs.readFileSync(path.join(CLIENT, 'src', 'main.jsx'), 'utf8');
  const feuille = fs.readFileSync(path.join(CLIENT, 'src', 'index.css'), 'utf8');

  for (const { paquet, famille, jeton } of ATTENDUES) {
    assert.ok(manifeste.dependencies[paquet],
      `${paquet} doit être une dépendance : c'est lui qui apporte les fichiers`);

    assert.ok(entree.includes(`'${paquet}/wght.css'`),
      `${paquet} doit être importé par main.jsx, sans quoi rien n'est chargé`);

    // Le premier nom du jeton est celui que le navigateur essaie en premier.
    const declaration = feuille.match(new RegExp(`${jeton}:\\s*'([^']+)'`));
    assert.ok(declaration, `${jeton} doit nommer une famille`);
    assert.equal(declaration[1], famille,
      `${jeton} demande « ${declaration[1] } » alors que le paquet fournit `
      + `« ${famille} » : la police ne serait pas chargée`);

    // Quand les dépendances de l'interface sont installées, le nom se vérifie
    // à la source plutôt que sur parole.
    const css = path.join(CLIENT, 'node_modules', paquet, 'wght.css');
    if (fs.existsSync(css)) {
      const familles = [...fs.readFileSync(css, 'utf8').matchAll(/font-family:\s*'([^']+)'/g)]
        .map((m) => m[1]);
      assert.ok(familles.includes(famille),
        `${paquet} déclare « ${[...new Set(familles)].join(', ')} », non « ${famille} »`);
    }
  }

  // Le but premier : un logiciel de bureau ne va pas chercher une police en ligne.
  const sources = [feuille, entree, fs.readFileSync(path.join(CLIENT, 'index.html'), 'utf8')];
  for (const source of sources) {
    assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(source),
      'aucune police ne doit être chargée depuis un service distant : '
      + "l'application doit fonctionner hors ligne");
  }

  // Les deux polices sont sous licence SIL Open Font 1.1, qui autorise leur
  // emploi dans un logiciel commercial mais exige que sa notice accompagne les
  // fichiers. `node_modules` n'est pas empaqueté dans l'exécutable : la notice
  // doit donc être copiée dans le dépôt et listée parmi les fichiers empaquetés.
  const RACINE = path.join(__dirname, '..');
  const notice = path.join(RACINE, 'LICENCES-TIERCES.txt');
  assert.ok(fs.existsSync(notice),
    'LICENCES-TIERCES.txt doit exister : la licence des polices embarquées doit '
    + 'voyager avec elles');

  const texte = fs.readFileSync(notice, 'utf8');
  for (const { famille } of ATTENDUES) {
    const nom = famille.replace(' Variable', '');
    assert.ok(texte.includes(nom), `la notice doit citer ${nom}`);
  }
  assert.ok(texte.includes('SIL Open Font License'),
    'la notice doit porter le texte de la licence, non son seul nom');

  const empaquetes = JSON.parse(
    fs.readFileSync(path.join(RACINE, 'package.json'), 'utf8')
  ).build.files;
  assert.ok(empaquetes.includes('LICENCES-TIERCES.txt'),
    "la notice doit être empaquetée, sans quoi elle ne suit pas les polices");
});
