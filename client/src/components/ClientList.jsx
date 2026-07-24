import React, { useState, useEffect } from 'react';
import ClientModal from './ClientModal';

function ClientList() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [clientToEdit, setClientToEdit] = useState(null);

  const openCreateModal = () => {
    setClientToEdit(null);
    setIsModalOpen(true);
  };

  const openEditModal = (client) => {
    setClientToEdit(client);
    setIsModalOpen(true);
  };

  const fetchClients = async () => {
    try {
      const response = await fetch('/api/clients');
      if (!response.ok) throw new Error('Erreur réseau');
      const data = await response.json();
      setClients(data);
    } catch (err) {
      setError('Impossible de charger les clients');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClients();
  }, []);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ margin: 0, color: 'var(--text-main)' }}>Vos Clients</h2>
        <button className="btn-primary" onClick={openCreateModal}>
          + Nouveau Client
        </button>
      </div>

      {error && <p style={{ color: '#ef4444' }}>{error}</p>}
      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>Chargement des clients...</p>
      ) : clients.length === 0 ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: '40px' }}>
          <p style={{ color: 'var(--text-muted)' }}>Aucun client pour le moment.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
          {clients.map(client => (
            <div key={client.id} className="glass-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                <h3 style={{ margin: 0, color: 'var(--text-main)', fontSize: '1.2rem' }}>{client.nom_entreprise}</h3>
                <button 
                  onClick={() => openEditModal(client)} 
                  style={{ background: 'transparent', border: '1px solid var(--glass-border)', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.85rem' }}
                >
                  Éditer
                </button>
              </div>
              <p style={{ margin: '0 0 5px 0', color: 'var(--text-muted)' }}>👤 {client.nom_contact || 'Non spécifié'}</p>
              <p style={{ margin: '0 0 5px 0', color: 'var(--text-muted)' }}>✉️ {client.email}</p>
              {client.adresse && <p style={{ margin: '0', color: 'var(--text-muted)' }}>📍 {client.adresse}</p>}
            </div>
          ))}
        </div>
      )}

      {isModalOpen && (
        <ClientModal 
          clientToEdit={clientToEdit}
          onClose={() => setIsModalOpen(false)} 
          onSuccess={() => {
            setIsModalOpen(false);
            fetchClients();
          }} 
        />
      )}
    </div>
  );
}

export default ClientList;
