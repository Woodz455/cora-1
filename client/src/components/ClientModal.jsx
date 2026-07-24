import React, { useState } from 'react';

function ClientModal({ onClose, onSuccess, clientToEdit }) {
  const [formData, setFormData] = useState({
    nom_entreprise: clientToEdit ? clientToEdit.nom_entreprise : '',
    nom_contact: clientToEdit ? clientToEdit.nom_contact : '',
    email: clientToEdit ? clientToEdit.email : '',
    adresse: clientToEdit ? clientToEdit.adresse : '',
    langue: clientToEdit ? clientToEdit.langue : 'fr',
    province: clientToEdit ? clientToEdit.province || 'QC' : 'QC'
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const url = clientToEdit ? `/api/clients/${clientToEdit.id}` : '/api/clients';
      const method = clientToEdit ? 'PUT' : 'POST';
      const response = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (!response.ok) throw new Error(clientToEdit ? 'Erreur lors de la modification du client.' : 'Erreur lors de la création du client.');
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content glass-panel">
        <h3 style={{ marginTop: 0, marginBottom: '25px', fontSize: '1.6rem', color: 'var(--text-main)', fontWeight: '700' }}>
          {clientToEdit ? 'Modifier le client' : 'Nouveau Client'}
        </h3>

        {error && <p style={{ color: '#ef4444', marginBottom: '15px', padding: '10px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '8px' }}>{error}</p>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Nom de l'entreprise *</label>
            <input type="text" className="form-control" name="nom_entreprise" value={formData.nom_entreprise} onChange={handleChange} required />
          </div>
          <div className="form-group">
            <label>Email *</label>
            <input type="email" className="form-control" name="email" value={formData.email} onChange={handleChange} required />
          </div>
          <div className="form-group">
            <label>Personne de contact</label>
            <input type="text" className="form-control" name="nom_contact" value={formData.nom_contact} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label>Adresse postale</label>
            <textarea className="form-control" name="adresse" value={formData.adresse} onChange={handleChange} rows="2"></textarea>
          </div>
          <div className="form-group" style={{ display: 'flex', gap: '15px' }}>
            <div style={{ flex: 1 }}>
              <label>Langue de facturation</label>
              <select className="form-control" name="langue" value={formData.langue} onChange={handleChange}>
                <option value="fr">Français</option>
                <option value="en">Anglais</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label>Province (Taxes)</label>
              <select className="form-control" name="province" value={formData.province} onChange={handleChange}>
                <option value="QC">Québec (TPS 5% + TVQ 9.975%)</option>
                <option value="ON">Ontario (TVH 13%)</option>
                <option value="BC">Colombie-Britannique (TPS 5% + TVP 7%)</option>
                <option value="AB">Alberta (TPS 5%)</option>
                <option value="SK">Saskatchewan (TPS 5% + TVP 6%)</option>
                <option value="MB">Manitoba (TPS 5% + TVP 7%)</option>
                <option value="NB">Nouveau-Brunswick (TVH 15%)</option>
                <option value="NL">Terre-Neuve-et-Labrador (TVH 15%)</option>
                <option value="NS">Nouvelle-Écosse (TVH 15%)</option>
                <option value="PE">Île-du-Prince-Édouard (TVH 15%)</option>
                <option value="NT">Territoires du Nord-Ouest (TPS 5%)</option>
                <option value="NU">Nunavut (TPS 5%)</option>
                <option value="YT">Yukon (TPS 5%)</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '35px' }}>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>Annuler</button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Sauvegarde...' : (clientToEdit ? 'Enregistrer' : 'Créer le client')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ClientModal;
