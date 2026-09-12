/**
 * Libellés de périodes, partagés par l'écran Rapports et le compte rendu.
 *
 * Toutes ces fonctions travaillent sur des chaînes AAAA-MM-JJ ou AAAA-MM
 * découpées à la main : passer par `Date` ferait glisser la borne d'un jour
 * selon le fuseau du poste.
 */

export const MOIS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'
];

const majuscule = (mot) => `${mot.charAt(0).toUpperCase()}${mot.slice(1)}`;

/** « Septembre 2026 », « Trimestre 3 de 2026 (juillet à septembre) » ou « Année 2026 ». */
export function libellePeriode({ annee, mois, trimestre }) {
  if (mois) return `${majuscule(MOIS[Number(mois) - 1])} ${annee}`;
  if (trimestre) {
    const premier = (Number(trimestre) - 1) * 3;
    return `Trimestre ${trimestre} de ${annee} (${MOIS[premier]} à ${MOIS[premier + 2]})`;
  }
  return `Année ${annee}`;
}

/** « 1 septembre 2026 » à partir d'une date AAAA-MM-JJ. */
export function dateLongue(iso) {
  const [a, m, j] = iso.split('-').map(Number);
  return `${j} ${MOIS[m - 1]} ${a}`;
}

/** « Septembre 2026 » à partir d'un mois AAAA-MM. */
export function moisLong(aaaaMm) {
  const [a, m] = aaaaMm.split('-').map(Number);
  return `${majuscule(MOIS[m - 1])} ${a}`;
}

/** Suffixe de nom de fichier : « 2026-09 », « 2026-T3 » ou « 2026 ». */
export function suffixePeriode({ annee, mois, trimestre }) {
  if (mois) return `${annee}-${String(mois).padStart(2, '0')}`;
  if (trimestre) return `${annee}-T${trimestre}`;
  return String(annee);
}
