import React, { useState, useEffect } from 'react';

function InvoiceModal({ factureIdToEdit, onClose, onSuccess, mode = 'facture' }) {
  const [clients, setClients] = useState([]);
  const [catalogue, setCatalogue] = useState([]);
  const [formData, setFormData] = useState({
    client_id: '',
    date_emission: new Date().toISOString().split('T')[0],
    date_echeance: new Date(new Date().setDate(new Date().getDate() + 15)).toISOString().split('T')[0],
    devise: 'CAD',
    taux_change: 1.0
  });
  
  const [lignes, setLignes] = useState([
    { description: '', quantite: 1, prix_unitaire: 0 }
  ]);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/clients')
      .then(res => res.json())
      .then(data => {
        setClients(data);
        if (!factureIdToEdit && data.length > 0) {
          setFormData(prev => ({ ...prev, client_id: data[0].id }));
        }
      })
      .catch(() => setError("Impossible de charger les clients"));

    fetch('/api/catalogue')
      .then(res => res.json())
      .then(data => setCatalogue(data))
      .catch(() => console.error("Impossible de charger le catalogue"));
      
    if (factureIdToEdit) {
      const endpoint = mode === 'devis' ? `/api/devis/${factureIdToEdit}/details` : `/api/factures/${factureIdToEdit}/details`;
      fetch(endpoint)
        .then(res => res.json())
        .then(data => {
          setFormData({
            client_id: data.client_details.id,
            date_emission: data.date_emission,
            date_echeance: mode === 'devis' ? data.date_validite : data.date_echeance,
            devise: data.devise || 'CAD',
            taux_change: data.taux_change || 1.0
          });
          setLignes(data.lignes);
        })
        .catch(() => setError("Impossible de charger la facture"));
    }
  }, [factureIdToEdit]);

  const handleLigneChange = (index, field, value) => {
    const newLignes = [...lignes];
    newLignes[index][field] = value;
    setLignes(newLignes);
  };

  const addLigne = () => {
    setLignes([...lignes, { description: '', quantite: 1, prix_unitaire: 0 }]);
  };

  const removeLigne = (index) => {
    if (lignes.length > 1) {
      setLignes(lignes.filter((_, i) => i !== index));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formattedLignes = lignes.map(l => ({
      description: l.description,
      quantite: parseFloat(l.quantite),
      prix_unitaire: parseFloat(l.prix_unitaire)
    }));

    try {
      const isEditing = !!factureIdToEdit;
      const baseUrl = mode === 'devis' ? '/api/devis' : '/api/factures';
      const url = isEditing ? `${baseUrl}/${factureIdToEdit}` : baseUrl;
      const method = isEditing ? 'PUT' : 'POST';

      const payload = {
        client_id: formData.client_id,
        date_emission: formData.date_emission,
        devise: formData.devise,
        taux_change: parseFloat(formData.taux_change),
        lignes: formattedLignes
      };
      if (mode === 'devis') {
        payload.date_validite = formData.date_echeance;
      } else {
        payload.date_echeance = formData.date_echeance;
      }

      const response = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Erreur lors de l\'enregistrement');
      }
      
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const total = lignes.reduce((sum, ligne) => {
    return sum + ((parseFloat(ligne.quantite) || 0) * (parseFloat(ligne.prix_unitaire) || 0));
  }, 0);

  return (
    <div className="modal-overlay">
      <div className="modal-content glass-panel" style={{ maxWidth: '700px', width: '90%' }}>
        <h3 style={{ marginTop: 0, marginBottom: '25px', fontSize: '1.6rem', color: 'var(--text-main)', fontWeight: '700' }}>
          {factureIdToEdit 
            ? (mode === 'devis' ? 'Modifier le devis' : 'Modifier la facture') 
            : (mode === 'devis' ? 'Nouveau Devis' : 'Nouvelle Facture')}
        </h3>

        {error && <p style={{ color: '#ef4444', marginBottom: '15px', padding: '10px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '8px' }}>{error}</p>}

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
            <div className="form-group">
              <label>Client *</label>
              <select 
                className="form-control" 
                value={formData.client_id} 
                onChange={e => setFormData({...formData, client_id: e.target.value})} 
                required
              >
                <option value="">Sélectionner un client</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.nom_entreprise}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center' }}>
               <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                 Le numéro sera généré automatiquement ({mode === 'devis' ? 'DEV' : 'SHT'}-YYYYMM-XXXX)
               </p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '30px' }}>
            <div className="form-group">
              <label>Date d'émission *</label>
              <input type="date" className="form-control" value={formData.date_emission} onChange={e => setFormData({...formData, date_emission: e.target.value})} disabled={!!factureIdToEdit} required />
            </div>
            <div className="form-group">
              <label>{mode === 'devis' ? 'Date de validité *' : 'Date d\'échéance *'}</label>
              <input type="date" className="form-control" value={formData.date_echeance} onChange={e => setFormData({...formData, date_echeance: e.target.value})} required />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '30px' }}>
            <div className="form-group">
              <label>Devise *</label>
              <select className="form-control" value={formData.devise} onChange={e => setFormData({...formData, devise: e.target.value})}>
                <option value="CAD">CAD - Dollars Canadiens</option>
                <option value="USD">USD - Dollars Américains</option>
              </select>
            </div>
            {formData.devise !== 'CAD' && (
              <div className="form-group">
                <label>Taux de change (1 {formData.devise} = ? CAD) *</label>
                <input type="number" step="0.0001" min="0.0001" className="form-control" value={formData.taux_change} onChange={e => setFormData({...formData, taux_change: e.target.value})} required />
              </div>
            )}
          </div>

          <h4 style={{ color: 'var(--text-main)', borderBottom: '1px solid var(--glass-border)', paddingBottom: '10px' }}>Lignes de facturation</h4>
          
          {lignes.map((ligne, index) => (
            <div key={index} style={{ display: 'flex', gap: '15px', marginBottom: '15px', alignItems: 'flex-start' }}>
              <div className="form-group" style={{ flex: 3 }}>
                <input type="text" className="form-control" placeholder="Description du service" value={ligne.description} onChange={e => handleLigneChange(index, 'description', e.target.value)} required />
                {catalogue.length > 0 && (
                  <select 
                    style={{ marginTop: '5px', padding: '5px', fontSize: '0.85rem', background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-main)', width: '100%' }}
                    onChange={e => {
                      if (!e.target.value) return;
                      const item = catalogue.find(c => c.id === parseInt(e.target.value));
                      if (item) {
                        const newLignes = [...lignes];
                        newLignes[index].description = item.nom + (item.description ? ` - ${item.description}` : '');
                        newLignes[index].prix_unitaire = item.prix_unitaire;
                        setLignes(newLignes);
                      }
                      e.target.value = "";
                    }}
                  >
                    <option value="">Insérer depuis le catalogue...</option>
                    {catalogue.map(c => <option key={c.id} value={c.id}>{c.nom} ({Number(c.prix_unitaire).toFixed(2)} $)</option>)}
                  </select>
                )}
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <input type="number" className="form-control" placeholder="Qté / H" value={ligne.quantite} onChange={e => handleLigneChange(index, 'quantite', e.target.value)} min="0.1" step="0.1" required />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <input type="number" className="form-control" placeholder="Prix / Tarif" value={ligne.prix_unitaire} onChange={e => handleLigneChange(index, 'prix_unitaire', e.target.value)} min="0" step="0.01" required />
              </div>
              <button type="button" onClick={() => removeLigne(index)} style={{ padding: '12px', background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '1.2rem' }}>
                ✖
              </button>
            </div>
          ))}

          <button type="button" onClick={addLigne} style={{ padding: '8px 15px', background: 'var(--glass-bg)', border: '1px dashed var(--safehill-blue)', color: 'var(--safehill-blue)', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' }}>
            + Ajouter une ligne
          </button>

          <div style={{ textAlign: 'right', marginTop: '20px', fontSize: '1.4rem', color: 'var(--text-main)', fontWeight: 'bold' }}>
            Total : {total.toFixed(2)} $
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '35px' }}>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>Annuler</button>
            <button type="submit" className="btn-primary" disabled={loading || clients.length === 0}>
              {loading ? 'Enregistrement...' : (factureIdToEdit ? 'Enregistrer les modifications' : (mode === 'devis' ? 'Créer le devis' : 'Créer la facture'))}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default InvoiceModal;
