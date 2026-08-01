import { formatMontant } from '../api';
import { useModale } from '../useModale';

/**
 * Choix de la note de crédit à ouvrir, quand une facture en porte plusieurs.
 *
 * Une facture peut être corrigée en plusieurs fois — un article retourné, puis
 * un geste commercial — et chaque note est une pièce distincte, avec son propre
 * numéro. Il faut donc pouvoir désigner celle que le client réclame.
 */
function NoteCreditChooser({ facture, notes, onChoisir, onClose }) {
  const modaleRef = useModale(onClose);

  return (
    <div ref={modaleRef} className="modal-overlay" role="dialog" aria-modal="true"
      aria-label={`Notes de crédit de la facture ${facture.numero_facture}`}>
      <div className="modal-content glass-panel" style={{ maxWidth: '520px' }}>
        <h3 style={{ marginTop: 0 }}>Notes de crédit — {facture.numero_facture}</h3>
        <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
          {notes.length} notes ont été émises sur cette facture. Laquelle voulez-vous ouvrir ?
        </p>

        <ul style={{ listStyle: 'none', padding: 0, margin: '20px 0 0 0', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {notes.map((note) => (
            <li key={note.id}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => onChoisir(note)}
                style={{ width: '100%', display: 'flex', justifyContent: 'space-between', gap: '15px' }}
              >
                <span>{note.numero_note}</span>
                <span style={{ color: 'var(--text-muted)' }}>{note.date_emission}</span>
                <span className="numeric">{formatMontant(note.montant_total, facture.devise)}</span>
              </button>
            </li>
          ))}
        </ul>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px' }}>
          <button type="button" className="btn-secondary" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}

export default NoteCreditChooser;
