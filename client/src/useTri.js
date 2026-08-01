import { useState, useMemo } from 'react';

/** Aucune colonne ne demande de calcul : on lit le champ du même nom. */
const SANS_ACCESSEUR = {};

/**
 * Compare deux valeurs sans supposer leur type.
 *
 * Les dates sont stockées en ISO (`2026-06-01`) : l'ordre alphabétique est déjà
 * l'ordre chronologique. Les montants arrivent en nombre. Le reste est du texte,
 * comparé selon les règles du français — sinon « Éclairage » passerait après
 * « Zinc ». Les valeurs manquantes finissent en bas, quel que soit le sens.
 */
function comparer(a, b) {
  const aVide = a === null || a === undefined || a === '';
  const bVide = b === null || b === undefined || b === '';
  if (aVide && bVide) return 0;
  if (aVide) return 1;
  if (bVide) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'fr-CA', { numeric: true, sensitivity: 'base' });
}

/**
 * Trie une liste selon la colonne choisie par l'utilisateur.
 *
 * @param {Array} elements liste complète, déjà filtrée
 * @param {{defaut?: string|null, sens?: string, accesseurs?: Object}} [options]
 *   `accesseurs` doit être défini hors du composant : une nouvelle référence à
 *   chaque rendu relancerait le tri sans raison.
 * @returns {{tri: {colonne: string|null, sens: string}, basculer: Function, tries: Array}}
 */
export function useTri(elements, { defaut = null, sens = 'asc', accesseurs = SANS_ACCESSEUR } = {}) {
  const [tri, setTri] = useState({ colonne: defaut, sens });

  const tries = useMemo(() => {
    if (!tri.colonne) return elements;
    const lire = accesseurs[tri.colonne] || ((element) => element[tri.colonne]);
    const signe = tri.sens === 'asc' ? 1 : -1;
    // slice() : la liste d'origine sert ailleurs (totaux, compteurs) et ne doit
    // pas être réordonnée sur place.
    return elements.slice().sort((a, b) => signe * comparer(lire(a), lire(b)));
  }, [elements, tri, accesseurs]);

  /** Un clic sur la colonne déjà triée inverse le sens. */
  const basculer = (colonne) => setTri((prec) => (prec.colonne === colonne
    ? { colonne, sens: prec.sens === 'asc' ? 'desc' : 'asc' }
    : { colonne, sens: 'asc' }));

  return { tri, basculer, tries };
}
