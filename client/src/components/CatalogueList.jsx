import { useState, useMemo } from 'react';
import { api, formatMontant } from '../api';
import { useApiResource } from '../useApiResource';

const ARTICLE_VIDE = { nom: '', description: '', prix_unitaire: 0 };

function CatalogueList() {
  const { data: items, loading, error, setError, refresh } = useApiResource('/api/catalogue', []);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentItem, setCurrentItem] = useState(ARTICLE_VIDE);
  const [recherche, setRecherche] = useState('');
  const [modalError, setModalError] = useState(null);
  const [saving, setSaving] = useState(false);

  const itemsFiltres = useMemo(() => {
    const terme = recherche.trim().toLowerCase();
    if (!terme) return items;
    return items.filter((i) => [i.nom, i.description]
      .some((champ) => (champ || '').toLowerCase().includes(terme)));
  }, [items, recherche]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setModalError(null);

    try {
      const payload = {
        nom: currentItem.nom,
        description: currentItem.description,
        prix_unitaire: parseFloat(currentItem.prix_unitaire) || 0
      };
      // Le résultat du serveur n'était pas vérifié : un enregistrement refusé
      // fermait quand même la fenêtre, sans rien signaler.
      if (currentItem.id) await api.put(`/api/catalogue/${currentItem.id}`, payload);
      else await api.post('/api/catalogue', payload);

      setIsModalOpen(false);
      refresh();
    } catch (err) {
      setModalError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`Supprimer « ${item.nom} » du catalogue ?`)) return;
    try {
      setError(null);
      await api.del(`/api/catalogue/${item.id}`);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  const openModal = (item = null) => {
    setCurrentItem(item ? { ...item } : ARTICLE_VIDE);
    setModalError(null);
    setIsModalOpen(true);
  };

  return (
    <div className="glass-panel" style={{ padding: '20px' }}>
      {error && <p className="alert alert-error" role="alert">{error}</p>}

      <div className="toolbar">
        <div className="toolbar-group">
          <input
            type="search"
            className="search-input"
            placeholder="Rechercher un service…"
            aria-label="Rechercher un service"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />
        </div>
        <button type="button" className="btn-primary" onClick={() => openModal()}>+ Nouveau service</button>
      </div>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Nom du service</th>
              <th>Description</th>
              <th className="numeric">Prix / tarif</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="4" className="empty-state">Chargement…</td></tr>
            ) : itemsFiltres.length === 0 ? (
              <tr>
                <td colSpan="4" className="empty-state">
                  {items.length === 0 ? 'Votre catalogue est vide.' : 'Aucun service ne correspond à votre recherche.'}
                </td>
              </tr>
            ) : itemsFiltres.map((item) => (
              <tr key={item.id}>
                <td style={{ fontWeight: '500' }}>{item.nom}</td>
                <td style={{ color: 'var(--text-muted)' }}>{item.description}</td>
                <td className="numeric">{formatMontant(item.prix_unitaire)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button type="button" className="btn-icon" onClick={() => openModal(item)} aria-label={`Modifier ${item.nom}`} style={{ marginRight: '5px' }}>✏️</button>
                  <button type="button" className="btn-danger" onClick={() => handleDelete(item)} aria-label={`Supprimer ${item.nom}`}>🗑️</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={currentItem.id ? 'Modifier le service' : 'Ajouter un service'}>
          <div className="modal-content glass-panel">
            <h3 style={{ marginTop: 0 }}>{currentItem.id ? 'Modifier le service' : 'Ajouter un service'}</h3>

            {modalError && <p className="alert alert-error" role="alert">{modalError}</p>}

            <form onSubmit={handleSave}>
              <div className="form-group">
                <label htmlFor="service-nom">Nom du service *</label>
                <input id="service-nom" type="text" className="form-control" value={currentItem.nom} onChange={(e) => setCurrentItem({ ...currentItem, nom: e.target.value })} required autoFocus />
              </div>
              <div className="form-group">
                <label htmlFor="service-description">Description</label>
                <textarea id="service-description" className="form-control" value={currentItem.description || ''} onChange={(e) => setCurrentItem({ ...currentItem, description: e.target.value })} rows="3" />
              </div>
              <div className="form-group">
                <label htmlFor="service-prix">Prix ou tarif ($) *</label>
                <input id="service-prix" type="number" step="0.01" min="0" className="form-control" value={currentItem.prix_unitaire} onChange={(e) => setCurrentItem({ ...currentItem, prix_unitaire: e.target.value })} required />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                <button type="button" className="btn-secondary" onClick={() => setIsModalOpen(false)} disabled={saving}>Annuler</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Sauvegarde…' : 'Sauvegarder'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default CatalogueList;
