import { useState } from 'react';
import { api, formatMontant } from '../api';

function PaymentModal({ facture, onClose }) {
  // Le solde exact est pré-rempli pour faciliter le règlement complet.
  const [montant, setMontant] = useState(facture.solde_restant);
  const [note, setNote] = useState('');
  const [datePaiement, setDatePaiement] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await api.post(`/api/factures/${facture.id}/paiements`, {
        montant: parseFloat(montant),
        note,
        date_paiement: datePaiement
      });
      onClose();
    } catch (err) {
      // Le serveur refuse notamment un montant supérieur au solde ; son message
      // est plus utile que « Erreur lors de l'ajout du paiement ».
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Saisir un paiement">
      <div className="modal-content glass-panel">
        <h3 style={{ marginTop: 0, marginBottom: '25px', fontSize: '1.6rem', color: 'var(--text-main)', fontWeight: '700' }}>
          Saisir un paiement
        </h3>

        <div style={{ marginBottom: '25px', padding: '15px 20px', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ color: 'var(--text-muted)' }}>Facture n°</span>
            <strong style={{ color: 'var(--text-main)' }}>{facture.numero_facture}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ color: 'var(--text-muted)' }}>Client</span>
            <strong style={{ color: 'var(--text-main)' }}>{facture.client}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '15px', paddingTop: '15px', borderTop: '1px dashed var(--border-color)' }}>
            <span style={{ color: 'var(--text-main)', fontWeight: '600' }}>Solde actuel</span>
            <strong className="gradient-text" style={{ fontSize: '1.4rem' }}>
              {formatMontant(facture.solde_restant, facture.devise)}
            </strong>
          </div>
        </div>

        {error && <p className="alert alert-error" role="alert">{error}</p>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="paiement-montant">
              Montant du paiement ({facture.devise === 'USD' ? 'US$' : '$'})
            </label>
            <input
              id="paiement-montant"
              type="number"
              step="0.01"
              min="0.01"
              max={facture.solde_restant}
              className="form-control"
              value={montant}
              onChange={(e) => setMontant(e.target.value)}
              required
              autoFocus
            />
            {facture.devise !== 'CAD' && (
              <p style={{ margin: '6px 0 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Le montant s'exprime dans la devise de la facture ({facture.devise}).
              </p>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="paiement-date">Date du paiement</label>
            <input
              id="paiement-date"
              type="date"
              className="form-control"
              value={datePaiement}
              onChange={(e) => setDatePaiement(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="paiement-note">Note (facultatif)</label>
            <input
              id="paiement-note"
              type="text"
              className="form-control"
              placeholder="Ex. : virement Interac, chèque n° 123…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '35px' }}>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>Annuler</button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Enregistrement…' : 'Confirmer le paiement'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default PaymentModal;
