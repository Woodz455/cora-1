import { useState } from 'react';
import { api, formatMontant } from '../api';
import { useApiResource } from '../useApiResource';
import { useHasRole } from '../UserContext';

function PaymentModal({ facture, onClose }) {
  // Le solde exact est pré-rempli pour faciliter le règlement complet.
  const [montant, setMontant] = useState(facture.solde_restant);
  const [note, setNote] = useState('');
  const [datePaiement, setDatePaiement] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Historique des encaissements : sans lui, une saisie erronée restait
  // invisible, et donc incorrigible.
  const { data: details, refresh } = useApiResource(`/api/factures/${facture.id}/details`);
  const paiements = (details && details.paiements) || [];
  const solde = details ? details.solde_restant : facture.solde_restant;
  const estAdmin = useHasRole('admin');

  // Le motif se saisit dans la page, et non par `window.prompt` : Electron ne
  // prend pas cette fenêtre en charge — « prompt() is not supported » — et le
  // bouton restait donc sans effet dans l'application de bureau.
  const [paiementAAnnuler, setPaiementAAnnuler] = useState(null);
  const [motifAnnulation, setMotifAnnulation] = useState('');

  const handleAnnuler = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await api.del(`/api/factures/paiements/${paiementAAnnuler.id}`, { motif: motifAnnulation });
      setPaiementAAnnuler(null);
      setMotifAnnulation('');
      refresh();
    } catch (err) {
      setError(err.message);
    }
  };

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
      <div className="modal-content glass-panel" style={{ maxHeight: '90vh', overflowY: 'auto' }}>
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
              {formatMontant(solde, facture.devise)}
            </strong>
          </div>
        </div>

        {error && <p className="alert alert-error" role="alert">{error}</p>}

        {paiements.length > 0 && (
          <div style={{ marginBottom: '25px' }}>
            <h4 style={{ margin: '0 0 12px 0', color: 'var(--text-main)', fontSize: '1rem' }}>
              Encaissements enregistrés
            </h4>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: '240px', overflowY: 'auto' }}>
              {paiements.map((p) => (
                <li
                  key={p.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    padding: '10px 0', borderBottom: '1px solid var(--glass-border)',
                    opacity: p.annule_le ? 0.55 : 1
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: 'var(--text-main)', textDecoration: p.annule_le ? 'line-through' : 'none' }}>
                      <strong>{formatMontant(p.montant, facture.devise)}</strong>
                      <span style={{ color: 'var(--text-muted)' }}> — {p.date_paiement}</span>
                    </div>
                    {p.note && (
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{p.note}</div>
                    )}
                    {p.annule_le && (
                      <div style={{ fontSize: '0.85rem', color: 'var(--status-warning)' }}>
                        Annulé le {p.annule_le}
                        {p.annule_par && ` par ${p.annule_par}`}
                        {p.motif_annulation && ` — ${p.motif_annulation}`}
                      </div>
                    )}
                  </div>
                  {estAdmin && !p.annule_le && paiementAAnnuler?.id !== p.id && (
                    <button
                      type="button" className="btn-icon"
                      onClick={() => { setPaiementAAnnuler(p); setMotifAnnulation(''); }}
                      title="Annuler cet encaissement, en conservant sa trace"
                    >
                      Annuler l'encaissement
                    </button>
                  )}
                </li>
              ))}
            </ul>

            {/* Hors de la liste défilante, pour rester visible quel que soit le
                nombre d'encaissements. */}
            {paiementAAnnuler && (
              <form onSubmit={handleAnnuler} style={{ marginTop: '15px' }}>
                <label htmlFor="motif-annulation" style={{ display: 'block', marginBottom: '6px', color: 'var(--text-main)' }}>
                  Motif de l'annulation de {formatMontant(paiementAAnnuler.montant, facture.devise)}
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    id="motif-annulation" type="text" className="form-control"
                    placeholder="Ex. : chèque sans provision, saisie en double…"
                    value={motifAnnulation}
                    onChange={(e) => setMotifAnnulation(e.target.value)}
                    autoFocus required
                  />
                  <button type="submit" className="btn-danger">Confirmer</button>
                  <button
                    type="button" className="btn-secondary"
                    onClick={() => { setPaiementAAnnuler(null); setMotifAnnulation(''); }}
                  >
                    Renoncer
                  </button>
                </div>
                <p style={{ margin: '6px 0 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Le paiement restera visible, marqué annulé, avec ce motif.
                </p>
              </form>
            )}
          </div>
        )}

        {solde <= 0 ? (
          <div>
            <p className="alert alert-info">
              Cette facture est soldée. Pour revenir sur un encaissement, annulez-le ci-dessus.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button type="button" className="btn-secondary" onClick={onClose}>Fermer</button>
            </div>
          </div>
        ) : (
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="paiement-montant">
              Montant du paiement ({facture.devise})
            </label>
            <input
              id="paiement-montant"
              type="number"
              step="0.01"
              min="0.01"
              max={solde}
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
        )}
      </div>
    </div>
  );
}

export default PaymentModal;
