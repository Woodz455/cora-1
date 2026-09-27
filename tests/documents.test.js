/**
 * Les documents remis au client, dans sa langue.
 *
 * Une facture destinée à un client anglophone portait trois traces du
 * français : le nom de la taxe (« TVH (13%) » au lieu de « HST »), l'espace
 * française devant le deux-points (« Issue Date : ») et le signe « N° ». Les
 * mêmes se retrouvaient dans l'objet du courriel, sa ligne de paiement, le pied
 * de page et les notes de crédit, et le PDF joint s'appelait « Facture_… ».
 *
 * Le gabarit est un composant React, que ces tests ne savent pas afficher sans
 * les dépendances de l'interface. Ses deux fonctions pures en sont donc
 * extraites pour être exécutées, et le reste du gabarit est relu pour qu'aucun
 * libellé n'y soit plus écrit en dur.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const GABARIT = fs.readFileSync(
  path.join(__dirname, '..', 'client', 'src', 'components', 'InvoicePrintTemplate.jsx'), 'utf8'
);

/** Extrait du gabarit le texte qui va de `debut` à l'accolade fermante en colonne 0. */
function extraire(debut) {
  const i = GABARIT.indexOf(debut);
  assert.ok(i >= 0, `introuvable dans le gabarit : ${debut}`);
  return GABARIT.slice(i, GABARIT.indexOf('\n}\n', i) + 2);
}

const nomTaxe = new Function(
  `${extraire('const TAXES_EN')}\n${extraire('function nomTaxe')}\nreturn nomTaxe;`
)();
const construireDictionnaire = new Function(
  `${extraire('function construireDictionnaire')}\nreturn construireDictionnaire;`
)();

test('les taxes portent leur nom anglais sur un document anglais', () => {
  assert.equal(nomTaxe('TPS', true), 'GST');
  assert.equal(nomTaxe('TVQ', true), 'QST');
  assert.equal(nomTaxe('TVH', true), 'HST');
  assert.equal(nomTaxe('TVP', true), 'PST');
  assert.equal(nomTaxe(' tvh ', true), 'HST', 'saisie libre dans les paramètres');

  // Un nom choisi par l'entreprise, que la table ne connaît pas, reste le sien.
  assert.equal(nomTaxe('Écotaxe', true), 'Écotaxe');
  assert.equal(nomTaxe('', true), '');
  assert.equal(nomTaxe(null, true), '');

  // Et rien ne change en français.
  assert.equal(nomTaxe('TVH', false), 'TVH');
  assert.equal(nomTaxe('TPS', false), 'TPS');
});

test('le deux-points et le numéro suivent la langue', () => {
  const en = construireDictionnaire(true, 'Plomberie Rivard');
  const fr = construireDictionnaire(false, 'Plomberie Rivard');

  assert.equal(`${en.dateEmission}${en.deuxPoints} 2026-07-15`, 'Issue Date: 2026-07-15');
  assert.equal(`${fr.dateEmission}${fr.deuxPoints} 2026-07-15`, "Date d'émission : 2026-07-15");

  assert.equal(`${en.numero} SHT-202607-0001`, 'No. SHT-202607-0001');
  assert.equal(`${fr.numero} SHT-202607-0001`, 'N° SHT-202607-0001');
  assert.equal(`${en.emailSubjFact} ${en.numeroDansPhrase} SHT-1`, 'Invoice No. SHT-1');
  assert.equal(`${fr.emailSubjFact} ${fr.numeroDansPhrase} SHT-1`, 'Facture n° SHT-1');

  assert.equal(en.taxe1, 'Tax 1');
  assert.equal(fr.taxe1, 'Taxe 1');

  // Aucun libellé anglais ne garde une espace devant le deux-points.
  const fautifs = Object.entries(en).filter(([, v]) => typeof v === 'string' && / :/.test(v));
  assert.deepEqual(fautifs, [], 'un libellé anglais porte une espace française devant « : »');
});

test('le gabarit ne réécrit aucun libellé en dur', () => {
  // Tout ce qui suit le dictionnaire : le composant et son rendu.
  const rendu = GABARIT.slice(GABARIT.indexOf('function InvoicePrintTemplate'));
  // Les commentaires peuvent parler de « n° » ; seul le code compte.
  const code = rendu
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  assert.doesNotMatch(code, /[nN]°/, 'le signe du numéro doit venir du dictionnaire');
  assert.doesNotMatch(code, /'Taxe [12]'/, 'le nom de repli des taxes doit venir du dictionnaire');
  // Un deux-points écrit après une expression, dans le texte du document ou
  // dans un gabarit de chaîne : « {dict.dateEmission} : », « ${…} : ».
  assert.doesNotMatch(code, /\}\s:\s(?:\{(?:dict|details|settings|client|estDevis|numero)\b|<)/,
    'un deux-points est écrit en dur dans le document');
  assert.doesNotMatch(code, /\} :(?:\\n| \$)/, 'un deux-points est écrit en dur dans un texte composé');
  // Les noms de taxes passent par leur traduction.
  assert.doesNotMatch(code, /\{details\.taxe_[12]_nom\b/, 'un nom de taxe est affiché sans traduction');
  assert.doesNotMatch(code, /\$\{settings\.taxe_[12]_nom\}/, 'un nom de taxe est affiché sans traduction');
});

test('les instructions de paiement suivent la langue du client', () => {
  // Un seul texte, écrit en français par l'entreprise, s'imprimait sur les
  // factures anglaises. La version anglaise est facultative : vide, c'est le
  // texte français qui s'imprime, plutôt que rien.
  assert.match(GABARIT,
    /const instructions = \(isEn && settings\.payment_instructions_en\) \|\| settings\.payment_instructions;/,
    'le texte anglais pour un client anglophone, le français à défaut');

  const rendu = GABARIT.slice(GABARIT.indexOf('function InvoicePrintTemplate'));
  assert.doesNotMatch(rendu, /\{settings\.payment_instructions\}/,
    'le document affiche les instructions choisies selon la langue, pas le texte français seul');
});
