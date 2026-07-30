import { useState, useMemo } from 'react';
import Papa from 'papaparse';
import { Upload, CheckCircle, XCircle } from 'lucide-react';
import { api, formatMontant } from '../api';
import { useApiResource } from '../useApiResource';

/** Noms de colonnes reconnus dans les relevés bancaires canadiens. */
const COLONNES = {
  date: ['date', 'date de transaction', 'transaction date', 'date_transaction'],
  description: ['description', 'libellé', 'libelle', 'details', 'détails', 'payee', 'memo'],
  montant: ['montant', 'amount', 'crédit', 'credit', 'dépôt', 'depot', 'deposit']
};

/** Retrouve une valeur dans une ligne de CSV, quel que soit le nom exact de la colonne. */
function valeurColonne(ligne, cles, positionParDefaut) {
  const entrees = Object.entries(ligne);
  for (const cle of cles) {
    const trouve = entrees.find(([nom]) => nom && nom.trim().toLowerCase() === cle);
    if (trouve && trouve[1] !== '' && trouve[1] != null) return trouve[1];
  }
  const parPosition = entrees[positionParDefaut];
  return parPosition ? parPosition[1] : '';
}

/** Normalise un montant écrit « 1 234,56 », « 1,234.56 » ou « (12.50) ». */
function parseMontant(valeur) {
  if (valeur == null) return NaN;
  let texte = String(valeur).trim();
  if (!texte) return NaN;

  const negatifParParentheses = /^\(.*\)$/.test(texte);
  texte = texte.replace(/[()\s$]/g, '');

  // Virgule décimale à la française si elle précède exactement deux chiffres finaux.
  if (/,\d{2}$/.test(texte) && !/\.\d{2}$/.test(texte)) {
    texte = texte.replace(/\./g, '').replace(',', '.');
  } else {
    texte = texte.replace(/,/g, '');
  }

  const nombre = Number.parseFloat(texte);
  if (!Number.isFinite(nombre)) return NaN;
  return negatifParParentheses ? -Math.abs(nombre) : nombre;
}

/** Convertit une date de relevé au format AAAA-MM-JJ. */
function parseDate(valeur) {
  const texte = String(valeur || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(texte)) return texte;

  const slash = texte.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slash) {
    // Format canadien courant JJ/MM/AAAA.
    const [, jour, mois, annee] = slash;
    return `${annee}-${mois.padStart(2, '0')}-${jour.padStart(2, '0')}`;
  }

  const iso = texte.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (iso) {
    const [, annee, mois, jour] = iso;
    return `${annee}-${mois.padStart(2, '0')}-${jour.padStart(2, '0')}`;
  }
  return texte;
}

export default function BankReconciliation() {
  const transactionsRes = useApiResource('/api/banque/transactions', []);
  const facturesRes = useApiResource('/api/factures', []);

  const [selections, setSelections] = useState({});
  const [parts, setParts] = useState({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [erreurAction, setErreurAction] = useState(null);

  const transactions = transactionsRes.data;
  const error = erreurAction || transactionsRes.error || facturesRes.error;

  // Le rapprochement porte sur des dépôts en dollars canadiens : une facture en
  // devise étrangère est refusée par le serveur, il est inutile de la proposer.
  const factures = useMemo(
    () => facturesRes.data.filter((f) => f.solde_restant > 0 && f.statut !== 'Annulée' && f.devise === 'CAD'),
    [facturesRes.data]
  );

  const charger = () => {
    transactionsRes.refresh();
    facturesRes.refresh();
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    setMessage(null);
    setErreurAction(null);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const lignes = results.data.map((row) => ({
            date_transaction: parseDate(valeurColonne(row, COLONNES.date, 0)),
            description: String(valeurColonne(row, COLONNES.description, 1) || '').trim(),
            montant: parseMontant(valeurColonne(row, COLONNES.montant, 2))
          })).filter((l) => Number.isFinite(l.montant));

          const data = await api.post('/api/banque/import', lignes);
          const details = [
            `${data.inserted} dépôt(s) importé(s)`,
            data.ignored ? `${data.ignored} ligne(s) ignorée(s) (retraits ou doublons)` : null,
            data.invalid ? `${data.invalid} ligne(s) illisible(s)` : null
          ].filter(Boolean).join(', ');
          setMessage(`${details}.`);
          charger();
        } catch (err) {
          setErreurAction(err.message);
        } finally {
          setLoading(false);
          e.target.value = '';
        }
      },
      error: () => {
        setErreurAction('Le fichier CSV n\'a pas pu être lu.');
        setLoading(false);
      }
    });
  };

  const handleRapprocher = async (transactionId) => {
    const factureId = selections[transactionId];
    if (!factureId) {
      setErreurAction('Sélectionnez une facture avant de lier la transaction.');
      return;
    }
    try {
      setErreurAction(null);
      // Sans part saisie, le serveur impute le plus petit du reste du dépôt et
      // du solde de la facture : le geste courant ne demande aucune saisie.
      const part = parts[transactionId];
      const data = await api.post(`/api/banque/rapprocher/${transactionId}`, {
        facture_id: factureId,
        montant: part === undefined || part === '' ? undefined : parseFloat(part)
      });
      setSelections((prev) => {
        const copie = { ...prev };
        delete copie[transactionId];
        return copie;
      });
      setParts((prev) => {
        const copie = { ...prev };
        delete copie[transactionId];
        return copie;
      });
      setMessage(data.message || 'Transaction rapprochée.');
      charger();
    } catch (err) {
      setErreurAction(err.message);
    }
  };

  const handleIgnorer = async (transactionId) => {
    try {
      setErreurAction(null);
      await api.post(`/api/banque/ignorer/${transactionId}`);
      charger();
    } catch (err) {
      setErreurAction(err.message);
    }
  };

  /** Facture dont le solde correspond exactement au dépôt, s'il en existe une seule. */
  const suggestions = useMemo(() => {
    const map = {};
    for (const t of transactions) {
      const restant = t.montant_restant ?? t.montant;
      const correspondances = factures.filter((f) => Math.abs(f.solde_restant - restant) < 0.01);
      if (correspondances.length === 1) map[t.id] = correspondances[0].id;
    }
    return map;
  }, [transactions, factures]);

  return (
    <div>
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      {message && <p className="alert alert-success" role="status">{message}</p>}

      <div className="glass-panel" style={{ padding: '20px', marginBottom: '20px' }}>
        <h3 style={{ marginTop: 0 }}>Importer un relevé (CSV)</h3>
        <p style={{ color: 'var(--text-muted)' }}>
          Le fichier doit comporter une ligne d'en-têtes. Les colonnes de date, de description et de
          montant sont détectées automatiquement. Seuls les dépôts sont retenus, et les lignes déjà
          importées sont ignorées.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginTop: '10px' }}>
          <label className="btn-primary" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <Upload size={18} aria-hidden="true" />
            Sélectionner un fichier CSV
            <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={handleFileUpload} disabled={loading} />
          </label>
          {loading && <span style={{ color: 'var(--text-muted)' }}>Analyse en cours…</span>}
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '20px' }}>
        <h3 style={{ marginTop: 0, marginBottom: '10px' }}>Dépôts à imputer</h3>
        <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
          Un dépôt peut régler plusieurs factures : liez-le autant de fois que nécessaire.
          La colonne « Part » permet d'imputer un montant précis ; laissée vide, elle affecte
          le plus petit du reste du dépôt et du solde de la facture.
        </p>

        {factures.length === 0 && transactions.length > 0 && (
          <p className="alert alert-info">
            Aucune facture en dollars canadiens n'a de solde ouvert : il n'y a rien à rapprocher.
          </p>
        )}

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th className="numeric">Montant</th>
                <th className="numeric">Reste à imputer</th>
                <th>Facture associée</th>
                <th className="numeric">Part</th>
                <th style={{ textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan="7" className="empty-state">Aucun dépôt en attente.</td>
                </tr>
              ) : transactions.map((t) => {
                const valeur = selections[t.id] ?? suggestions[t.id] ?? '';
                const restant = t.montant_restant ?? t.montant;
                const partiel = restant < t.montant - 0.005;
                return (
                  <tr key={t.id}>
                    <td>{t.date_transaction}</td>
                    <td>{t.description}</td>
                    <td className="numeric" style={{ fontWeight: 'bold', color: 'var(--status-paid)' }}>
                      + {formatMontant(t.montant)}
                    </td>
                    <td className="numeric" style={{ fontWeight: 'bold' }}>
                      {formatMontant(restant)}
                      {partiel && (
                        <div style={{ fontSize: '0.8rem', fontWeight: 'normal', color: 'var(--status-warning)' }}>
                          {formatMontant(t.montant_rapproche)} déjà imputés
                        </div>
                      )}
                    </td>
                    <td>
                      {/* La sélection est gérée par l'état React. Elle était lue
                          via document.getElementById au moment du clic, et la
                          liste affichait un champ « client_nom » que l'API ne
                          renvoie pas : chaque ligne indiquait « undefined ». */}
                      <select
                        className="form-control"
                        style={{ minWidth: '260px', padding: '8px' }}
                        aria-label={`Facture à associer au dépôt du ${t.date_transaction}`}
                        value={valeur}
                        onChange={(e) => setSelections((prev) => ({ ...prev, [t.id]: e.target.value }))}
                      >
                        <option value="">— Sélectionner —</option>
                        {factures.map((f) => {
                          const exact = Math.abs(f.solde_restant - restant) < 0.01;
                          return (
                            <option key={f.id} value={f.id}>
                              {f.numero_facture} — {f.client} (solde : {formatMontant(f.solde_restant)}){exact ? ' ⭐' : ''}
                            </option>
                          );
                        })}
                      </select>
                    </td>
                    <td className="numeric">
                      {/* Laissé vide, le serveur impute le plus petit du reste du
                          dépôt et du solde de la facture. */}
                      <input
                        type="number" className="form-control"
                        style={{ width: '120px', padding: '8px', textAlign: 'right' }}
                        step="0.01" min="0.01" max={restant}
                        placeholder="tout"
                        aria-label={`Part du dépôt du ${t.date_transaction} à imputer`}
                        value={parts[t.id] ?? ''}
                        onChange={(e) => setParts((prev) => ({ ...prev, [t.id]: e.target.value }))}
                      />
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                        <button
                          type="button"
                          onClick={() => handleRapprocher(t.id)}
                          className="btn-primary"
                          style={{ padding: '6px 12px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                          title="Lier à la facture"
                        >
                          <CheckCircle size={16} aria-hidden="true" /> Lier
                        </button>
                        <button
                          type="button"
                          onClick={() => handleIgnorer(t.id)}
                          className="btn-danger"
                          title="Ignorer cette transaction"
                          aria-label={`Ignorer le dépôt du ${t.date_transaction}`}
                        >
                          <XCircle size={16} aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
