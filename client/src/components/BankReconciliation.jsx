import { useState, useMemo } from 'react';
import Papa from 'papaparse';
import { Upload, CheckCircle, XCircle } from 'lucide-react';
import { api } from '../api';
import { useApiResource } from '../useApiResource';
import { useLangue } from '../i18n.js';

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
  const { t, tp, montant: formatMontant } = useLangue();
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
            tp(data.inserted, '{n} dépôt(s) importé(s)', '{n} dépôt(s) importé(s)|pluriel'),
            data.ignored ? tp(data.ignored, '{n} ligne(s) ignorée(s) (retraits ou doublons)',
              '{n} ligne(s) ignorée(s) (retraits ou doublons)|pluriel') : null,
            data.invalid ? tp(data.invalid, '{n} ligne(s) illisible(s)', '{n} ligne(s) illisible(s)|pluriel') : null
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
        setErreurAction(t("Le fichier CSV n'a pas pu être lu."));
        setLoading(false);
      }
    });
  };

  const handleRapprocher = async (transactionId) => {
    const factureId = selections[transactionId];
    if (!factureId) {
      setErreurAction(t('Sélectionnez une facture avant de lier la transaction.'));
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
      setMessage(data.message || t('Transaction rapprochée.'));
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
    for (const tx of transactions) {
      const restant = tx.montant_restant ?? tx.montant;
      const correspondances = factures.filter((f) => Math.abs(f.solde_restant - restant) < 0.01);
      if (correspondances.length === 1) map[tx.id] = correspondances[0].id;
    }
    return map;
  }, [transactions, factures]);

  return (
    <div>
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      {message && <p className="alert alert-success" role="status">{message}</p>}

      <div className="glass-panel" style={{ padding: '20px', marginBottom: '20px' }}>
        <h3 style={{ marginTop: 0 }}>{t('Importer un relevé (CSV)')}</h3>
        <p style={{ color: 'var(--text-muted)' }}>
          {t("Le fichier doit comporter une ligne d'en-têtes. Les colonnes de date, de description et de "
            + 'montant sont détectées automatiquement. Seuls les dépôts sont retenus, et les lignes déjà '
            + 'importées sont ignorées.')}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '8px' }}>
          <label className="btn-primary" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <Upload size={18} aria-hidden="true" />
            {t('Sélectionner un fichier CSV')}
            <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={handleFileUpload} disabled={loading} />
          </label>
          {loading && <span style={{ color: 'var(--text-muted)' }}>{t('Analyse en cours…')}</span>}
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '20px' }}>
        <h3 style={{ marginTop: 0, marginBottom: '8px' }}>{t('Dépôts à imputer')}</h3>
        <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
          {t('Un dépôt peut régler plusieurs factures : liez-le autant de fois que nécessaire. '
            + "La colonne « Part » permet d'imputer un montant précis ; laissée vide, elle affecte "
            + 'le plus petit du reste du dépôt et du solde de la facture.')}
        </p>

        {factures.length === 0 && transactions.length > 0 && (
          <p className="alert alert-info">
            {t("Aucune facture en dollars canadiens n'a de solde ouvert : il n'y a rien à rapprocher.")}
          </p>
        )}

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('Date')}</th>
                <th>{t('Description')}</th>
                <th className="numeric">{t('Montant')}</th>
                <th className="numeric">{t('Reste à imputer')}</th>
                <th>{t('Facture associée')}</th>
                <th className="numeric">{t('Part')}</th>
                <th style={{ textAlign: 'center' }}>{t('Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan="7" className="empty-state">{t('Aucun dépôt en attente.')}</td>
                </tr>
              ) : transactions.map((tx) => {
                const valeur = selections[tx.id] ?? suggestions[tx.id] ?? '';
                const restant = tx.montant_restant ?? tx.montant;
                const partiel = restant < tx.montant - 0.005;
                return (
                  <tr key={tx.id}>
                    <td>{tx.date_transaction}</td>
                    <td>{tx.description}</td>
                    <td className="numeric" style={{ fontWeight: 'bold', color: 'var(--status-paid)' }}>
                      + {formatMontant(tx.montant)}
                    </td>
                    <td className="numeric" style={{ fontWeight: 'bold' }}>
                      {formatMontant(restant)}
                      {partiel && (
                        <div style={{ fontSize: '0.8rem', fontWeight: 'normal', color: 'var(--status-warning)' }}>
                          {t('{montant} déjà imputés', { montant: formatMontant(tx.montant_rapproche) })}
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
                        aria-label={t('Facture à associer au dépôt du {date}', { date: tx.date_transaction })}
                        value={valeur}
                        onChange={(e) => setSelections((prev) => ({ ...prev, [tx.id]: e.target.value }))}
                      >
                        <option value="">{t('Sélectionner…')}</option>
                        {factures.map((f) => {
                          const exact = Math.abs(f.solde_restant - restant) < 0.01;
                          return (
                            <option key={f.id} value={f.id}>
                              {/* Une `<option>` ne rend que du texte : aucune
                                  icône n'y est possible, et l'étoile qui
                                  marquait la correspondance exacte se lit mieux
                                  en mots, y compris par un lecteur d'écran. */}
                              {f.numero_facture}, {f.client} ({t('solde : {montant}', { montant: formatMontant(f.solde_restant) })}{exact ? t(', montant exact') : ''})
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
                        placeholder={t('tout')}
                        aria-label={t('Part du dépôt du {date} à imputer', { date: tx.date_transaction })}
                        value={parts[tx.id] ?? ''}
                        onChange={(e) => setParts((prev) => ({ ...prev, [tx.id]: e.target.value }))}
                      />
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                        <button
                          type="button"
                          onClick={() => handleRapprocher(tx.id)}
                          className="btn-primary"
                          style={{ padding: '4px 12px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                          title={t('Lier à la facture')}
                        >
                          <CheckCircle size={16} aria-hidden="true" /> {t('Lier')}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleIgnorer(tx.id)}
                          className="btn-danger"
                          title={t('Ignorer cette transaction')}
                          aria-label={t('Ignorer le dépôt du {date}', { date: tx.date_transaction })}
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
