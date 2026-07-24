import React, { useState, useEffect } from 'react';
import InvoiceModal from './InvoiceModal';
import InvoicePrintTemplate from './InvoicePrintTemplate';

function DevisList() {
  const [devisList, setDevisList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [devisIdToEdit, setDevisIdToEdit] = useState(null);
  const [printingDevisId, setPrintingDevisId] = useState(null);

  const fetchDevis = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/devis');
      if (!response.ok) throw new Error('Erreur réseau');
      
      const data = await response.json();
      setDevisList(data);
    } catch (err) {
      console.error(err);
      setError('Impossible de charger les devis.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDevis();
  }, []);

  const handleCancelDevis = async (id) => {
    if (window.confirm('Voulez-vous vraiment annuler/refuser ce devis ?')) {
      try {
        const response = await fetch(`/api/devis/${id}/cancel`, { method: 'PUT' });
        if (!response.ok) throw new Error('Erreur réseau');
        fetchDevis();
      } catch (err) {
        alert('Erreur lors de l\'annulation du devis');
      }
    }
  };

  const handleConvert = async (id) => {
    if (window.confirm('Convertir ce devis en facture définitive ?')) {
      try {
        const response = await fetch(`/api/devis/${id}/convert`, { method: 'POST' });
        if (!response.ok) throw new Error('Erreur réseau');
        fetchDevis();
        alert('Devis converti avec succès en facture ! Allez dans l\'onglet Factures pour la voir.');
      } catch (err) {
        alert('Erreur lors de la conversion');
      }
    }
  };

  if (loading) return <p style={{ color: 'var(--text-muted)' }}>Chargement des devis...</p>;
  if (error) return <p style={{ color: 'red' }}>{error}</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '10px' }}>
        <button className="btn-primary" onClick={() => setIsCreateModalOpen(true)}>
          + Nouveau Devis
        </button>
      </div>

      {devisList.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>Aucun devis trouvé.</p>
      ) : (
        devisList.map((devis) => {
          const isTermine = devis.statut === 'Refusé' || devis.statut === 'Converti';
          return (
          <div key={devis.id} className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: isTermine ? 0.6 : 1, filter: devis.statut === 'Refusé' ? 'grayscale(100%)' : 'none' }}>
            
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '10px' }}>
                <h3 style={{ margin: 0, fontSize: '1.3rem', fontWeight: '600', textDecoration: devis.statut === 'Refusé' ? 'line-through' : 'none' }}>{devis.numero_devis}</h3>
                <span className={`status-badge ${devis.statut === 'Converti' ? 'payee' : devis.statut === 'Refusé' ? 'annulee' : 'pending'}`}>
                  {devis.statut}
                </span>
              </div>
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.95rem' }}>
                Client : <strong style={{ color: 'var(--text-main)' }}>{devis.client}</strong> | Émis le {devis.date_emission}
              </p>
            </div>

            <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: '20px' }}>
              <div>
                <p style={{ margin: '0 0 5px 0', fontSize: '0.85rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total estimé</p>
                <p style={{ margin: 0, fontWeight: '700', fontSize: '1.2rem', color: 'var(--text-main)' }}>{devis.montant_total.toFixed(2)} $</p>
              </div>
              
              <button 
                className="btn-secondary" 
                onClick={() => setPrintingDevisId(devis.id)}
                style={{ padding: '8px 12px' }}
              >
                🖨️ PDF
              </button>

              {!isTermine && (
                <button 
                  className="btn-secondary" 
                  onClick={() => setDevisIdToEdit(devis.id)}
                  style={{ padding: '8px 12px' }}
                >
                  ✏️ Modifier
                </button>
              )}

              {!isTermine && (
                <button 
                  className="btn-secondary" 
                  onClick={() => handleCancelDevis(devis.id)}
                  style={{ padding: '8px 12px', color: '#ef4444', borderColor: '#fee2e2', background: '#fef2f2' }}
                >
                  🚫 Refuser
                </button>
              )}

              {!isTermine && (
                <button 
                  className="btn-primary" 
                  onClick={() => handleConvert(devis.id)}
                  style={{ width: '180px' }}
                >
                  ✨ Convertir en Facture
                </button>
              )}
            </div>
          </div>
        )})
      )}

      {(isCreateModalOpen || devisIdToEdit) && (
        <InvoiceModal
          mode="devis"
          factureIdToEdit={devisIdToEdit}
          onClose={() => {
            setIsCreateModalOpen(false);
            setDevisIdToEdit(null);
          }}
          onSuccess={() => {
            setIsCreateModalOpen(false);
            setDevisIdToEdit(null);
            fetchDevis();
          }}
        />
      )}

      {printingDevisId && (
        <InvoicePrintTemplate 
          mode="devis"
          factureId={printingDevisId} 
          onClose={() => setPrintingDevisId(null)} 
        />
      )}
    </div>
  );
}

export default DevisList;
