import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Calendar, CheckCircle, XCircle } from 'lucide-react';

function SubscriptionList() {
  const [subs, setSubs] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  
  const [newSub, setNewSub] = useState({
    client_id: '',
    titre: 'Abonnement Mensuel',
    cycle: 'Mensuel',
    date_prochaine_generation: new Date().toISOString().split('T')[0],
    devise: 'CAD',
    lignes: [{ description: 'Services professionnels', quantite: 1, prix_unitaire: 100 }]
  });

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      const [rSubs, rClients] = await Promise.all([
        fetch('/api/abonnements'), fetch('/api/clients')
      ]);
      setSubs(await rSubs.json());
      setClients(await rClients.json());
      setLoading(false);
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  };

  const handleAddLine = () => {
    setNewSub({ ...newSub, lignes: [...newSub.lignes, { description: '', quantite: 1, prix_unitaire: 0 }] });
  };

  const handleLineChange = (index, field, value) => {
    const newLignes = [...newSub.lignes];
    newLignes[index][field] = field === 'description' ? value : parseFloat(value) || 0;
    setNewSub({ ...newSub, lignes: newLignes });
  };

  const handleRemoveLine = (index) => {
    setNewSub({ ...newSub, lignes: newSub.lignes.filter((_, i) => i !== index) });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!newSub.client_id) return alert("Sélectionnez un client");
    
    try {
      const res = await fetch('/api/abonnements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newSub,
          lignes_json: JSON.stringify(newSub.lignes)
        })
      });
      if (res.ok) {
        setShowForm(false);
        fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const toggleStatut = async (sub) => {
    const newStatut = sub.statut === 'Actif' ? 'Inactif' : 'Actif';
    await fetch(`/api/abonnements/${sub.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...sub, statut: newStatut })
    });
    fetchData();
  };

  const handleDelete = async (id) => {
    if(!window.confirm("Êtes-vous sûr de vouloir supprimer cet abonnement ?")) return;
    await fetch(`/api/abonnements/${id}`, { method: 'DELETE' });
    fetchData();
  };

  if (loading) return <p>Chargement...</p>;

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
        <h2 style={{ color: 'var(--text-main)', margin: 0 }}>Facturation Récurrente</h2>
        <button className="btn-primary" onClick={() => setShowForm(!showForm)} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Plus size={18} /> {showForm ? 'Annuler' : 'Nouvel Abonnement'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="glass-panel" style={{ padding: '20px', marginBottom: '30px' }}>
          <h3 style={{ margin: '0 0 15px 0' }}>Créer un Abonnement</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '15px', marginBottom: '20px' }}>
            <div className="form-group">
              <label>Client</label>
              <select className="form-control" value={newSub.client_id} onChange={(e) => setNewSub({...newSub, client_id: e.target.value})} required>
                <option value="">Sélectionner un client...</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.nom_entreprise}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Titre de l'abonnement</label>
              <input type="text" className="form-control" value={newSub.titre} onChange={(e) => setNewSub({...newSub, titre: e.target.value})} required />
            </div>
            <div className="form-group">
              <label>Devise</label>
              <select className="form-control" value={newSub.devise} onChange={(e) => setNewSub({...newSub, devise: e.target.value})}>
                <option value="CAD">CAD</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div className="form-group">
              <label>Cycle</label>
              <select className="form-control" value={newSub.cycle} onChange={(e) => setNewSub({...newSub, cycle: e.target.value})}>
                <option value="Mensuel">Mensuel</option>
                <option value="Annuel">Annuel</option>
              </select>
            </div>
            <div className="form-group">
              <label>Prochaine Date de Génération</label>
              <input type="date" className="form-control" value={newSub.date_prochaine_generation} onChange={(e) => setNewSub({...newSub, date_prochaine_generation: e.target.value})} required />
            </div>
          </div>

          <h4 style={{ margin: '0 0 10px 0' }}>Lignes de la facture à générer</h4>
          {newSub.lignes.map((ligne, i) => (
            <div key={i} style={{ display: 'flex', gap: '10px', marginBottom: '10px', alignItems: 'center' }}>
              <input type="text" className="form-control" style={{ flex: 2 }} placeholder="Description (ex: Hébergement web)" value={ligne.description} onChange={(e) => handleLineChange(i, 'description', e.target.value)} required />
              <input type="number" className="form-control" style={{ flex: 1 }} min="1" placeholder="Qté" value={ligne.quantite} onChange={(e) => handleLineChange(i, 'quantite', e.target.value)} required />
              <input type="number" className="form-control" style={{ flex: 1 }} step="0.01" placeholder="Prix" value={ligne.prix_unitaire} onChange={(e) => handleLineChange(i, 'prix_unitaire', e.target.value)} required />
              <button type="button" className="btn-secondary" style={{ padding: '8px', color: '#ef4444' }} onClick={() => handleRemoveLine(i)}><Trash2 size={16} /></button>
            </div>
          ))}
          <button type="button" className="btn-secondary" style={{ marginTop: '10px' }} onClick={handleAddLine}>+ Ajouter une ligne</button>
          
          <div style={{ textAlign: 'right', marginTop: '20px' }}>
            <button type="submit" className="btn-primary">Enregistrer l'abonnement</button>
          </div>
        </form>
      )}

      <div className="glass-panel" style={{ overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'rgba(0,0,0,0.02)', borderBottom: '2px solid var(--glass-border)' }}>
              <th style={{ padding: '12px 15px', textAlign: 'left' }}>Client</th>
              <th style={{ padding: '12px 15px', textAlign: 'left' }}>Titre</th>
              <th style={{ padding: '12px 15px', textAlign: 'center' }}>Cycle</th>
              <th style={{ padding: '12px 15px', textAlign: 'center' }}>Prochaine Date</th>
              <th style={{ padding: '12px 15px', textAlign: 'center' }}>Statut</th>
              <th style={{ padding: '12px 15px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {subs.length === 0 ? (
              <tr><td colSpan="6" style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>Aucun abonnement configuré.</td></tr>
            ) : (
              subs.map(sub => (
                <tr key={sub.id} style={{ borderBottom: '1px solid var(--glass-border)', opacity: sub.statut === 'Inactif' ? 0.6 : 1 }}>
                  <td style={{ padding: '12px 15px', fontWeight: 'bold' }}>{sub.client_nom}</td>
                  <td style={{ padding: '12px 15px' }}>{sub.titre} <br/><span style={{fontSize: '0.8rem', color: 'var(--text-muted)'}}>{sub.devise}</span></td>
                  <td style={{ padding: '12px 15px', textAlign: 'center' }}>
                    <span style={{ padding: '4px 8px', borderRadius: '12px', fontSize: '0.8rem', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                      <Calendar size={12} style={{ marginRight: '4px', display: 'inline' }} />
                      {sub.cycle}
                    </span>
                  </td>
                  <td style={{ padding: '12px 15px', textAlign: 'center', color: sub.statut === 'Actif' && new Date(sub.date_prochaine_generation) <= new Date() ? '#ef4444' : 'inherit' }}>
                    {sub.date_prochaine_generation}
                    {sub.statut === 'Actif' && new Date(sub.date_prochaine_generation) <= new Date() && (
                      <div style={{fontSize: '0.75rem'}}>Générée au redémarrage</div>
                    )}
                  </td>
                  <td style={{ padding: '12px 15px', textAlign: 'center' }}>
                    {sub.statut === 'Actif' ? 
                      <span style={{ color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}><CheckCircle size={16}/> Actif</span> : 
                      <span style={{ color: '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}><XCircle size={16}/> Inactif</span>
                    }
                  </td>
                  <td style={{ padding: '12px 15px', textAlign: 'right' }}>
                    <button className="btn-secondary" onClick={() => toggleStatut(sub)} style={{ marginRight: '8px', padding: '6px 12px' }}>
                      {sub.statut === 'Actif' ? 'Désactiver' : 'Activer'}
                    </button>
                    <button className="btn-secondary" onClick={() => handleDelete(sub.id)} style={{ color: '#ef4444', borderColor: '#ef4444', padding: '6px 12px' }}>
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default SubscriptionList;
