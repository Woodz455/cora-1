import React, { useState, useEffect } from 'react';
import InfoTooltip from './InfoTooltip';

const PREDEFINED_CATEGORIES = [
  'Matériel',
  'Logiciels et abonnements',
  'Sous-traitance',
  'Repas d\'affaires',
  'Frais de déplacement',
  'Fournitures de bureau',
  'Autres dépenses'
];

function ExpenseList() {
  const [expenses, setExpenses] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentExpense, setCurrentExpense] = useState(getEmptyExpense());

  function getEmptyExpense() {
    return { 
      fournisseur: '', 
      description: '', 
      date_depense: new Date().toISOString().split('T')[0], 
      montant_ht: 0, 
      tps: 0, 
      tvq: 0, 
      categorie: PREDEFINED_CATEGORIES[0],
      autre_categorie: ''
    };
  }

  const fetchExpenses = async () => {
    const response = await fetch('/api/depenses');
    const data = await response.json();
    setExpenses(data);
  };

  useEffect(() => {
    fetchExpenses();
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    
    // Si la catégorie est "Autres", on utilise le champ texte libre
    const finalCategory = currentExpense.categorie === 'Autres dépenses' 
      ? currentExpense.autre_categorie || 'Autres dépenses'
      : currentExpense.categorie;

    const montant_ht = parseFloat(currentExpense.montant_ht) || 0;
    const tps = parseFloat(currentExpense.tps) || 0;
    const tvq = parseFloat(currentExpense.tvq) || 0;
    const montant_ttc = montant_ht + tps + tvq;

    const payload = {
      ...currentExpense,
      montant_ht,
      tps,
      tvq,
      montant_ttc,
      categorie: finalCategory
    };

    const url = currentExpense.id ? `/api/depenses/${currentExpense.id}` : '/api/depenses';
    const method = currentExpense.id ? 'PUT' : 'POST';

    await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    setIsModalOpen(false);
    fetchExpenses();
  };

  const handleDelete = async (id) => {
    if (window.confirm('Voulez-vous vraiment supprimer cette dépense ?')) {
      await fetch(`/api/depenses/${id}`, { method: 'DELETE' });
      fetchExpenses();
    }
  };

  const openModal = (expense = null) => {
    if (expense) {
      const isPredefined = PREDEFINED_CATEGORIES.includes(expense.categorie);
      setCurrentExpense({
        ...expense,
        categorie: isPredefined ? expense.categorie : 'Autres dépenses',
        autre_categorie: isPredefined ? '' : expense.categorie
      });
    } else {
      setCurrentExpense(getEmptyExpense());
    }
    setIsModalOpen(true);
  };

  const formatCurrency = (amount) => Number(amount || 0).toFixed(2) + ' $';

  return (
    <div className="glass-panel" style={{ padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
        <h2>Suivi des Dépenses & Achats</h2>
        <button className="btn-primary" onClick={() => openModal()}>+ Nouvelle Dépense</button>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--border-color)', textAlign: 'left' }}>
            <th style={{ padding: '10px' }}>Date</th>
            <th style={{ padding: '10px' }}>Fournisseur</th>
            <th style={{ padding: '10px' }}>Description</th>
            <th style={{ padding: '10px' }}>Catégorie</th>
            <th style={{ padding: '10px', textAlign: 'right' }}>
              Montant HT
              <InfoTooltip text="Hors Taxes : Le montant avant l'application des taxes." />
            </th>
            <th style={{ padding: '10px', textAlign: 'right' }}>
              Taxes (CTI/RTI)
              <InfoTooltip text="CTI / RTI : Les taxes payées sur vos achats que vous pouvez réclamer (Crédit/Remboursement de la Taxe sur les Intrants)." />
            </th>
            <th style={{ padding: '10px', textAlign: 'right' }}>
              Total TTC
              <InfoTooltip text="Toutes Taxes Comprises : Le montant final payé, incluant les taxes." />
            </th>
            <th style={{ padding: '10px', textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {expenses.map(expense => (
            <tr key={expense.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
              <td style={{ padding: '10px', color: 'var(--text-muted)' }}>{expense.date_depense}</td>
              <td style={{ padding: '10px', fontWeight: '500' }}>{expense.fournisseur}</td>
              <td style={{ padding: '10px', color: 'var(--text-muted)' }}>{expense.description}</td>
              <td style={{ padding: '10px' }}>
                <span style={{ background: 'var(--glass-bg)', padding: '4px 8px', borderRadius: '4px', fontSize: '0.85rem' }}>
                  {expense.categorie}
                </span>
              </td>
              <td style={{ padding: '10px', textAlign: 'right' }}>{formatCurrency(expense.montant_ht)}</td>
              <td style={{ padding: '10px', textAlign: 'right', color: '#8b5cf6' }}>
                {formatCurrency((expense.tps || 0) + (expense.tvq || 0))}
              </td>
              <td style={{ padding: '10px', textAlign: 'right', fontWeight: 'bold' }}>{formatCurrency(expense.montant_ttc)}</td>
              <td style={{ padding: '10px', textAlign: 'right' }}>
                <button className="btn-secondary" onClick={() => openModal(expense)} style={{ marginRight: '5px' }}>✏️</button>
                <button className="btn-secondary" onClick={() => handleDelete(expense.id)} style={{ color: '#ef4444' }}>🗑️</button>
              </td>
            </tr>
          ))}
          {expenses.length === 0 && (
            <tr>
              <td colSpan="8" style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                Aucune dépense enregistrée.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '600px' }}>
            <h3>{currentExpense.id ? 'Modifier la dépense' : 'Ajouter une dépense'}</h3>
            <form onSubmit={handleSave}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                <div className="form-group">
                  <label>Date de la dépense *</label>
                  <input type="date" className="form-control" value={currentExpense.date_depense} onChange={e => setCurrentExpense({...currentExpense, date_depense: e.target.value})} required />
                </div>
                <div className="form-group">
                  <label>Fournisseur *</label>
                  <input type="text" className="form-control" value={currentExpense.fournisseur} onChange={e => setCurrentExpense({...currentExpense, fournisseur: e.target.value})} required />
                </div>
              </div>

              <div className="form-group">
                <label>Description</label>
                <input type="text" className="form-control" value={currentExpense.description} onChange={e => setCurrentExpense({...currentExpense, description: e.target.value})} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                <div className="form-group">
                  <label>Catégorie</label>
                  <select className="form-control" value={currentExpense.categorie} onChange={e => setCurrentExpense({...currentExpense, categorie: e.target.value})}>
                    {PREDEFINED_CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                {currentExpense.categorie === 'Autres dépenses' && (
                  <div className="form-group">
                    <label>Précisez la catégorie *</label>
                    <input type="text" className="form-control" value={currentExpense.autre_categorie} onChange={e => setCurrentExpense({...currentExpense, autre_categorie: e.target.value})} required />
                  </div>
                )}
              </div>

              <h4 style={{ marginTop: '20px', marginBottom: '10px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '5px' }}>Montants (Taxes exactes selon reçu)</h4>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '15px' }}>
                <div className="form-group">
                  <label>
                    Montant HT ($) *
                    <InfoTooltip text="Hors Taxes : Le montant avant l'application des taxes." />
                  </label>
                  <input type="number" step="0.01" className="form-control" value={currentExpense.montant_ht} onChange={e => setCurrentExpense({...currentExpense, montant_ht: e.target.value})} required />
                </div>
                <div className="form-group">
                  <label>TPS / TVH ($)</label>
                  <input type="number" step="0.01" className="form-control" value={currentExpense.tps} onChange={e => setCurrentExpense({...currentExpense, tps: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>TVQ / TVP ($)</label>
                  <input type="number" step="0.01" className="form-control" value={currentExpense.tvq} onChange={e => setCurrentExpense({...currentExpense, tvq: e.target.value})} />
                </div>
              </div>

              <div style={{ padding: '15px', background: 'var(--glass-bg)', borderRadius: '8px', marginTop: '10px', textAlign: 'right' }}>
                <strong>Total TTC <InfoTooltip text="Toutes Taxes Comprises : Le montant final payé, incluant les taxes." /> : </strong>
                <span style={{ fontSize: '1.2rem', color: 'var(--text-main)', fontWeight: 'bold' }}>
                  {formatCurrency((parseFloat(currentExpense.montant_ht) || 0) + (parseFloat(currentExpense.tps) || 0) + (parseFloat(currentExpense.tvq) || 0))}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                <button type="button" className="btn-secondary" onClick={() => setIsModalOpen(false)}>Annuler</button>
                <button type="submit" className="btn-primary">Enregistrer</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default ExpenseList;
