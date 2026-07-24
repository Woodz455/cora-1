import React, { useState, useEffect } from 'react';

function CatalogueList() {
  const [items, setItems] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentItem, setCurrentItem] = useState({ nom: '', description: '', prix_unitaire: 0 });

  const fetchCatalogue = async () => {
    const response = await fetch('/api/catalogue');
    const data = await response.json();
    setItems(data);
  };

  useEffect(() => {
    fetchCatalogue();
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    const url = currentItem.id ? `/api/catalogue/${currentItem.id}` : '/api/catalogue';
    const method = currentItem.id ? 'PUT' : 'POST';

    await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentItem)
    });

    setIsModalOpen(false);
    fetchCatalogue();
  };

  const handleDelete = async (id) => {
    if (window.confirm('Voulez-vous vraiment supprimer ce service du catalogue ?')) {
      await fetch(`/api/catalogue/${id}`, { method: 'DELETE' });
      fetchCatalogue();
    }
  };

  const openModal = (item = null) => {
    setCurrentItem(item || { nom: '', description: '', prix_unitaire: 0 });
    setIsModalOpen(true);
  };

  return (
    <div className="glass-panel" style={{ padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
        <h2>Catalogue de Services</h2>
        <button className="btn-primary" onClick={() => openModal()}>+ Nouveau Service</button>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--border-color)', textAlign: 'left' }}>
            <th style={{ padding: '10px' }}>Nom du Service</th>
            <th style={{ padding: '10px' }}>Description</th>
            <th style={{ padding: '10px' }}>Prix / Tarif</th>
            <th style={{ padding: '10px', textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr key={item.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
              <td style={{ padding: '10px', fontWeight: '500' }}>{item.nom}</td>
              <td style={{ padding: '10px', color: 'var(--text-muted)' }}>{item.description}</td>
              <td style={{ padding: '10px' }}>{Number(item.prix_unitaire).toFixed(2)} $</td>
              <td style={{ padding: '10px', textAlign: 'right' }}>
                <button className="btn-secondary" onClick={() => openModal(item)} style={{ marginRight: '5px' }}>✏️</button>
                <button className="btn-secondary" onClick={() => handleDelete(item.id)} style={{ color: '#ef4444' }}>🗑️</button>
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan="4" style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                Votre catalogue est vide.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>{currentItem.id ? 'Modifier le service' : 'Ajouter un service'}</h3>
            <form onSubmit={handleSave}>
              <div className="form-group">
                <label>Nom du service *</label>
                <input type="text" className="form-control" value={currentItem.nom} onChange={e => setCurrentItem({...currentItem, nom: e.target.value})} required />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea className="form-control" value={currentItem.description} onChange={e => setCurrentItem({...currentItem, description: e.target.value})} rows="3" />
              </div>
              <div className="form-group">
                <label>Prix ou Tarif ($) *</label>
                <input type="number" step="0.01" className="form-control" value={currentItem.prix_unitaire} onChange={e => setCurrentItem({...currentItem, prix_unitaire: e.target.value})} required />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                <button type="button" className="btn-secondary" onClick={() => setIsModalOpen(false)}>Annuler</button>
                <button type="submit" className="btn-primary">Sauvegarder</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default CatalogueList;
