/**
 * Les deux boutons de navigation entre les pages d'une liste.
 *
 * Composant à part entière, et non une fonction renvoyée par `usePagination` :
 * une fonction recréée à chaque rendu est un type de composant différent pour
 * React, qui démonterait les boutons au clic — le focus clavier partirait avec
 * eux, juste après avoir tourné la page.
 *
 * @param {number} page page courante, à partir de 1
 * @param {number} nbPages
 * @param {Function} onChange
 */
function Pagination({ page, nbPages, onChange }) {
  /** Rien n'est rendu tant qu'une seule page suffit. */
  if (nbPages <= 1) return null;

  return (
    <div className="pagination">
      <button
        type="button" className="btn-secondary"
        disabled={page === 1}
        onClick={() => onChange(page - 1)}
      >
        Précédent
      </button>
      <span>Page {page} sur {nbPages}</span>
      <button
        type="button" className="btn-secondary"
        disabled={page === nbPages}
        onClick={() => onChange(page + 1)}
      >
        Suivant
      </button>
    </div>
  );
}

export default Pagination;
