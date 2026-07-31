import { useState, useMemo } from 'react';
import InfoTooltip from './InfoTooltip';
import { api, formatMontant } from '../api';
import { useApiResource } from '../useApiResource';
import { useModale } from '../useModale';

const CATEGORIES = [
  'Matériel',
  'Logiciels et abonnements',
  'Sous-traitance',
  "Repas d'affaires",
  'Frais de déplacement',
  'Fournitures de bureau',
  'Autres dépenses'
];

const AUTRES = 'Autres dépenses';

function depenseVide() {
  return {
    fournisseur: '',
    description: '',
    date_depense: new Date().toISOString().split('T')[0],
    montant_ht: 0,
    tps: 0,
    tvq: 0,
    categorie: CATEGORIES[0],
    autre_categorie: ''
  };
}

function ExpenseList() {
  const { data: expenses, loading, error, setError, refresh } = useApiResource('/api/depenses', []);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const modaleRef = useModale(() => setIsModalOpen(false), { actif: isModalOpen });
  const [currentExpense, setCurrentExpense] = useState(depenseVide());
  const [modalError, setModalError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [recherche, setRecherche] = useState('');

  const depensesFiltrees = useMemo(() => {
    const terme = recherche.trim().toLowerCase();
    if (!terme) return expenses;
    return expenses.filter((d) => [d.fournisseur, d.description, d.categorie]
      .some((champ) => (champ || '').toLowerCase().includes(terme)));
  }, [expenses, recherche]);

  // Totaux de la sélection affichée : utile au moment de préparer une déclaration.
  const totaux = useMemo(() => depensesFiltrees.reduce((acc, d) => ({
    ht: acc.ht + (Number(d.montant_ht) || 0),
    taxes: acc.taxes + (Number(d.tps) || 0) + (Number(d.tvq) || 0),
    ttc: acc.ttc + (Number(d.montant_ttc) || 0)
  }), { ht: 0, taxes: 0, ttc: 0 }), [depensesFiltrees]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setModalError(null);

    const categorie = currentExpense.categorie === AUTRES
      ? (currentExpense.autre_categorie || AUTRES)
      : currentExpense.categorie;

    const payload = {
      fournisseur: currentExpense.fournisseur,
      description: currentExpense.description,
      date_depense: currentExpense.date_depense,
      montant_ht: parseFloat(currentExpense.montant_ht) || 0,
      tps: parseFloat(currentExpense.tps) || 0,
      tvq: parseFloat(currentExpense.tvq) || 0,
      categorie
      // Le total TTC est recalculé par le serveur à partir de ces trois montants.
    };

    try {
      if (currentExpense.id) await api.put(`/api/depenses/${currentExpense.id}`, payload);
      else await api.post('/api/depenses', payload);

      setIsModalOpen(false);
      refresh();
    } catch (err) {
      setModalError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (depense) => {
    if (!window.confirm(`Supprimer la dépense « ${depense.fournisseur || depense.description} » ?`)) return;
    try {
      setError(null);
      await api.del(`/api/depenses/${depense.id}`);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  const openModal = (expense = null) => {
    if (expense) {
      const predefinie = CATEGORIES.includes(expense.categorie);
      setCurrentExpense({
        ...expense,
        categorie: predefinie ? expense.categorie : AUTRES,
        autre_categorie: predefinie ? '' : expense.categorie
      });
    } else {
      setCurrentExpense(depenseVide());
    }
    setModalError(null);
    setIsModalOpen(true);
  };

  const totalModale = (parseFloat(currentExpense.montant_ht) || 0)
    + (parseFloat(currentExpense.tps) || 0)
    + (parseFloat(currentExpense.tvq) || 0);

  return (
    <div className="glass-panel" style={{ padding: '20px' }}>
      {error && <p className="alert alert-error" role="alert">{error}</p>}

      <div className="toolbar">
        <div className="toolbar-group">
          <input
            type="search"
            className="search-input"
            placeholder="Rechercher un fournisseur ou une catégorie…"
            aria-label="Rechercher une dépense"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />
        </div>
        <button type="button" className="btn-primary" onClick={() => openModal()}>+ Nouvelle dépense</button>
      </div>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Fournisseur</th>
              <th>Description</th>
              <th>Catégorie</th>
              <th className="numeric">
                Montant HT
                <InfoTooltip text="Hors taxes : le montant avant application des taxes." />
              </th>
              <th className="numeric">
                Taxes (CTI/RTI)
                <InfoTooltip text="Les taxes payées sur vos achats, que vous pouvez réclamer (crédit ou remboursement de la taxe sur les intrants)." />
              </th>
              <th className="numeric">
                Total TTC
                <InfoTooltip text="Toutes taxes comprises : le montant final payé." />
              </th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="8" className="empty-state">Chargement…</td></tr>
            ) : depensesFiltrees.length === 0 ? (
              <tr>
                <td colSpan="8" className="empty-state">
                  {expenses.length === 0 ? 'Aucune dépense enregistrée.' : 'Aucune dépense ne correspond à votre recherche.'}
                </td>
              </tr>
            ) : depensesFiltrees.map((expense) => (
              <tr key={expense.id}>
                <td style={{ color: 'var(--text-muted)' }}>{expense.date_depense}</td>
                <td style={{ fontWeight: '500' }}>{expense.fournisseur}</td>
                <td style={{ color: 'var(--text-muted)' }}>{expense.description}</td>
                <td><span className="status-badge">{expense.categorie}</span></td>
                <td className="numeric">{formatMontant(expense.montant_ht)}</td>
                <td className="numeric" style={{ color: '#8b5cf6' }}>
                  {formatMontant((expense.tps || 0) + (expense.tvq || 0))}
                </td>
                <td className="numeric" style={{ fontWeight: 'bold' }}>{formatMontant(expense.montant_ttc)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button type="button" className="btn-icon" onClick={() => openModal(expense)} aria-label="Modifier la dépense" style={{ marginRight: '5px' }}>✏️</button>
                  <button type="button" className="btn-danger" onClick={() => handleDelete(expense)} aria-label="Supprimer la dépense">🗑️</button>
                </td>
              </tr>
            ))}
          </tbody>
          {depensesFiltrees.length > 0 && (
            <tfoot>
              <tr style={{ fontWeight: 'bold' }}>
                <td colSpan="4" style={{ paddingTop: '14px' }}>Total ({depensesFiltrees.length} dépense{depensesFiltrees.length > 1 ? 's' : ''})</td>
                <td className="numeric" style={{ paddingTop: '14px' }}>{formatMontant(totaux.ht)}</td>
                <td className="numeric" style={{ paddingTop: '14px', color: '#8b5cf6' }}>{formatMontant(totaux.taxes)}</td>
                <td className="numeric" style={{ paddingTop: '14px' }}>{formatMontant(totaux.ttc)}</td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {isModalOpen && (
        <div ref={modaleRef} className="modal-overlay" role="dialog" aria-modal="true" aria-label={currentExpense.id ? 'Modifier la dépense' : 'Ajouter une dépense'}>
          <div className="modal-content glass-panel" style={{ maxWidth: '620px', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ marginTop: 0 }}>{currentExpense.id ? 'Modifier la dépense' : 'Ajouter une dépense'}</h3>

            {modalError && <p className="alert alert-error" role="alert">{modalError}</p>}

            <form onSubmit={handleSave}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                <div className="form-group">
                  <label htmlFor="depense-date">Date de la dépense *</label>
                  <input id="depense-date" type="date" className="form-control" value={currentExpense.date_depense} onChange={(e) => setCurrentExpense({ ...currentExpense, date_depense: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label htmlFor="depense-fournisseur">Fournisseur *</label>
                  <input id="depense-fournisseur" type="text" className="form-control" value={currentExpense.fournisseur} onChange={(e) => setCurrentExpense({ ...currentExpense, fournisseur: e.target.value })} required />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="depense-description">Description</label>
                <input id="depense-description" type="text" className="form-control" value={currentExpense.description || ''} onChange={(e) => setCurrentExpense({ ...currentExpense, description: e.target.value })} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                <div className="form-group">
                  <label htmlFor="depense-categorie">Catégorie</label>
                  <select id="depense-categorie" className="form-control" value={currentExpense.categorie} onChange={(e) => setCurrentExpense({ ...currentExpense, categorie: e.target.value })}>
                    {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </div>
                {currentExpense.categorie === AUTRES && (
                  <div className="form-group">
                    <label htmlFor="depense-autre">Précisez la catégorie *</label>
                    <input id="depense-autre" type="text" className="form-control" value={currentExpense.autre_categorie} onChange={(e) => setCurrentExpense({ ...currentExpense, autre_categorie: e.target.value })} required />
                  </div>
                )}
              </div>

              <h4 style={{ marginTop: '20px', marginBottom: '10px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '5px' }}>
                Montants (reprenez les taxes exactes du reçu)
              </h4>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '15px' }}>
                <div className="form-group">
                  <label htmlFor="depense-ht">
                    Montant HT ($) *
                    <InfoTooltip text="Hors taxes : le montant avant application des taxes." />
                  </label>
                  <input id="depense-ht" type="number" step="0.01" min="0" className="form-control" value={currentExpense.montant_ht} onChange={(e) => setCurrentExpense({ ...currentExpense, montant_ht: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label htmlFor="depense-tps">TPS / TVH ($)</label>
                  <input id="depense-tps" type="number" step="0.01" min="0" className="form-control" value={currentExpense.tps} onChange={(e) => setCurrentExpense({ ...currentExpense, tps: e.target.value })} />
                </div>
                <div className="form-group">
                  <label htmlFor="depense-tvq">TVQ / TVP ($)</label>
                  <input id="depense-tvq" type="number" step="0.01" min="0" className="form-control" value={currentExpense.tvq} onChange={(e) => setCurrentExpense({ ...currentExpense, tvq: e.target.value })} />
                </div>
              </div>

              <div style={{ padding: '15px', background: 'var(--glass-bg)', borderRadius: '8px', marginTop: '10px', textAlign: 'right' }}>
                <strong>
                  Total TTC
                  <InfoTooltip text="Toutes taxes comprises : le montant final payé." />
                  {' : '}
                </strong>
                <span style={{ fontSize: '1.2rem', color: 'var(--text-main)', fontWeight: 'bold' }}>
                  {formatMontant(totalModale)}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                <button type="button" className="btn-secondary" onClick={() => setIsModalOpen(false)} disabled={saving}>Annuler</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default ExpenseList;
