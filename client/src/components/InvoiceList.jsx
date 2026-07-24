import React, { useState, useEffect } from 'react';
import PaymentModal from './PaymentModal';
import InvoiceModal from './InvoiceModal';
import InvoicePrintTemplate from './InvoicePrintTemplate';

function InvoiceList() {
  const [factures, setFactures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // État pour gérer l'ouverture de la modale de paiement
  const [selectedFacture, setSelectedFacture] = useState(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [printingFactureId, setPrintingFactureId] = useState(null);
  const [isRelance, setIsRelance] = useState(false);

  const [factureIdToEdit, setFactureIdToEdit] = useState(null);

  // Fonction pour charger les factures depuis l'API
  const fetchFactures = async () => {
    try {
      setLoading(true);
      // L'appel utilise le proxy défini dans vite.config.js (redirige vers localhost:3000)
      const response = await fetch('/api/factures');
      if (!response.ok) throw new Error('Erreur réseau');
      
      const data = await response.json();
      setFactures(data);
    } catch (err) {
      console.error(err);
      setError('Impossible de charger les factures.');
    } finally {
      setLoading(false);
    }
  };

  // Chargement initial au montage du composant
  useEffect(() => {
    fetchFactures();
  }, []);

  // Ouvre la modale pour une facture spécifique
  const openPaymentModal = (facture) => {
    setSelectedFacture(facture);
  };

  const handleCancelFacture = async (id) => {
    if (window.confirm('Voulez-vous vraiment annuler cette facture ?')) {
      try {
        const response = await fetch(`/api/factures/${id}/cancel`, { method: 'PUT' });
        if (!response.ok) throw new Error('Erreur réseau');
        fetchFactures();
      } catch (err) {
        alert('Erreur lors de l\'annulation de la facture');
      }
    }
  };

  const handleDeleteFacture = async (id) => {
    if (window.confirm('⚠️ ATTENTION: Voulez-vous vraiment SUPPRIMER cette facture définitivement ? Cette action est irréversible.')) {
      try {
        const response = await fetch(`/api/factures/${id}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Erreur réseau');
        fetchFactures();
      } catch (err) {
        alert('Erreur lors de la suppression de la facture');
      }
    }
  };

  // Ferme la modale et rafraîchit la liste pour voir le nouveau solde/statut
  const closeAndRefresh = () => {
    setSelectedFacture(null);
    fetchFactures();
  };

  if (loading) return <p style={{ color: 'var(--text-muted)' }}>Chargement des données financières...</p>;
  if (error) return <p style={{ color: 'red' }}>{error}</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '10px' }}>
        <button className="btn-primary" onClick={() => setIsCreateModalOpen(true)}>
          + Nouvelle Facture
        </button>
      </div>

      {factures.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>Aucune facture trouvée.</p>
      ) : (
        factures.map((facture) => {
          const isAnnulee = facture.statut === 'Annulée';
          return (
          <div key={facture.id} className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: isAnnulee ? 0.6 : 1, filter: isAnnulee ? 'grayscale(100%)' : 'none' }}>
            
            {/* Colonne 1 : Informations de base de la facture */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '10px' }}>
                <h3 style={{ margin: 0, fontSize: '1.3rem', fontWeight: '600', textDecoration: isAnnulee ? 'line-through' : 'none' }}>{facture.numero_facture}</h3>
                {/* Badge dynamique pour le statut */}
                <span className={`status-badge ${facture.statut === 'Payée' ? 'payee' : facture.statut === 'Partiellement payée' ? 'partielle' : facture.statut === 'Annulée' ? 'annulee' : 'pending'}`}>
                  {facture.statut}
                </span>
              </div>
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.95rem' }}>
                Client : <strong style={{ color: 'var(--text-main)' }}>{facture.client}</strong> | Émise le {facture.date_emission}
              </p>
            </div>

            {/* Colonne 2 : Détails financiers et actions */}
            <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: '40px' }}>
              <div>
                <p style={{ margin: '0 0 5px 0', fontSize: '0.85rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total</p>
                <p style={{ margin: 0, fontWeight: '600', fontSize: '1.1rem' }}>{facture.montant_total.toFixed(2)} $</p>
              </div>
              <div>
                <p style={{ margin: '0 0 5px 0', fontSize: '0.85rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Reste à payer</p>
                <p style={{ margin: 0, fontWeight: '700', fontSize: '1.4rem', color: facture.solde_restant > 0 ? 'var(--status-partial)' : 'var(--status-paid)' }}>
                  {facture.solde_restant.toFixed(2)} $
                </p>
              </div>
              
              <button 
                className="btn-secondary" 
                onClick={() => { setPrintingFactureId(facture.id); setIsRelance(false); }}
                style={{ padding: '8px 12px' }}
              >
                🖨️ PDF
              </button>

              {!isAnnulee && facture.solde_restant > 0 && (
                <button 
                  className="btn-secondary" 
                  onClick={() => { setPrintingFactureId(facture.id); setIsRelance(true); }}
                  style={{ padding: '8px 12px', color: '#ea580c', borderColor: '#fdba74', background: '#fff7ed' }}
                  title={facture.relances_envoyees > 0 ? `Déjà relancé ${facture.relances_envoyees} fois (Dernière: ${facture.date_derniere_relance})` : "Envoyer un rappel de paiement"}
                >
                  🔔 Relancer {facture.relances_envoyees > 0 && `(${facture.relances_envoyees})`}
                </button>
              )}

              {!isAnnulee && facture.statut === 'En attente' && (
                <button 
                  className="btn-secondary" 
                  onClick={() => setFactureIdToEdit(facture.id)}
                  style={{ padding: '8px 12px' }}
                >
                  ✏️ Modifier
                </button>
              )}

              {!isAnnulee && facture.statut === 'En attente' && (
                <button 
                  className="btn-secondary" 
                  onClick={() => handleCancelFacture(facture.id)}
                  style={{ padding: '8px 12px', color: '#ef4444', borderColor: '#fee2e2', background: '#fef2f2' }}
                >
                  🚫 Annuler
                </button>
              )}

              <button 
                className="btn-secondary" 
                onClick={() => handleDeleteFacture(facture.id)}
                style={{ padding: '8px 12px', color: '#dc2626', borderColor: '#fca5a5', background: '#fef2f2' }}
                title="Supprimer définitivement"
              >
                🗑️ Supprimer
              </button>

              {/* Bouton pour ajouter un paiement (désactivé visuellement et techniquement si déjà payé ou annulé) */}
              <button 
                className="btn-primary" 
                onClick={() => openPaymentModal(facture)}
                disabled={facture.solde_restant <= 0 || isAnnulee}
                style={{ 
                  opacity: (facture.solde_restant <= 0 || isAnnulee) ? 0.4 : 1, 
                  cursor: (facture.solde_restant <= 0 || isAnnulee) ? 'not-allowed' : 'pointer',
                  width: '180px'
                }}
              >
                {facture.solde_restant <= 0 ? '✓ Facture soldée' : '+ Ajouter paiement'}
              </button>
            </div>
          </div>
        )}
        )
      )}

      {/* Affichage conditionnel de la modale */}
      {selectedFacture && (
        <PaymentModal 
          facture={selectedFacture} 
          onClose={closeAndRefresh} 
        />
      )}

      {(isCreateModalOpen || factureIdToEdit) && (
        <InvoiceModal
          factureIdToEdit={factureIdToEdit}
          onClose={() => {
            setIsCreateModalOpen(false);
            setFactureIdToEdit(null);
          }}
          onSuccess={() => {
            setIsCreateModalOpen(false);
            setFactureIdToEdit(null);
            fetchFactures();
          }}
        />
      )}

      {printingFactureId && (
        <InvoicePrintTemplate 
          factureId={printingFactureId} 
          isRelance={isRelance}
          onClose={() => {
            setPrintingFactureId(null);
            setIsRelance(false);
            if (isRelance) fetchFactures(); // Refresh relance count
          }} 
        />
      )}
    </div>
  );
}

export default InvoiceList;
