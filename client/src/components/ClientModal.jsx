import { useState } from 'react';
import { api } from '../api';
import { useModale } from '../useModale';

/**
 * Provinces et territoires, avec le régime de taxes appliqué aux documents
 * émis pour ce client. La liste doit rester alignée sur `getTaxRatesForProvince`
 * côté serveur, qui reste la référence.
 */
const PROVINCES = [
  { code: 'QC', libelle: 'Québec (TPS 5 % + TVQ 9,975 %)' },
  { code: 'ON', libelle: 'Ontario (TVH 13 %)' },
  { code: 'BC', libelle: 'Colombie-Britannique (TPS 5 % + TVP 7 %)' },
  { code: 'AB', libelle: 'Alberta (TPS 5 %)' },
  { code: 'SK', libelle: 'Saskatchewan (TPS 5 % + TVP 6 %)' },
  { code: 'MB', libelle: 'Manitoba (TPS 5 % + TVP 7 %)' },
  { code: 'NB', libelle: 'Nouveau-Brunswick (TVH 15 %)' },
  { code: 'NL', libelle: 'Terre-Neuve-et-Labrador (TVH 15 %)' },
  { code: 'NS', libelle: 'Nouvelle-Écosse (TVH 15 %)' },
  { code: 'PE', libelle: 'Île-du-Prince-Édouard (TVH 15 %)' },
  { code: 'NT', libelle: 'Territoires du Nord-Ouest (TPS 5 %)' },
  { code: 'NU', libelle: 'Nunavut (TPS 5 %)' },
  { code: 'YT', libelle: 'Yukon (TPS 5 %)' }
];

function ClientModal({ onClose, onSuccess, clientToEdit }) {
  const modaleRef = useModale(onClose);
  const [formData, setFormData] = useState({
    nom_entreprise: clientToEdit?.nom_entreprise || '',
    nom_contact: clientToEdit?.nom_contact || '',
    email: clientToEdit?.email || '',
    adresse: clientToEdit?.adresse || '',
    langue: clientToEdit?.langue || 'fr',
    province: clientToEdit?.province || 'QC'
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (clientToEdit) await api.put(`/api/clients/${clientToEdit.id}`, formData);
      else await api.post('/api/clients', formData);
      onSuccess();
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const titre = clientToEdit ? 'Modifier le client' : 'Nouveau client';

  return (
    <div ref={modaleRef} className="modal-overlay" role="dialog" aria-modal="true" aria-label={titre}>
      <div className="modal-content glass-panel" style={{ maxWidth: '560px', maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ marginTop: 0, marginBottom: '25px', fontSize: '1.6rem', color: 'var(--text-main)', fontWeight: '700' }}>
          {titre}
        </h3>

        {error && <p className="alert alert-error" role="alert">{error}</p>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="client-nom">Nom de l'entreprise *</label>
            <input id="client-nom" type="text" className="form-control" name="nom_entreprise" value={formData.nom_entreprise} onChange={handleChange} required autoFocus />
          </div>
          <div className="form-group">
            <label htmlFor="client-email">Courriel *</label>
            <input id="client-email" type="email" className="form-control" name="email" value={formData.email} onChange={handleChange} required />
          </div>
          <div className="form-group">
            <label htmlFor="client-contact">Personne de contact</label>
            <input id="client-contact" type="text" className="form-control" name="nom_contact" value={formData.nom_contact} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label htmlFor="client-adresse">Adresse postale</label>
            <textarea id="client-adresse" className="form-control" name="adresse" value={formData.adresse} onChange={handleChange} rows="2"></textarea>
          </div>

          <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ flex: 1, minWidth: '180px' }}>
              <label htmlFor="client-langue">Langue de facturation</label>
              <select id="client-langue" className="form-control" name="langue" value={formData.langue} onChange={handleChange}>
                <option value="fr">Français</option>
                <option value="en">Anglais</option>
              </select>
            </div>
            <div className="form-group" style={{ flex: 1, minWidth: '220px' }}>
              <label htmlFor="client-province">Province (détermine les taxes)</label>
              <select id="client-province" className="form-control" name="province" value={formData.province} onChange={handleChange}>
                {PROVINCES.map((p) => <option key={p.code} value={p.code}>{p.libelle}</option>)}
              </select>
            </div>
          </div>

          {clientToEdit && (
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '5px 0 0 0' }}>
              Changer la province n'affecte que les futurs documents : les taxes des factures
              déjà émises restent figées.
            </p>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '35px' }}>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>Annuler</button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Sauvegarde…' : (clientToEdit ? 'Enregistrer' : 'Créer le client')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ClientModal;
