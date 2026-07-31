import { useState, useMemo } from 'react';
import { Plus, Trash2, Calendar, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import { api, formatMontant } from '../api';
import { useApiResource } from '../useApiResource';
import { usePagination } from '../usePagination';
import Pagination from './Pagination';
import { useTri } from '../useTri';
import EnTeteTri from './EnTeteTri';

let compteurLignes = 0;
const nouvelleLigne = (valeurs = {}) => ({
  cle: `abo-ligne-${++compteurLignes}`,
  description: '',
  quantite: 1,
  prix_unitaire: 0,
  ...valeurs
});

function abonnementVide() {
  return {
    client_id: '',
    titre: 'Abonnement mensuel',
    cycle: 'Mensuel',
    date_prochaine_generation: new Date().toISOString().split('T')[0],
    devise: 'CAD',
    lignes: [nouvelleLigne({ description: 'Services professionnels', prix_unitaire: 100 })]
  };
}

function SubscriptionList() {
  const abonnementsRes = useApiResource('/api/abonnements', []);
  const clientsRes = useApiResource('/api/clients', []);

  const [recherche, setRecherche] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [newSub, setNewSub] = useState(abonnementVide);
  const [erreurAction, setErreurAction] = useState(null);
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);

  const tousLesAbonnements = abonnementsRes.data;

  // Seul écran de liste sans recherche : au-delà d'une dizaine d'abonnements,
  // il fallait parcourir le tableau des yeux.
  const subs = useMemo(() => {
    const terme = recherche.trim().toLowerCase();
    if (!terme) return tousLesAbonnements;
    return tousLesAbonnements.filter((s) => (s.titre || '').toLowerCase().includes(terme)
      || (s.client_nom || '').toLowerCase().includes(terme));
  }, [tousLesAbonnements, recherche]);

  // Par défaut, l'échéance la plus proche en premier : c'est ce qu'on vient
  // vérifier sur cet écran.
  const { tri, basculer, tries: subsTries } = useTri(subs, { defaut: 'date_prochaine_generation' });
  const { affiches: subsAffiches, pagination } = usePagination(subsTries, 15);
  const clients = clientsRes.data;
  const loading = abonnementsRes.loading || clientsRes.loading;
  const error = erreurAction || abonnementsRes.error || clientsRes.error;

  const fetchData = () => {
    abonnementsRes.refresh();
    clientsRes.refresh();
  };

  const handleLineChange = (index, champs) => {
    setNewSub((prev) => ({
      ...prev,
      lignes: prev.lignes.map((l, i) => (i === index ? { ...l, ...champs } : l))
    }));
  };

  const handleAddLine = () => {
    setNewSub((prev) => ({ ...prev, lignes: [...prev.lignes, nouvelleLigne()] }));
  };

  const handleRemoveLine = (index) => {
    setNewSub((prev) => (prev.lignes.length > 1
      ? { ...prev, lignes: prev.lignes.filter((_, i) => i !== index) }
      : prev));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErreurAction(null);

    try {
      await api.post('/api/abonnements', {
        client_id: newSub.client_id,
        titre: newSub.titre,
        cycle: newSub.cycle,
        date_prochaine_generation: newSub.date_prochaine_generation,
        devise: newSub.devise,
        lignes_json: JSON.stringify(newSub.lignes.map((l) => ({
          description: l.description,
          quantite: parseFloat(l.quantite) || 0,
          prix_unitaire: parseFloat(l.prix_unitaire) || 0
        })))
      });
      setShowForm(false);
      setNewSub(abonnementVide());
      setMessage('Abonnement créé.');
      fetchData();
    } catch (err) {
      setErreurAction(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleStatut = async (sub) => {
    try {
      setErreurAction(null);
      // Seul le statut est transmis : la mise à jour est partielle côté serveur,
      // les lignes et le cycle sont conservés.
      await api.put(`/api/abonnements/${sub.id}`, { statut: sub.statut === 'Actif' ? 'Inactif' : 'Actif' });
      fetchData();
    } catch (err) {
      setErreurAction(err.message);
    }
  };

  const handleDelete = async (sub) => {
    if (!window.confirm(`Supprimer l'abonnement « ${sub.titre} » ?`)) return;
    try {
      setErreurAction(null);
      await api.del(`/api/abonnements/${sub.id}`);
      fetchData();
    } catch (err) {
      setErreurAction(err.message);
    }
  };

  /** Déclenche immédiatement la génération des factures dues. */
  const genererMaintenant = async () => {
    try {
      setErreurAction(null);
      setMessage(null);
      await api.post('/api/abonnements/generer');
      setMessage('Vérification effectuée. Les factures dues ont été générées.');
      fetchData();
    } catch (err) {
      setErreurAction(err.message);
    }
  };

  const aujourdhui = new Date().toISOString().split('T')[0];

  const totalLignes = newSub.lignes.reduce(
    (sum, l) => sum + ((parseFloat(l.quantite) || 0) * (parseFloat(l.prix_unitaire) || 0)), 0
  );

  if (loading) return <p style={{ color: 'var(--text-muted)' }}>Chargement…</p>;

  return (
    <div>
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      {message && <p className="alert alert-success" role="status">{message}</p>}

      <div className="toolbar">
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem', maxWidth: '540px' }}>
          Les factures dues sont générées automatiquement, toutes les heures tant que
          l'application est ouverte. Chaque période échue produit sa propre facture.
        </p>
        <div className="toolbar-group">
          <button type="button" className="btn-secondary" onClick={genererMaintenant} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <RefreshCw size={16} aria-hidden="true" /> Générer maintenant
          </button>
          <button type="button" className="btn-primary" onClick={() => setShowForm(!showForm)} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={18} aria-hidden="true" /> {showForm ? 'Annuler' : 'Nouvel abonnement'}
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="glass-panel" style={{ padding: '20px', marginBottom: '30px' }}>
          <h3 style={{ margin: '0 0 15px 0' }}>Créer un abonnement</h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '15px', marginBottom: '20px' }}>
            <div className="form-group">
              <label htmlFor="abo-client">Client *</label>
              <select id="abo-client" className="form-control" value={newSub.client_id} onChange={(e) => setNewSub({ ...newSub, client_id: e.target.value })} required>
                <option value="">Sélectionner un client…</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.nom_entreprise}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="abo-titre">Titre de l'abonnement *</label>
              <input id="abo-titre" type="text" className="form-control" value={newSub.titre} onChange={(e) => setNewSub({ ...newSub, titre: e.target.value })} required />
            </div>
            <div className="form-group">
              <label htmlFor="abo-devise">Devise</label>
              <select id="abo-devise" className="form-control" value={newSub.devise} onChange={(e) => setNewSub({ ...newSub, devise: e.target.value })}>
                <option value="CAD">CAD</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="abo-cycle">Cycle</label>
              <select id="abo-cycle" className="form-control" value={newSub.cycle} onChange={(e) => setNewSub({ ...newSub, cycle: e.target.value })}>
                <option value="Mensuel">Mensuel</option>
                <option value="Annuel">Annuel</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="abo-date">Prochaine génération *</label>
              <input id="abo-date" type="date" className="form-control" value={newSub.date_prochaine_generation} onChange={(e) => setNewSub({ ...newSub, date_prochaine_generation: e.target.value })} required />
            </div>
          </div>

          <h4 style={{ margin: '0 0 10px 0' }}>Lignes de la facture à générer</h4>
          {newSub.lignes.map((ligne, i) => (
            <div key={ligne.cle} style={{ display: 'flex', gap: '10px', marginBottom: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="text" className="form-control" style={{ flex: 2, minWidth: '220px' }}
                placeholder="Description (ex. : hébergement web)"
                aria-label={`Description de la ligne ${i + 1}`}
                value={ligne.description}
                onChange={(e) => handleLineChange(i, { description: e.target.value })}
                required
              />
              <input
                type="number" className="form-control" style={{ flex: 1, minWidth: '90px' }}
                min="0.01" step="0.01" placeholder="Qté"
                aria-label={`Quantité de la ligne ${i + 1}`}
                value={ligne.quantite}
                onChange={(e) => handleLineChange(i, { quantite: e.target.value })}
                required
              />
              <input
                type="number" className="form-control" style={{ flex: 1, minWidth: '110px' }}
                min="0" step="0.01" placeholder="Prix"
                aria-label={`Prix unitaire de la ligne ${i + 1}`}
                value={ligne.prix_unitaire}
                onChange={(e) => handleLineChange(i, { prix_unitaire: e.target.value })}
                required
              />
              <button
                type="button" className="btn-danger"
                onClick={() => handleRemoveLine(i)}
                disabled={newSub.lignes.length === 1}
                aria-label={`Supprimer la ligne ${i + 1}`}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
          ))}
          <button type="button" className="btn-secondary" style={{ marginTop: '10px' }} onClick={handleAddLine}>
            + Ajouter une ligne
          </button>

          <div style={{ textAlign: 'right', marginTop: '20px' }}>
            <p style={{ margin: '0 0 10px 0', color: 'var(--text-muted)' }}>
              Sous-total hors taxes par facture : <strong style={{ color: 'var(--text-main)' }}>{formatMontant(totalLignes, newSub.devise)}</strong>
            </p>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Enregistrement…' : "Enregistrer l'abonnement"}
            </button>
          </div>
        </form>
      )}

      <div className="glass-panel" style={{ padding: '20px' }}>
        <div className="toolbar-group" style={{ marginBottom: '15px' }}>
          <label htmlFor="recherche-abonnement" style={{ position: 'absolute', left: '-9999px' }}>
            Rechercher un abonnement
          </label>
          <input
            id="recherche-abonnement"
            type="search"
            className="search-input"
            placeholder="Rechercher un titre ou un client…"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />
          <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            {subs.length} abonnement{subs.length > 1 ? 's' : ''}
          </span>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <EnTeteTri colonne="client_nom" tri={tri} onTrier={basculer}>Client</EnTeteTri>
                <EnTeteTri colonne="titre" tri={tri} onTrier={basculer}>Titre</EnTeteTri>
                <EnTeteTri colonne="cycle" tri={tri} onTrier={basculer} style={{ textAlign: 'center' }}>Cycle</EnTeteTri>
                <EnTeteTri colonne="date_prochaine_generation" tri={tri} onTrier={basculer} style={{ textAlign: 'center' }}>
                  Prochaine date
                </EnTeteTri>
                <EnTeteTri colonne="statut" tri={tri} onTrier={basculer} style={{ textAlign: 'center' }}>Statut</EnTeteTri>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {subs.length === 0 ? (
                <tr><td colSpan="6" className="empty-state">Aucun abonnement configuré.</td></tr>
              ) : subsAffiches.map((sub) => {
                const enRetard = sub.statut === 'Actif' && sub.date_prochaine_generation <= aujourdhui;
                return (
                  <tr key={sub.id} style={{ opacity: sub.statut === 'Inactif' ? 0.6 : 1 }}>
                    <td style={{ fontWeight: 'bold' }}>{sub.client_nom}</td>
                    <td>
                      {sub.titre}
                      <br />
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{sub.devise}</span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className="status-badge">
                        <Calendar size={12} style={{ marginRight: '4px', display: 'inline' }} aria-hidden="true" />
                        {sub.cycle}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center', color: enRetard ? 'var(--status-danger)' : 'inherit' }}>
                      {sub.date_prochaine_generation}
                      {enRetard && <div style={{ fontSize: '0.75rem' }}>À générer</div>}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {sub.statut === 'Actif' ? (
                        <span style={{ color: 'var(--status-paid)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <CheckCircle size={16} aria-hidden="true" /> Actif
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <XCircle size={16} aria-hidden="true" /> Inactif
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button type="button" className="btn-icon" onClick={() => toggleStatut(sub)} style={{ marginRight: '8px' }}>
                        {sub.statut === 'Actif' ? 'Désactiver' : 'Activer'}
                      </button>
                      <button type="button" className="btn-danger" onClick={() => handleDelete(sub)} aria-label={`Supprimer ${sub.titre}`}>
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination {...pagination} />
      </div>
    </div>
  );
}

export default SubscriptionList;
