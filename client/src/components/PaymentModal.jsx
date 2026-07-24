import React, { useState } from 'react';

function PaymentModal({ facture, onClose }) {
  // Pré-remplit le montant avec le solde exact restant pour faciliter la saisie
  const [montant, setMontant] = useState(facture.solde_restant);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Appel POST vers l'API backend via le proxy Vite
      const response = await fetch(`/api/factures/${facture.id}/paiements`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          montant: parseFloat(montant),
          note: note,
          date_paiement: new Date().toISOString().split('T')[0] // Date du jour
        }),
      });

      if (!response.ok) {
        throw new Error("Erreur lors de l'ajout du paiement. Veuillez réessayer.");
      }

      // Paiement réussi, on ferme la modale (le parent InvoiceList va rafraîchir les données)
      onClose();
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content glass-panel">
        <h3 style={{ marginTop: 0, marginBottom: '25px', fontSize: '1.6rem', color: 'var(--text-main)', fontWeight: '700' }}>
          Saisir un paiement
        </h3>
        
        {/* Résumé de la facture */}
        <div style={{ marginBottom: '25px', padding: '15px 20px', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ color: 'var(--text-muted)' }}>Facture N°</span>
            <strong style={{ color: 'var(--text-main)' }}>{facture.numero_facture}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ color: 'var(--text-muted)' }}>Client</span>
            <strong style={{ color: 'var(--text-main)' }}>{facture.client}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '15px', paddingTop: '15px', borderTop: '1px dashed rgba(0,0,0,0.1)' }}>
            <span style={{ color: 'var(--text-main)', fontWeight: '600' }}>Solde actuel</span>
            <strong className="gradient-text" style={{ fontSize: '1.4rem' }}>{facture.solde_restant.toFixed(2)} $</strong>
          </div>
        </div>

        {error && <p style={{ color: '#ef4444', marginBottom: '15px', fontSize: '0.9rem', padding: '10px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '8px' }}>{error}</p>}

        {/* Formulaire de saisie */}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Montant du paiement ($)</label>
            <input 
              type="number" 
              step="0.01"
              min="0.01"
              max={facture.solde_restant} // Empêche de payer plus que le solde
              className="form-control" 
              value={montant} 
              onChange={(e) => setMontant(e.target.value)} 
              required 
            />
          </div>
          
          <div className="form-group">
            <label>Note (optionnel)</label>
            <input 
              type="text" 
              className="form-control" 
              placeholder="Ex: Virement bancaire, Chèque N°123..."
              value={note} 
              onChange={(e) => setNote(e.target.value)} 
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '35px' }}>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
              Annuler
            </button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Enregistrement...' : 'Confirmer le paiement'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default PaymentModal;
