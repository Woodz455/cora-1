import { useState, useMemo } from 'react';
import { Printer, Pencil, Ban, Receipt } from 'lucide-react';
import InvoiceModal from './InvoiceModal';
import InvoicePrintTemplate from './InvoicePrintTemplate';
import { api } from '../api';
import { useApiResource } from '../useApiResource';
import { useUser } from '../UserContext';
import { usePagination } from '../usePagination';
import Pagination from './Pagination';
import { useFeedback } from '../FeedbackContext';
import { useLangue } from '../i18n.js';

function DevisList() {
  const user = useUser();
  const peutConvertir = user?.role === 'admin' || user?.role === 'comptable';

  const { notifier, confirmer } = useFeedback();
  const { t, montant } = useLangue();

  const { data: devisList, loading, error, setError, refresh: fetchDevis } = useApiResource('/api/devis', []);

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
    const accepte = await confirmer({
      titre: t('Marquer le devis {numero} comme refusé ?', { numero: devis.numero_devis }),
      message: t('Le devis reste consultable, mais ne pourra plus être modifié ni converti en facture.'),
      libelleConfirmer: t('Marquer refusé'),
      libelleAnnuler: t('Ne rien faire'),
      danger: true
    });
    if (!accepte) return;
    try {
      setError(null);
      await api.put(`/api/devis/${devis.id}/cancel`);
      notifier(t('Devis {numero} marqué refusé.', { numero: devis.numero_devis }));
      fetchDevis();
    } catch (err) {
      notifier(err.message, 'erreur');
    }
  };

  const handleConvert = async (devis) => {
    const accepte = await confirmer({
      titre: t('Convertir le devis {numero} en facture ?', { numero: devis.numero_devis }),
      message: t('Une facture définitive sera émise avec un nouveau numéro, et le devis passera au statut « Converti ».'),
      libelleConfirmer: t('Convertir')
    });
    if (!accepte) return;
    try {
      setError(null);
      const facture = await api.post(`/api/devis/${devis.id}/convert`);
      // Le numéro réellement attribué est affiché : la conversion échouait
      // silencieusement avant, en laissant une facture orpheline en base.
      notifier(t("Devis converti en facture {numero}. Retrouvez-la dans l'onglet Factures.", { numero: facture.numero_facture }));
      fetchDevis();
    } catch (err) {
      notifier(err.message, 'erreur');
    }
  };

  if (loading) return <p style={{ color: 'var(--text-muted)' }}>{t('Chargement des devis…')}</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {error && <p className="alert alert-error" role="alert">{error}</p>}

      <div className="toolbar">
        <input
          type="search"
          className="search-input"
          style={{ width: '20em' }}
          placeholder={t('Rechercher un numéro ou un client…')}
          aria-label={t('Rechercher un devis')}
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
        />
        <button type="button" className="btn-primary" onClick={() => setIsCreateModalOpen(true)}>
          {t('+ Nouveau devis')}
        </button>
      </div>

      {devisFiltres.length === 0 ? (
        <div className="glass-panel empty-state">
          {devisList.length === 0 ? t('Aucun devis pour le moment.') : t('Aucun devis ne correspond à votre recherche.')}
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '8px' }}>
                  <h3 style={{ margin: 0, fontSize: '1.3rem', fontWeight: '600', textDecoration: devis.statut === 'Refusé' ? 'line-through' : 'none' }}>
                    {devis.numero_devis}
                  </h3>
                  <span className={`status-badge ${classeStatut}`}>{t(devis.statut)}</span>
                </div>
                <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.95rem' }}>
                  {t('Client :')} <strong style={{ color: 'var(--text-main)' }}>{devis.client}</strong>
                  {' '}{t("| Émis le {emission} | Valide jusqu'au {validite}", { emission: devis.date_emission, validite: devis.date_validite })}
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <div className="numeric">
                  <p style={{ margin: '0 0 4px 0', fontSize: '0.85rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{t('Total estimé')}</p>
                  <p style={{ margin: 0, fontWeight: '700', fontSize: '1.2rem', color: 'var(--text-main)' }}>
                    {montant(devis.montant_total, devis.devise)}
                  </p>
                </div>

                <button type="button" className="btn-icon" onClick={() => setPrintingDevisId(devis.id)}>
                  <Printer size={16} aria-hidden="true" /> PDF
                </button>

                {!estTermine && (
                  <button type="button" className="btn-icon" onClick={() => setDevisIdToEdit(devis.id)}>
                    <Pencil size={16} aria-hidden="true" /> {t('Modifier')}
                  </button>
                )}

                {!estTermine && (
                  <button type="button" className="btn-danger" onClick={() => handleCancelDevis(devis)}>
                    <Ban size={16} aria-hidden="true" /> {t('Refuser')}
                  </button>
                )}

                {/* L'icône de la vue Factures, qui dit ce que le devis devient. */}
                {!estTermine && peutConvertir && (
                  <button type="button" className="btn-primary" onClick={() => handleConvert(devis)} style={{ width: '190px' }}>
                    <Receipt size={16} aria-hidden="true" /> {t('Convertir en facture')}
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
