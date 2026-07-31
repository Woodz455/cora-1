import { useState, useMemo } from 'react';
import PaymentModal from './PaymentModal';
import InvoiceModal from './InvoiceModal';
import InvoicePrintTemplate from './InvoicePrintTemplate';
import CreditNoteModal from './CreditNoteModal';
import { api, formatMontant } from '../api';
import { useApiResource } from '../useApiResource';
import { useUser } from '../UserContext';
import { usePagination } from '../usePagination';
import Pagination from './Pagination';

const STATUTS = ['Tous', 'En attente', 'Partiellement payée', 'Payée', 'Créditée', 'Annulée'];
const AUJOURDHUI = new Date().toISOString().split('T')[0];
const PAR_PAGE = 15;

/**
 * @param {{statutInitial?: string, echuesSeulement?: boolean, ouvrirNouvelle?: boolean}} props
 *   État initial transmis par le tableau de bord : un indicateur cliqué ouvre
 *   la liste déjà filtrée sur ce qu'il représentait.
 */
function InvoiceList({ statutInitial, echuesSeulement = false, ouvrirNouvelle = false }) {
  const user = useUser();
  const estAdmin = user?.role === 'admin';
  const gereTresorerie = user?.role === 'admin' || user?.role === 'comptable';

  const { data: factures, loading, error, refresh: fetchFactures } = useApiResource('/api/factures', []);

  const [selectedFacture, setSelectedFacture] = useState(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(ouvrirNouvelle);
  const [printingFactureId, setPrintingFactureId] = useState(null);
  const [isRelance, setIsRelance] = useState(false);
  const [factureIdToEdit, setFactureIdToEdit] = useState(null);
  const [factureACrediter, setFactureACrediter] = useState(null);
  const [message, setMessage] = useState(null);

  const [recherche, setRecherche] = useState('');
  const [filtreStatut, setFiltreStatut] = useState(statutInitial || 'Tous');
  const [filtreEchues, setFiltreEchues] = useState(echuesSeulement);

  // Le filtrage se fait en mémoire : la liste tient largement en RAM pour une
  // PME, et cela évite un aller-retour serveur à chaque frappe.
  const facturesFiltrees = useMemo(() => {
    const terme = recherche.trim().toLowerCase();
    return factures.filter((f) => {
      if (filtreStatut !== 'Tous' && f.statut !== filtreStatut) return false;
      if (filtreEchues && !(f.statut !== 'Annulée' && f.solde_restant > 0 && f.date_echeance < AUJOURDHUI)) {
        return false;
      }
      if (!terme) return true;
      return f.numero_facture.toLowerCase().includes(terme)
        || (f.client || '').toLowerCase().includes(terme);
    });
  }, [factures, recherche, filtreStatut, filtreEchues]);

  const { setPage, affiches: facturesAffichees, pagination } = usePagination(facturesFiltrees, PAR_PAGE);

  // La pagination repart à la première page dès que les filtres changent.
  const changerFiltre = (setter) => (valeur) => {
    setter(valeur);
    setPage(1);
  };

  const executer = async (action, message) => {
    try {
      await action();
      fetchFactures();
    } catch (err) {
      // Le serveur explique pourquoi l'opération est refusée (facture payée,
      // privilèges insuffisants) : ce message vaut mieux qu'un texte générique.
      window.alert(`${message}\n\n${err.message}`);
    }
  };

  const handleCancelFacture = (facture) => {
    if (!window.confirm(`Annuler la facture ${facture.numero_facture} ?`)) return;
    executer(() => api.put(`/api/factures/${facture.id}/cancel`), "L'annulation a échoué.");
  };

  const handleDeleteFacture = (facture) => {
    const message = `Supprimer définitivement la facture ${facture.numero_facture} ?\n\n`
      + 'Cette action est irréversible. Une facture déjà réglée, même partiellement, '
      + 'ne peut pas être supprimée : annulez-la ou émettez une note de crédit.';
    if (!window.confirm(message)) return;
    executer(() => api.del(`/api/factures/${facture.id}`), 'La suppression a échoué.');
  };

  const closeAndRefresh = () => {
    setSelectedFacture(null);
    fetchFactures();
  };

  if (loading) return <p style={{ color: 'var(--text-muted)' }}>Chargement des données financières…</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      {message && <p className="alert alert-success" role="status">{message}</p>}

      <div className="toolbar">
        <div className="toolbar-group">
          <label htmlFor="recherche-facture" className="sr-only" style={{ position: 'absolute', left: '-9999px' }}>
            Rechercher une facture
          </label>
          <input
            id="recherche-facture"
            type="search"
            className="search-input"
            placeholder="Rechercher un numéro ou un client…"
            value={recherche}
            onChange={(e) => changerFiltre(setRecherche)(e.target.value)}
          />
          <select
            className="search-input"
            style={{ minWidth: '180px' }}
            value={filtreStatut}
            onChange={(e) => changerFiltre(setFiltreStatut)(e.target.value)}
            aria-label="Filtrer par statut"
          >
            {STATUTS.map((s) => <option key={s} value={s}>{s === 'Tous' ? 'Tous les statuts' : s}</option>)}
          </select>
          {/* Rendu visible et réversible : arrivé depuis le tableau de bord,
              on doit comprendre pourquoi la liste est réduite. */}
          <button
            type="button"
            className={filtreEchues ? 'btn-danger' : 'btn-icon'}
            aria-pressed={filtreEchues}
            onClick={() => changerFiltre(setFiltreEchues)(!filtreEchues)}
            title="N'afficher que les factures dont l'échéance est dépassée"
          >
            Échues seulement
          </button>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            {facturesFiltrees.length} facture{facturesFiltrees.length > 1 ? 's' : ''}
          </span>
        </div>
        <button type="button" className="btn-primary" onClick={() => setIsCreateModalOpen(true)}>
          + Nouvelle facture
        </button>
      </div>

      {facturesAffichees.length === 0 ? (
        <div className="glass-panel empty-state">
          {factures.length === 0 ? 'Aucune facture pour le moment.' : 'Aucune facture ne correspond à votre recherche.'}
        </div>
      ) : (
        facturesAffichees.map((facture) => {
          const isAnnulee = facture.statut === 'Annulée';
          const classeStatut = facture.statut === 'Payée' ? 'payee'
            : facture.statut === 'Partiellement payée' ? 'partielle'
              : facture.statut === 'Créditée' ? 'creditee'
                : isAnnulee ? 'annulee' : 'pending';

          return (
            <div
              key={facture.id}
              className="glass-card"
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                gap: '20px', flexWrap: 'wrap',
                opacity: isAnnulee ? 0.6 : 1, filter: isAnnulee ? 'grayscale(100%)' : 'none'
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '10px' }}>
                  <h3 style={{ margin: 0, fontSize: '1.3rem', fontWeight: '600', textDecoration: isAnnulee ? 'line-through' : 'none' }}>
                    {facture.numero_facture}
                  </h3>
                  <span className={`status-badge ${classeStatut}`}>{facture.statut}</span>
                  {facture.devise !== 'CAD' && (
                    <span className="status-badge pending">{facture.devise}</span>
                  )}
                </div>
                <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.95rem' }}>
                  Client : <strong style={{ color: 'var(--text-main)' }}>{facture.client}</strong>
                  {' '}| Émise le {facture.date_emission} | Échéance {facture.date_echeance}
                </p>
                {facture.montant_credite > 0 && (
                  <p style={{ margin: '6px 0 0 0', fontSize: '0.9rem', color: 'var(--status-warning)' }}>
                    Note(s) de crédit : − {formatMontant(facture.montant_credite, facture.devise)}
                    {facture.montant_a_rembourser > 0
                      && ` — ${formatMontant(facture.montant_a_rembourser, facture.devise)} à rembourser au client`}
                  </p>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <div className="numeric">
                  <p style={{ margin: '0 0 5px 0', fontSize: '0.85rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total</p>
                  <p style={{ margin: 0, fontWeight: '600', fontSize: '1.1rem' }}>{formatMontant(facture.montant_total, facture.devise)}</p>
                </div>
                <div className="numeric">
                  <p style={{ margin: '0 0 5px 0', fontSize: '0.85rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Reste à payer</p>
                  <p style={{ margin: 0, fontWeight: '700', fontSize: '1.4rem', color: facture.solde_restant > 0 ? 'var(--status-partial)' : 'var(--status-paid)' }}>
                    {formatMontant(facture.solde_restant, facture.devise)}
                  </p>
                </div>

                <button type="button" className="btn-icon" onClick={() => { setPrintingFactureId(facture.id); setIsRelance(false); }}>
                  🖨️ PDF
                </button>

                {!isAnnulee && facture.solde_restant > 0 && (
                  <button
                    type="button"
                    className="btn-warning"
                    onClick={() => { setPrintingFactureId(facture.id); setIsRelance(true); }}
                    title={facture.relances_envoyees > 0
                      ? `Déjà relancé ${facture.relances_envoyees} fois (dernière : ${facture.date_derniere_relance})`
                      : 'Envoyer un rappel de paiement'}
                  >
                    🔔 Relancer {facture.relances_envoyees > 0 && `(${facture.relances_envoyees})`}
                  </button>
                )}

                {!isAnnulee && facture.statut === 'En attente' && (
                  <button type="button" className="btn-icon" onClick={() => setFactureIdToEdit(facture.id)}>
                    ✏️ Modifier
                  </button>
                )}

                {/* Annulation et suppression ne sont proposées qu'aux rôles
                    qui y ont droit : elles étaient offertes à tout le monde et
                    le refus n'arrivait qu'après le clic. */}
                {gereTresorerie && !isAnnulee && facture.montant_paye === 0 && (
                  <button type="button" className="btn-danger" onClick={() => handleCancelFacture(facture)}>
                    🚫 Annuler
                  </button>
                )}

                {estAdmin && facture.montant_paye === 0 && (
                  <button type="button" className="btn-danger" onClick={() => handleDeleteFacture(facture)} title="Supprimer définitivement">
                    🗑️ Supprimer
                  </button>
                )}

                {gereTresorerie && !isAnnulee && facture.statut !== 'Créditée' && (
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={() => setFactureACrediter(facture)}
                    title="Corriger cette facture par une note de crédit"
                  >
                    ↩️ Note de crédit
                  </button>
                )}

                {/* Une facture soldée reste consultable : c'est par cette
                    fenêtre que l'on revient sur un encaissement, et un
                    sur-paiement rend justement la facture soldée. Le bouton
                    désactivé la rendait inatteignable. */}
                {gereTresorerie && (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => setSelectedFacture(facture)}
                    disabled={isAnnulee || (facture.solde_restant <= 0 && facture.montant_paye <= 0)}
                    style={{ width: '180px' }}
                  >
                    {facture.solde_restant > 0
                      ? '+ Ajouter paiement'
                      : facture.montant_paye > 0 ? '✓ Voir les encaissements' : '✓ Facture soldée'}
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}

      <Pagination {...pagination} />

      {selectedFacture && (
        <PaymentModal facture={selectedFacture} onClose={closeAndRefresh} />
      )}

      {factureACrediter && (
        <CreditNoteModal
          facture={factureACrediter}
          onClose={() => setFactureACrediter(null)}
          onSuccess={(note) => {
            setFactureACrediter(null);
            setMessage(`Note de crédit ${note.numero_note} émise.`);
            fetchFactures();
          }}
        />
      )}

      {(isCreateModalOpen || factureIdToEdit) && (
        <InvoiceModal
          factureIdToEdit={factureIdToEdit}
          onClose={() => { setIsCreateModalOpen(false); setFactureIdToEdit(null); }}
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
          onClose={(relanceEnvoyee) => {
            setPrintingFactureId(null);
            setIsRelance(false);
            if (relanceEnvoyee) fetchFactures();
          }}
        />
      )}
    </div>
  );
}

export default InvoiceList;
