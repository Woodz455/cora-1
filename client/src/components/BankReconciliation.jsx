import React, { useState, useEffect } from 'react';
import Papa from 'papaparse';
import { Upload, CheckCircle, XCircle } from 'lucide-react';

export default function BankReconciliation() {
  const [transactions, setTransactions] = useState([]);
  const [factures, setFactures] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchTransactions();
    fetchFactures();
  }, []);

  const fetchTransactions = async () => {
    const res = await fetch('/api/banque/transactions');
    if (res.ok) setTransactions(await res.json());
  };

  const fetchFactures = async () => {
    const res = await fetch('/api/factures');
    if (res.ok) {
      const data = await res.json();
      // Conserver uniquement celles qui ne sont pas totalement payées
      setFactures(data.filter(f => f.statut !== 'Payée'));
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        // Tentative de détection du format générique
        const parsed = results.data.map(row => {
          const keys = Object.keys(row);
          const date = row['Date'] || row['date'] || row[keys[0]];
          const desc = row['Description'] || row['description'] || row[keys[1]];
          const amountStr = row['Montant'] || row['montant'] || row['Amount'] || row[keys[2]];
          const montant = parseFloat(amountStr ? String(amountStr).replace(/,/g, '').replace(' ', '') : '0');
          return { date_transaction: date, description: desc, montant };
        });

        const res = await fetch('/api/banque/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed)
        });

        if (res.ok) {
          const data = await res.json();
          alert(`${data.inserted} dépôts importés avec succès.`);
          fetchTransactions();
        } else {
          alert("Erreur lors de importation");
        }
        setLoading(false);
        e.target.value = ''; // Reset file input
      },
      error: () => {
        alert("Erreur de lecture du fichier CSV");
        setLoading(false);
      }
    });
  };

  const handleRapprocher = async (transactionId, factureId) => {
    if (!factureId) {
      alert("Veuillez sélectionner une facture");
      return;
    }
    const res = await fetch(`/api/banque/rapprocher/${transactionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ facture_id: factureId })
    });
    if (res.ok) {
      fetchTransactions();
      fetchFactures();
    } else {
      alert("Erreur lors du rapprochement");
    }
  };

  const handleIgnorer = async (transactionId) => {
    const res = await fetch(`/api/banque/ignorer/${transactionId}`, {
      method: 'POST'
    });
    if (res.ok) fetchTransactions();
  };

  return (
    <div>
      <div className="glass-panel" style={{ padding: '20px', marginBottom: '20px' }}>
        <h3>Importer un relevé (CSV)</h3>
        <p style={{ color: 'var(--text-muted)' }}>
          Le fichier doit contenir des en-têtes. L'application essaiera de détecter les colonnes de Date, Description et Montant.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginTop: '10px' }}>
          <label className="btn-primary" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Upload size={18} />
            Sélectionner un fichier CSV
            <input type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFileUpload} disabled={loading} />
          </label>
          {loading && <span style={{ color: 'var(--brand-color)' }}>Analyse en cours...</span>}
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '20px' }}>
        <h3 style={{ marginBottom: '20px' }}>Dépôts en attente de rapprochement</h3>
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '12px 10px', borderBottom: '1px solid var(--glass-border)' }}>Date</th>
                <th style={{ textAlign: 'left', padding: '12px 10px', borderBottom: '1px solid var(--glass-border)' }}>Description</th>
                <th style={{ textAlign: 'left', padding: '12px 10px', borderBottom: '1px solid var(--glass-border)' }}>Montant</th>
                <th style={{ textAlign: 'left', padding: '12px 10px', borderBottom: '1px solid var(--glass-border)' }}>Facture Associée</th>
                <th style={{ textAlign: 'center', padding: '12px 10px', borderBottom: '1px solid var(--glass-border)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan="5" style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    Aucun dépôt en attente.
                  </td>
                </tr>
              ) : transactions.map(t => (
                <tr key={t.id}>
                  <td style={{ padding: '12px 10px', borderBottom: '1px solid var(--glass-border)' }}>{t.date_transaction}</td>
                  <td style={{ padding: '12px 10px', borderBottom: '1px solid var(--glass-border)' }}>{t.description}</td>
                  <td style={{ padding: '12px 10px', borderBottom: '1px solid var(--glass-border)', fontWeight: 'bold', color: '#10b981' }}>
                    + {t.montant.toFixed(2)} $
                  </td>
                  <td style={{ padding: '12px 10px', borderBottom: '1px solid var(--glass-border)' }}>
                    <select
                      id={`select-${t.id}`}
                      className="input-field"
                      style={{ padding: '8px', minWidth: '250px' }}
                      defaultValue=""
                    >
                      <option value="" disabled>-- Sélectionner --</option>
                      {factures.map(f => {
                        // Suggérer visuellement si le montant correspond
                        const isMatch = Math.abs(f.solde_restant - t.montant) < 0.01;
                        return (
                          <option key={f.id} value={f.id} style={isMatch ? { fontWeight: 'bold', color: 'var(--brand-color)' } : {}}>
                            {f.numero_facture} - {f.client_nom} (Solde: {f.solde_restant.toFixed(2)}$) {isMatch ? '⭐' : ''}
                          </option>
                        );
                      })}
                    </select>
                  </td>
                  <td style={{ padding: '12px 10px', borderBottom: '1px solid var(--glass-border)', textAlign: 'center' }}>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                      <button
                        onClick={() => handleRapprocher(t.id, document.getElementById(`select-${t.id}`).value)}
                        className="btn-primary"
                        style={{ padding: '6px 12px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                        title="Lier à la facture"
                      >
                        <CheckCircle size={16} /> Lier
                      </button>
                      <button
                        onClick={() => handleIgnorer(t.id)}
                        className="btn-secondary"
                        style={{ padding: '6px 12px', fontSize: '0.9rem', color: '#ef4444', borderColor: '#ef4444' }}
                        title="Ignorer cette transaction"
                      >
                        <XCircle size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
