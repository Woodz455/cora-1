/**
 * Libellés de périodes, partagés par l'écran Rapports et le compte rendu.
 *
 * Toutes ces fonctions travaillent sur des chaînes AAAA-MM-JJ ou AAAA-MM
 * découpées à la main : passer par `Date` ferait glisser la borne d'un jour
 * selon le fuseau du poste.
 *
 * Le dernier paramètre est la langue de l'utilisateur ; le français par défaut.
 */

export const MOIS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'
];

/** L'anglais écrit ses mois avec une majuscule, partout. */
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const majuscule = (mot) => `${mot.charAt(0).toUpperCase()}${mot.slice(1)}`;

/** Nom du mois (1 à 12), avec sa majuscule en tête de libellé. */
export function nomDuMois(numero, langue = 'fr', enTete = false) {
  if (langue === 'en') return MONTHS[numero - 1];
  return enTete ? majuscule(MOIS[numero - 1]) : MOIS[numero - 1];
}

/**
 * « Septembre 2026 », « Trimestre 3 de 2026 (juillet à septembre) » ou
 * « Année 2026 » ; en anglais « September 2026 », « Q3 2026 (July to
 * September) » ou « Year 2026 ».
 */
export function libellePeriode({ annee, mois, trimestre }, langue = 'fr') {
  if (mois) return `${nomDuMois(Number(mois), langue, true)} ${annee}`;
  if (trimestre) {
    const premier = (Number(trimestre) - 1) * 3 + 1;
    if (langue === 'en') {
      return `Q${trimestre} ${annee} (${MONTHS[premier - 1]} to ${MONTHS[premier + 1]})`;
    }
    return `Trimestre ${trimestre} de ${annee} (${MOIS[premier - 1]} à ${MOIS[premier + 1]})`;
  }
  return langue === 'en' ? `Year ${annee}` : `Année ${annee}`;
}

/** « 1 septembre 2026 », ou « September 1, 2026 », à partir d'une date AAAA-MM-JJ. */
export function dateLongue(iso, langue = 'fr') {
  const [a, m, j] = iso.split('-').map(Number);
  if (langue === 'en') return `${MONTHS[m - 1]} ${j}, ${a}`;
  return `${j} ${MOIS[m - 1]} ${a}`;
}

/** « Septembre 2026 », ou « September 2026 », à partir d'un mois AAAA-MM. */
export function moisLong(aaaaMm, langue = 'fr') {
  const [a, m] = aaaaMm.split('-').map(Number);
  return `${nomDuMois(m, langue, true)} ${a}`;
}

/** Suffixe de nom de fichier : « 2026-09 », « 2026-T3 » (« 2026-Q3 ») ou « 2026 ». */
export function suffixePeriode({ annee, mois, trimestre }, langue = 'fr') {
  if (mois) return `${annee}-${String(mois).padStart(2, '0')}`;
  if (trimestre) return `${annee}-${langue === 'en' ? 'Q' : 'T'}${trimestre}`;
  return String(annee);
}
