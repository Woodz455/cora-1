import { useState, useMemo } from 'react';
import ClientModal from './ClientModal';
import { useApiResource } from '../useApiResource';

const PAR_PAGE = 24;

function ClientList() {
  const { data: clients, loading, error, refresh } = useApiResource('/api/clients', []);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [clientToEdit, setClientToEdit] = useState(null);
  const [recherche, setRecherche] = useState('');
  const [page, setPage] = useState(1);

  // La pagination repart à la première page dès que la recherche change.
  const changerRecherche = (valeur) => {
    setRecherche(valeur);
    setPage(1);
  };

  const clientsFiltres = useMemo(() => {
    const terme = recherche.trim().toLowerCase();
    if (!terme) return clients;
    return clients.filter((c) => [c.nom_entreprise, c.nom_contact, c.email]
      .some((champ) => (champ || '').toLowerCase().includes(terme)));
  }, [clients, recherche]);

  const nbPages = Math.max(1, Math.ceil(clientsFiltres.length / PAR_PAGE));
  const pageCourante = Math.min(page, nbPages);
  const affiches = clientsFiltres.slice((pageCourante - 1) * PAR_PAGE, pageCourante * PAR_PAGE);

  return (
    <div>
      {error && <p className="alert alert-error" role="alert">{error}</p>}

      <div className="toolbar">
        <div className="toolbar-group">
          <input
            type="search"
            className="search-input"
            placeholder="Rechercher un client…"
            aria-label="Rechercher un client"
            value={recherche}
            onChange={(e) => changerRecherche(e.target.value)}
          />
          <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            {clientsFiltres.length} client{clientsFiltres.length > 1 ? 's' : ''}
          </span>
        </div>
        <button type="button" className="btn-primary" onClick={() => { setClientToEdit(null); setIsModalOpen(true); }}>
          + Nouveau client
        </button>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>Chargement des clients…</p>
      ) : affiches.length === 0 ? (
        <div className="glass-panel empty-state">
          {clients.length === 0 ? 'Aucun client pour le moment.' : 'Aucun client ne correspond à votre recherche.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
          {affiches.map((client) => (
            <div key={client.id} className="glass-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '10px' }}>
                <h3 style={{ margin: 0, color: 'var(--text-main)', fontSize: '1.2rem' }}>{client.nom_entreprise}</h3>
                <button
                  type="button"
                  className="btn-icon"
                  style={{ padding: '4px 8px', fontSize: '0.85rem' }}
                  onClick={() => { setClientToEdit(client); setIsModalOpen(true); }}
                >
                  Éditer
                </button>
              </div>
              <p style={{ margin: '0 0 5px 0', color: 'var(--text-muted)' }}>👤 {client.nom_contact || 'Non spécifié'}</p>
              <p style={{ margin: '0 0 5px 0', color: 'var(--text-muted)' }}>✉️ {client.email}</p>
              {client.adresse && <p style={{ margin: '0 0 5px 0', color: 'var(--text-muted)' }}>📍 {client.adresse}</p>}
              {/* La province détermine les taxes appliquées : elle mérite d'être visible. */}
              <p style={{ margin: '10px 0 0 0' }}>
                <span className="status-badge pending">{client.province || '—'}</span>
                {' '}
                <span className="status-badge">{client.langue === 'en' ? 'Anglais' : 'Français'}</span>
              </p>
            </div>
          ))}
        </div>
      )}

      {nbPages > 1 && (
        <div className="pagination">
          <button type="button" className="btn-secondary" disabled={pageCourante === 1} onClick={() => setPage(pageCourante - 1)}>Précédent</button>
          <span>Page {pageCourante} sur {nbPages}</span>
          <button type="button" className="btn-secondary" disabled={pageCourante === nbPages} onClick={() => setPage(pageCourante + 1)}>Suivant</button>
        </div>
      )}

      {isModalOpen && (
        <ClientModal
          clientToEdit={clientToEdit}
          onClose={() => setIsModalOpen(false)}
          onSuccess={() => { setIsModalOpen(false); refresh(); }}
        />
      )}
    </div>
  );
}

export default ClientList;
