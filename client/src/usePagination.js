import { useState, useMemo } from 'react';

/**
 * Découpe une liste en pages.
 *
 * Le même bloc — calcul du nombre de pages, bornage de la page courante,
 * découpage, et les deux boutons — était écrit deux fois, sur les factures et
 * les clients. Les quatre autres écrans de liste s'en passaient : devis,
 * catalogue, dépenses et abonnements affichaient tout, jusqu'à la dernière
 * ligne.
 *
 * @param {Array} elements liste complète, déjà filtrée et triée
 * @param {number} [parPage]
 * @returns {{affiches: Array, page: number, nbPages: number, setPage: Function, pagination: Object}}
 *   `pagination` s'étale directement sur `<Pagination />`.
 */
export function usePagination(elements, parPage = 15) {
  const [page, setPage] = useState(1);

  const { nbPages, pageCourante, affiches } = useMemo(() => {
    const total = Math.max(1, Math.ceil(elements.length / parPage));
    // Filtrer peut réduire la liste sous la page affichée : on la ramène dans
    // les bornes plutôt que de montrer un écran vide.
    const courante = Math.min(page, total);
    return {
      nbPages: total,
      pageCourante: courante,
      affiches: elements.slice((courante - 1) * parPage, courante * parPage)
    };
  }, [elements, page, parPage]);

  return {
    affiches,
    page: pageCourante,
    nbPages,
    setPage,
    pagination: { page: pageCourante, nbPages, onChange: setPage }
  };
}
