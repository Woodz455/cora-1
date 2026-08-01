/**
 * En-tête de colonne cliquable.
 *
 * Composant à part entière, pour la même raison que `Pagination` : recréé à
 * chaque rendu, React le démonterait au clic et emporterait le focus clavier.
 *
 * @param {string} colonne clé triée
 * @param {{colonne: string|null, sens: string}} tri état courant
 * @param {Function} onTrier
 * @param {import('react').ReactNode} [suffixe] rendu hors du bouton — une bulle
 *   d'aide, par exemple, qui alourdirait le nom annoncé de la colonne
 */
function EnTeteTri({ colonne, tri, onTrier, children, suffixe = null, ...props }) {
  const actif = tri.colonne === colonne;
  const sens = actif ? tri.sens : null;

  return (
    <th
      {...props}
      aria-sort={sens === 'asc' ? 'ascending' : sens === 'desc' ? 'descending' : 'none'}
    >
      <button type="button" className="th-tri" onClick={() => onTrier(colonne)}>
        {children}
        {/* Hors de la colonne triée, la flèche est sortie du flux : gardée dans
            le texte, les sept en-têtes des dépenses coûtaient 52 px et
            faisaient déborder le tableau. */}
        <span className="th-tri-fleche" data-neutre={actif ? undefined : '1'} aria-hidden="true">
          {actif ? (sens === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
      {suffixe}
    </th>
  );
}

export default EnTeteTri;
