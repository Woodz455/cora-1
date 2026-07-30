import { useState, useMemo } from 'react';
import { api, formatMontant } from '../api';

/** Identifiant local d'une ligne, stable pour la clé React. */
let compteurLignes = 0;
const nouvelleLigne = (valeurs = {}) => ({
  cle: `nc-ligne-${++compteurLignes}`,
  description: '',
  quantite: 1,
  prix_unitaire: 0,
  ...valeurs
});

const MOTIFS = [
  'Remise commerciale accordée après facturation',
  'Marchandise ou service retourné',
  'Erreur de facturation',
  'Annulation partielle de la commande'
];

/**
 * Émission d'une note de crédit sur une facture.
 *
 * Une facture encaissée ne peut être ni modifiée ni supprimée : c'est par ce
 * document que l'on corrige ce qu'un client doit, sans toucher à la pièce
 * d'origine.
 */
function CreditNoteModal({ facture, onClose, onSuccess }) {
  const [lignes, setLignes] = useState([nouvelleLigne()]);
  const [motif, setMotif] = useState('');
  const [dateEmission, setDateEmission] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Ce qu'il reste possible de créditer : le total facturé, moins ce qui l'a déjà été.
  const creditable = Math.max(0, Number((facture.montant_total - (facture.montant_credite || 0)).toFixed(2)));

  const sousTotal = useMemo(
    () => lignes.reduce((sum, l) => sum + ((parseFloat(l.quantite) || 0) * (parseFloat(l.prix_unitaire) || 0)), 0),
    [lignes]
  );

  // Les taxes de la note reprennent celles de la facture d'origine.
  const taxe1 = sousTotal * (facture.taux_taxe_1 || 0);
  const taxe2 = sousTotal * (facture.taux_taxe_2 || 0);
  const total = sousTotal + taxe1 + taxe2;
  const depasse = total > creditable + 0.005;

  const handleLigneChange = (index, champs) => {
    setLignes((prev) => prev.map((l, i) => (i === index ? { ...l, ...champs } : l)));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const note = await api.post('/api/notes-credit', {
        facture_id: facture.id,
        date_emission: dateEmission,
        motif,
        lignes: lignes.map((l) => ({
          description: l.description,
          quantite: parseFloat(l.quantite),
          prix_unitaire: parseFloat(l.prix_unitaire)
        }))
      });
      onSuccess(note);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Émettre une note de crédit">
      <div className="modal-content glass-panel" style={{ maxWidth: '720px', width: '90%', maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ marginTop: 0, marginBottom: '10px', fontSize: '1.6rem', color: 'var(--text-main)', fontWeight: '700' }}>
          Note de crédit
        </h3>
        <p style={{ marginTop: 0, color: 'var(--text-muted)' }}>
          Sur la facture <strong style={{ color: 'var(--text-main)' }}>{facture.numero_facture}</strong> — {facture.client}
        </p>

        {error && <p className="alert alert-error" role="alert">{error}</p>}

        <div className="alert alert-info">
          Montant encore créditable : <strong>{formatMontant(creditable, facture.devise)}</strong>
          {facture.montant_credite > 0 && ` (${formatMontant(facture.montant_credite, facture.devise)} déjà crédité)`}.
          Les taxes de la note reprennent celles de la facture.
        </div>

        {creditable <= 0 ? (
          <div style={{ textAlign: 'right', marginTop: '20px' }}>
            <button type="button" className="btn-secondary" onClick={onClose}>Fermer</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '20px', marginBottom: '20px' }}>
              <div className="form-group">
                <label htmlFor="nc-date">Date d'émission *</label>
                <input
                  id="nc-date" type="date" className="form-control"
                  value={dateEmission} onChange={(e) => setDateEmission(e.target.value)} required
                />
              </div>
              <div className="form-group">
                <label htmlFor="nc-motif">Motif</label>
                <input
                  id="nc-motif" type="text" className="form-control" list="nc-motifs"
                  placeholder="Pourquoi ce crédit est-il accordé ?"
                  value={motif} onChange={(e) => setMotif(e.target.value)}
                />
                <datalist id="nc-motifs">
                  {MOTIFS.map((m) => <option key={m} value={m} />)}
                </datalist>
              </div>
            </div>

            <h4 style={{ color: 'var(--text-main)', borderBottom: '1px solid var(--glass-border)', paddingBottom: '10px' }}>
              Lignes à créditer
            </h4>

            {lignes.map((ligne, index) => (
              <div key={ligne.cle} style={{ display: 'flex', gap: '15px', marginBottom: '15px', alignItems: 'flex-start' }}>
                <div className="form-group" style={{ flex: 3, marginBottom: 0 }}>
                  <input
                    type="text" className="form-control" placeholder="Description du crédit"
                    aria-label={`Description de la ligne ${index + 1}`}
                    value={ligne.description}
                    onChange={(e) => handleLigneChange(index, { description: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  <input
                    type="number" className="form-control" placeholder="Qté"
                    aria-label={`Quantité de la ligne ${index + 1}`}
                    min="0.01" step="0.01" value={ligne.quantite}
                    onChange={(e) => handleLigneChange(index, { quantite: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  <input
                    type="number" className="form-control" placeholder="Montant"
                    aria-label={`Montant unitaire de la ligne ${index + 1}`}
                    min="0" step="0.01" value={ligne.prix_unitaire}
                    onChange={(e) => handleLigneChange(index, { prix_unitaire: e.target.value })}
                    required
                  />
                </div>
                <button
                  type="button" className="btn-icon" style={{ padding: '12px' }}
                  onClick={() => setLignes((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev))}
                  disabled={lignes.length === 1}
                  aria-label={`Supprimer la ligne ${index + 1}`}
                >
                  ✖
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={() => setLignes((prev) => [...prev, nouvelleLigne()])}
              style={{ padding: '8px 15px', background: 'var(--glass-bg)', border: '1px dashed var(--safehill-blue)', color: 'var(--safehill-blue)', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' }}
            >
              + Ajouter une ligne
            </button>

            <div style={{ marginTop: '25px', padding: '15px 20px', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                <span>Sous-total</span><span>{formatMontant(sousTotal, facture.devise)}</span>
              </div>
              {facture.taux_taxe_1 > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                  <span>{facture.taxe_1_nom}</span><span>{formatMontant(taxe1, facture.devise)}</span>
                </div>
              )}
              {facture.taux_taxe_2 > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                  <span>{facture.taxe_2_nom}</span><span>{formatMontant(taxe2, facture.devise)}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px', paddingTop: '10px', borderTop: '1px dashed var(--border-color)', fontWeight: 'bold', fontSize: '1.2rem' }}>
                <span>Total crédité</span>
                <span style={{ color: depasse ? 'var(--status-danger)' : 'var(--text-main)' }}>
                  {formatMontant(total, facture.devise)}
                </span>
              </div>
            </div>

            {depasse && (
              <p className="alert alert-error" style={{ marginTop: '15px' }} role="alert">
                Ce crédit dépasse le montant créditable de {formatMontant(total - creditable, facture.devise)}.
              </p>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '25px' }}>
              <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>Annuler</button>
              <button type="submit" className="btn-primary" disabled={loading || depasse || total <= 0}>
                {loading ? 'Émission…' : 'Émettre la note de crédit'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default CreditNoteModal;
