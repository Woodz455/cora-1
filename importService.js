/**
 * Import de clients et d'articles depuis un tableur.
 *
 * C'est le premier obstacle à toute vente : un prospect qui doit ressaisir deux
 * cents clients à la main n'arrive jamais au bout de la démonstration. Pour un
 * comptable qui reprend vingt dossiers, le calcul est vingt fois pire.
 *
 * Trois partis pris :
 *
 *   - **Les colonnes se choisissent à l'écran.** Aucun fichier réel n'a les
 *     en-têtes qu'on espérait ; imposer un gabarit revient à refuser l'import.
 *   - **Rien n'est écrit avant d'avoir été montré.** L'aperçu dit ce qui
 *     passera et ce qui sera refusé, avec le motif.
 *   - **Tout ou rien.** L'écriture se fait dans une transaction : un import à
 *     moitié appliqué sur une comptabilité est pire que pas d'import du tout.
 */

const { validateClient, sanitizeText } = require('./validators.js');
const { lireClasseur } = require('./xlsxReader.js');

/** Au-delà, l'aperçu deviendrait illisible et la transaction interminable. */
const MAX_LIGNES = 5000;

/** Séparateurs envisagés, du plus probable au moins probable en francophonie. */
const SEPARATEURS = [';', ',', '\t', '|'];

/**
 * Colonnes que l'on sait remplir, et les en-têtes qui les désignent
 * habituellement. Les variantes anglaises sont reconnues : un fichier exporté
 * d'un logiciel américain est le cas courant, pas l'exception.
 */
const CHAMPS_CLIENT = [
  { cle: 'nom_entreprise', libelle: "Nom de l'entreprise", requis: true, alias: ['nom', 'entreprise', 'client', 'raison sociale', 'company', 'name', 'customer'] },
  { cle: 'email', libelle: 'Courriel', requis: true, alias: ['courriel', 'email', 'e-mail', 'adresse courriel', 'mail'] },
  { cle: 'nom_contact', libelle: 'Personne-ressource', requis: false, alias: ['contact', 'personne', 'responsable', 'nom du contact'] },
  { cle: 'adresse', libelle: 'Adresse', requis: false, alias: ['adresse', 'address', 'rue'] },
  { cle: 'province', libelle: 'Province', requis: false, alias: ['province', 'state', 'région'] },
  { cle: 'langue', libelle: 'Langue', requis: false, alias: ['langue', 'language'] },
  { cle: 'conditions_paiement', libelle: 'Conditions de paiement', requis: false, alias: ['conditions', 'terme', 'termes', 'délai', 'terms'] }
];

const CHAMPS_CATALOGUE = [
  { cle: 'nom', libelle: 'Nom', requis: true, alias: ['nom', 'article', 'produit', 'service', 'désignation', 'name', 'item'] },
  { cle: 'prix_unitaire', libelle: 'Prix unitaire', requis: true, alias: ['prix', 'prix unitaire', 'tarif', 'montant', 'price', 'rate'] },
  { cle: 'description', libelle: 'Description', requis: false, alias: ['description', 'détail', 'notes'] }
];

const MODELES = { clients: CHAMPS_CLIENT, catalogue: CHAMPS_CATALOGUE };

/**
 * Devine le séparateur d'un fichier CSV.
 *
 * Le comptage se fait hors guillemets : une raison sociale comme
 * « Tremblay, Roy et associés » contient plus de virgules que la ligne n'a de
 * colonnes, et emporterait la décision.
 */
function detecterSeparateur(premiereLigne) {
  let meilleur = SEPARATEURS[0];
  let record = 0;

  for (const separateur of SEPARATEURS) {
    let compte = 0;
    let entreGuillemets = false;
    for (const caractere of premiereLigne) {
      if (caractere === '"') entreGuillemets = !entreGuillemets;
      else if (caractere === separateur && !entreGuillemets) compte += 1;
    }
    if (compte > record) { record = compte; meilleur = separateur; }
  }
  return meilleur;
}

/**
 * Analyse un CSV conforme au RFC 4180.
 *
 * Écrit à la main plutôt que découpé sur le séparateur : un champ entre
 * guillemets peut contenir le séparateur, un saut de ligne, et des guillemets
 * doublés. Un `split()` couperait au milieu d'une adresse.
 */
function analyserCSV(texte) {
  // Excel préfixe ses exports d'une marque d'ordre d'octets ; laissée en place,
  // elle collerait à l'en-tête de la première colonne et le rendrait
  // méconnaissable.
  const contenu = texte.replace(/^﻿/, '');
  const separateur = detecterSeparateur(contenu.split(/\r?\n/)[0] || '');

  const lignes = [];
  let champs = [];
  let champ = '';
  let entreGuillemets = false;

  for (let i = 0; i < contenu.length; i += 1) {
    const c = contenu[i];

    if (entreGuillemets) {
      if (c === '"') {
        if (contenu[i + 1] === '"') { champ += '"'; i += 1; } else entreGuillemets = false;
      } else champ += c;
      continue;
    }

    if (c === '"') { entreGuillemets = true; continue; }
    if (c === separateur) { champs.push(champ); champ = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { champs.push(champ); lignes.push(champs); champs = []; champ = ''; continue; }
    champ += c;
  }

  if (champ !== '' || champs.length > 0) { champs.push(champ); lignes.push(champs); }

  // Une ligne entièrement vide n'est pas une donnée : les tableurs en laissent
  // volontiers traîner en fin de fichier.
  return lignes.filter((l) => l.some((v) => String(v).trim() !== ''));
}

/**
 * Lit un fichier et rend ses en-têtes et ses lignes.
 *
 * @param {string} nomFichier sert à choisir le format
 * @param {Buffer} tampon
 */
function analyser(nomFichier, tampon) {
  const estClasseur = /\.xlsx$/i.test(String(nomFichier || ''));
  const brut = estClasseur ? lireClasseur(tampon) : analyserCSV(tampon.toString('utf8'));

  if (brut.length === 0) throw Object.assign(new Error('Ce fichier ne contient aucune donnée.'), { status: 400, expose: true });
  if (brut.length - 1 > MAX_LIGNES) {
    throw Object.assign(
      new Error(`Ce fichier compte plus de ${MAX_LIGNES} lignes. Découpez-le pour l'importer.`),
      { status: 400, expose: true }
    );
  }

  const [entetes, ...lignes] = brut;
  return { entetes: entetes.map((e) => String(e).trim()), lignes };
}

/** Normalise un libellé pour la comparaison : sans accents, sans ponctuation. */
function normaliser(texte) {
  return String(texte)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Associe automatiquement les colonnes du fichier aux champs attendus.
 *
 * Ce n'est qu'une proposition : l'utilisateur la corrige à l'écran. Une
 * correspondance devinée puis appliquée en silence importerait des courriels
 * dans la colonne des adresses sans que personne ne s'en aperçoive.
 */
function deviner(entetes, modele) {
  const champs = MODELES[modele] || [];
  const correspondance = {};
  const pris = new Set();

  for (const champ of champs) {
    const candidats = [champ.cle, champ.libelle, ...champ.alias].map(normaliser);
    const index = entetes.findIndex((entete, i) => !pris.has(i) && candidats.includes(normaliser(entete)));
    if (index >= 0) { correspondance[champ.cle] = index; pris.add(index); }
  }
  return correspondance;
}

/** Convertit un montant écrit à la française (« 1 234,56 $ ») en nombre. */
function montant(valeur) {
  const texte = String(valeur ?? '')
    .replace(/[\s $€]/g, '')
    .replace(/,/g, '.');
  // Une cellule vide rend `null` et non zéro. `Number('')` valant zéro, s'en
  // remettre à lui ferait entrer au catalogue des articles gratuits là où le
  // prix manquait simplement — le genre d'erreur qu'on ne découvre qu'en
  // facturant.
  if (texte === '') return null;

  const n = Number(texte);
  return Number.isFinite(n) ? n : null;
}

/** Valeur d'une colonne pour une ligne, ou chaîne vide si non associée. */
function cellule(ligne, correspondance, cle) {
  const index = correspondance[cle];
  if (index === undefined || index === null) return '';
  return ligne[index] === undefined || ligne[index] === null ? '' : String(ligne[index]).trim();
}

/**
 * Prépare des clients : valide chaque ligne, sépare le bon grain de l'ivraie.
 *
 * La validation passe par `validateClient`, celle des formulaires : un client
 * importé doit respecter exactement les mêmes règles qu'un client saisi à la
 * main, faute de quoi l'import deviendrait une porte dérobée pour des données
 * qu'aucun écran n'accepterait.
 */
function preparerClients(lignes, correspondance) {
  const valides = [];
  const rejets = [];
  const courrielsVus = new Set();

  lignes.forEach((ligne, i) => {
    const numero = i + 2; // ligne 1 = en-têtes, et l'utilisateur compte depuis 1

    const brut = {
      nom_entreprise: cellule(ligne, correspondance, 'nom_entreprise'),
      email: cellule(ligne, correspondance, 'email'),
      nom_contact: cellule(ligne, correspondance, 'nom_contact'),
      adresse: cellule(ligne, correspondance, 'adresse'),
      province: cellule(ligne, correspondance, 'province') || 'QC',
      langue: cellule(ligne, correspondance, 'langue').toLowerCase() || 'fr',
      conditions_paiement: cellule(ligne, correspondance, 'conditions_paiement')
    };

    const resultat = validateClient(brut);
    if (resultat.error) {
      rejets.push({ ligne: numero, valeur: brut.nom_entreprise || brut.email, motif: resultat.error });
      return;
    }

    // Un doublon à l'intérieur du fichier lui-même : fréquent quand deux
    // exports ont été collés bout à bout.
    const cle = resultat.client.email.toLowerCase();
    if (courrielsVus.has(cle)) {
      rejets.push({ ligne: numero, valeur: brut.nom_entreprise, motif: 'Ce courriel apparaît deux fois dans le fichier.' });
      return;
    }
    courrielsVus.add(cle);

    valides.push({ ligne: numero, client: resultat.client });
  });

  return { valides, rejets };
}

/** Prépare des articles de catalogue. */
function preparerCatalogue(lignes, correspondance) {
  const valides = [];
  const rejets = [];

  lignes.forEach((ligne, i) => {
    const numero = i + 2;
    const nom = sanitizeText(cellule(ligne, correspondance, 'nom'), 200);
    const prixBrut = cellule(ligne, correspondance, 'prix_unitaire');
    const prix = montant(prixBrut);

    if (!nom) {
      rejets.push({ ligne: numero, valeur: prixBrut, motif: "Le nom de l'article est requis." });
      return;
    }
    if (prix === null || prix < 0) {
      rejets.push({ ligne: numero, valeur: nom, motif: `Prix illisible ou négatif : « ${prixBrut} ».` });
      return;
    }

    valides.push({
      ligne: numero,
      article: { nom, description: sanitizeText(cellule(ligne, correspondance, 'description'), 500), prix_unitaire: prix }
    });
  });

  return { valides, rejets };
}

const PREPARATEURS = { clients: preparerClients, catalogue: preparerCatalogue };

/** Prépare selon le modèle demandé. */
function preparer(modele, lignes, correspondance) {
  const preparateur = PREPARATEURS[modele];
  if (!preparateur) {
    throw Object.assign(new Error(`Type d'import inconnu : ${modele}.`), { status: 400, expose: true });
  }
  return preparateur(lignes, correspondance);
}

module.exports = {
  analyser,
  analyserCSV,
  detecterSeparateur,
  deviner,
  preparer,
  preparerClients,
  preparerCatalogue,
  montant,
  normaliser,
  MODELES,
  CHAMPS_CLIENT,
  CHAMPS_CATALOGUE,
  MAX_LIGNES
};
