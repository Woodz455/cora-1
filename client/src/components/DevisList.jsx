import { useState, useMemo } from 'react';
import InvoiceModal from './InvoiceModal';
import InvoicePrintTemplate from './InvoicePrintTemplate';
import { api, formatMontant } from '../api';
import { useApiResource } from '../useApiResource';
import { useUser } from '../UserContext';
import { usePagination } from '../usePagination';
import Pagination from './Pagination';

function DevisList() {
  const user = useUser();
  const peutConvertir = user?.role === 'admin' || user?.role === 'comptable';

  const { data: devisList, loading, error, setError, refresh: fetchDevis } = useApiResource('/api/devis', []);
  const [message, setMessage] = useState(null);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [devisIdToEdit, setDevisIdToEdit] = useState(null);
  const [printingDevisId, setPrintingDevisId] = useState(null);
  const [recherche, setRecherche] = useState('');

  const devisFiltres = useMemo(() => {
    const terme = recherche.trim().toLowerCase();
    if (!terme) return devisList;
    return devisList.filter((d) => (d.numero_devis || '').toLowerCase().includes(terme)
      || (d.client || '').toLowerCase().includes(terme));
  }, [devisList, recherche]);

  const { affiches: devisAffiches, pagination } = usePagination(devisFiltres, 12);

  const handleCancelDevis = async (devis) => {
    if (!window.confirm(`Marquer le devis ${devis.numero_devis} comme refusé ?`)) return;
    try {
      setError(null);
      await api.put(`/api/devis/${devis.id}/cancel`);
      fetchDevis();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleConvert = async (devis) => {
    if (!window.confirm(`Convertir le devis ${devis.numero_devis} en facture définitive ?`)) return;
    try {
      setError(null);
      const facture = await api.post(`/api/devis/${devis.id}/convert`);
      // Le numéro réellement attribué est affiché : la conversion échouait
      // silencieusement avant, en laissant une facture orpheline en base.
      setMessage(`Devis converti en facture ${facture.numero_facture}. Retrouvez-la dans l'onglet Factures.`);
      fetchDevis();
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <p style={{ color: 'var(--text-muted)' }}>Chargement des devis…</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      {message && <p className="alert alert-success" role="status">{message}</p>}

      <div className="toolbar">
        <input
          type="search"
          className="search-input"
          placeholder="Rechercher un numéro ou un client…"
          aria-label="Rechercher un devis"
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
        />
        <button type="button" className="btn-primary" onClick={() => setIsCreateModalOpen(true)}>
          + Nouveau devis
        </button>
      </div>

      {devisFiltres.length === 0 ? (
        <div className="glass-panel empty-state">
          {devisList.length === 0 ? 'Aucun devis pour le moment.' : 'Aucun devis ne correspond à votre recherche.'}
        </div>
      ) : (
        devisAffiches.map((devis) => {
          const estTermine = devis.statut === 'Refusé' || devis.statut === 'Converti';
          const classeStatut = devis.statut === 'Converti' ? 'payee'
            : devis.statut === 'Refusé' ? 'annulee' : 'pending';

          return (
            <div
              key={devis.id}
              className="glass-card"
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                gap: '20px', flexWrap: 'wrap',
                opacity: estTermine ? 0.7 : 1,
                filter: devis.statut === 'Refusé' ? 'grayscale(100%)' : 'none'
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '10px' }}>
                  <h3 style={{ margin: 0, fontSize: '1.3rem', fontWeight: '600', textDecoration: devis.statut === 'Refusé' ? 'line-through' : 'none' }}>
                    {devis.numero_devis}
                  </h3>
                  <span className={`status-badge ${classeStatut}`}>{devis.statut}</span>
                </div>
                <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.95rem' }}>
                  Client : <strong style={{ color: 'var(--text-main)' }}>{devis.client}</strong>
                  {' '}| Émis le {devis.date_emission} | Valide jusqu'au {devis.date_validite}
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <div className="numeric">
                  <p style={{ margin: '0 0 5px 0', fontSize: '0.85rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total estimé</p>
                  <p style={{ margin: 0, fontWeight: '700', fontSize: '1.2rem', color: 'var(--text-main)' }}>
                    {formatMontant(devis.montant_total, devis.devise)}
                  </p>
                </div>

                <button type="button" className="btn-icon" onClick={() => setPrintingDevisId(devis.id)}>🖨️ PDF</button>

                {!estTermine && (
                  <button type="button" className="btn-icon" onClick={() => setDevisIdToEdit(devis.id)}>✏️ Modifier</button>
                )}

                {!estTermine && (
                  <button type="button" className="btn-danger" onClick={() => handleCancelDevis(devis)}>🚫 Refuser</button>
                )}

                {!estTermine && peutConvertir && (
                  <button type="button" className="btn-primary" onClick={() => handleConvert(devis)} style={{ width: '190px' }}>
                    ✨ Convertir en facture
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}

      <Pagination {...pagination} />

      {(isCreateModalOpen || devisIdToEdit) && (
        <InvoiceModal
          mode="devis"
          factureIdToEdit={devisIdToEdit}
          onClose={() => { setIsCreateModalOpen(false); setDevisIdToEdit(null); }}
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
