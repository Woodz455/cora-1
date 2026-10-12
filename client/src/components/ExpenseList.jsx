import { useState, useMemo } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import InfoTooltip from './InfoTooltip';
import { api } from '../api';
import { useApiResource } from '../useApiResource';
import { useModale } from '../useModale';
import { usePagination } from '../usePagination';
import Pagination from './Pagination';
import { useTri } from '../useTri';
import { useFeedback } from '../FeedbackContext';
import EnTeteTri from './EnTeteTri';
import { useLangue } from '../i18n.js';
import { CATEGORIES_DEPENSE as CATEGORIES } from '../statuts.js';

const AUTRES = 'Autres dépenses';

/** Catégorie proposée d'office à un déplacement. */
const CATEGORIE_DEPLACEMENT = 'Frais de déplacement';

/** La colonne « Taxes » n'existe pas en base : elle additionne les deux taxes. */
const ACCESSEURS = {
  taxes: (d) => (Number(d.tps) || 0) + (Number(d.tvq) || 0),
  montant_ht: (d) => Number(d.montant_ht) || 0,
  montant_ttc: (d) => Number(d.montant_ttc) || 0,
  kilometres: (d) => Number(d.kilometres) || 0
};

const aujourdhui = () => new Date().toISOString().split('T')[0];

function depenseVide() {
  return {
    fournisseur: '',
    description: '',
    date_depense: aujourdhui(),
    montant_ht: 0,
    tps: 0,
    tvq: 0,
    categorie: CATEGORIES[0],
    autre_categorie: '',
    kilometres: null
  };
}

/**
 * Déplacement : ni montant ni taxes à saisir, c'est le serveur qui les calcule
 * au taux de l'année. `kilometres` non nul est ce qui distingue les deux
 * formulaires, comme en base.
 */
function deplacementVide() {
  return {
    fournisseur: '',
    description: '',
    date_depense: aujourdhui(),
    montant_ht: 0,
    tps: 0,
    tvq: 0,
    categorie: CATEGORIE_DEPLACEMENT,
    autre_categorie: '',
    kilometres: '',
    vehicule: ''
  };
}

/** Formate un nombre de kilomètres, sans décimale inutile. */
function formatKm(km, langue = 'fr') {
  const n = Number(km);
  if (!Number.isFinite(n)) return '';
  return `${n.toLocaleString(langue === 'en' ? 'en-CA' : 'fr-CA', { maximumFractionDigits: 1 })} km`;
}

function ExpenseList() {
  const { notifier, confirmer } = useFeedback();
  const { langue, t, tp, montant: formatMontant } = useLangue();
  const km = (valeur) => formatKm(valeur, langue);
  // Une catégorie proposée se traduit ; celle qu'on a saisie reste telle quelle.
  const libelleCategorie = (categorie) => (CATEGORIES.includes(categorie) ? t(categorie) : categorie);
  const { data: expenses, loading, error, setError, refresh } = useApiResource('/api/depenses', []);
  const { data: vehicules, refresh: refreshVehicules } = useApiResource('/api/depenses/vehicules', []);
  const { data: tauxKm } = useApiResource('/api/settings/taux-kilometriques', []);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const modaleRef = useModale(() => setIsModalOpen(false), { actif: isModalOpen });
  const [currentExpense, setCurrentExpense] = useState(depenseVide());
  const [modalError, setModalError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [recherche, setRecherche] = useState('');

  // Un déplacement se reconnaît à sa distance, ici comme en base.
  const estDeplacement = currentExpense.kilometres !== null
    && currentExpense.kilometres !== undefined;

  /** Taux applicables à l'année de la date saisie, s'ils sont réglés. */
  const tauxDeLAnnee = useMemo(() => {
    const annee = Number(String(currentExpense.date_depense || '').slice(0, 4));
    return tauxKm.find((t) => t.annee === annee) || null;
  }, [tauxKm, currentExpense.date_depense]);

  const depensesFiltrees = useMemo(() => {
    const terme = recherche.trim().toLowerCase();
    if (!terme) return expenses;
    return expenses.filter((d) => [d.fournisseur, d.description, d.categorie]
      .some((champ) => (champ || '').toLowerCase().includes(terme)));
  }, [expenses, recherche]);

  // La dépense la plus récente d'abord : on saisit ses reçus dans l'ordre inverse.
  const { tri, basculer, tries: depensesTriees } = useTri(depensesFiltrees, {
    defaut: 'date_depense', sens: 'desc', accesseurs: ACCESSEURS
  });
  const { affiches: depensesAffichees, pagination } = usePagination(depensesTriees, 15);

  // Totaux de la sélection affichée : utile au moment de préparer une déclaration.
  const totaux = useMemo(() => depensesFiltrees.reduce((acc, d) => ({
    ht: acc.ht + (Number(d.montant_ht) || 0),
    taxes: acc.taxes + (Number(d.tps) || 0) + (Number(d.tvq) || 0),
    ttc: acc.ttc + (Number(d.montant_ttc) || 0),
    km: acc.km + (Number(d.kilometres) || 0)
  }), { ht: 0, taxes: 0, ttc: 0, km: 0 }), [depensesFiltrees]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setModalError(null);

    const categorie = currentExpense.categorie === AUTRES
      ? (currentExpense.autre_categorie || AUTRES)
      : currentExpense.categorie;

    const payload = estDeplacement
      // Un déplacement ne transporte aucun montant : le serveur les ignorerait
      // de toute façon, l'indemnité étant calculée au taux de l'année.
      ? {
        description: currentExpense.description,
        date_depense: currentExpense.date_depense,
        categorie,
        kilometres: parseFloat(currentExpense.kilometres) || 0,
        vehicule: currentExpense.vehicule
      }
      : {
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
      if (estDeplacement) refreshVehicules();
    } catch (err) {
      setModalError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (depense) => {
    const libelle = depense.fournisseur || depense.description;
    const accepte = await confirmer({
      titre: t('Supprimer la dépense « {nom} » ?', { nom: libelle }),
      message: t('Elle ne comptera plus dans vos charges ni dans les taxes réclamées '
        + 'au titre des intrants. Cette action est irréversible.'),
      libelleConfirmer: t('Supprimer'),
      danger: true
    });
    if (!accepte) return;
    try {
      setError(null);
      await api.del(`/api/depenses/${depense.id}`);
      notifier(t('Dépense « {nom} » supprimée.', { nom: libelle }));
      refresh();
    } catch (err) {
      notifier(err.message, 'erreur');
    }
  };

  const openModal = (expense = null) => {
    if (expense) {
      const predefinie = CATEGORIES.includes(expense.categorie);
      setCurrentExpense({
        ...expense,
        categorie: predefinie ? expense.categorie : AUTRES,
        autre_categorie: predefinie ? '' : expense.categorie,
        vehicule: expense.vehicule || ''
      });
    } else {
      setCurrentExpense(depenseVide());
    }
    setModalError(null);
    setIsModalOpen(true);
  };

  const openDeplacement = () => {
    setCurrentExpense(deplacementVide());
    setModalError(null);
    setIsModalOpen(true);
  };

  const totalModale = (parseFloat(currentExpense.montant_ht) || 0)
    + (parseFloat(currentExpense.tps) || 0)
    + (parseFloat(currentExpense.tvq) || 0);

  const titreModale = estDeplacement
    ? (currentExpense.id ? t('Modifier le déplacement') : t('Inscrire un déplacement'))
    : (currentExpense.id ? t('Modifier la dépense') : t('Ajouter une dépense'));

  return (
    <div className="glass-panel" style={{ padding: '20px' }}>
      {error && <p className="alert alert-error" role="alert">{error}</p>}

      <div className="toolbar">
        <div className="toolbar-group">
          <input
            type="search"
            className="search-input"
            placeholder={t('Rechercher une dépense…')}
            aria-label={t('Rechercher une dépense')}
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />
        </div>
        <div className="toolbar-group">
          <button type="button" className="btn-secondary" onClick={openDeplacement}>{t('+ Déplacement')}</button>
          <button type="button" className="btn-primary" onClick={() => openModal()}>{t('+ Nouvelle dépense')}</button>
        </div>
      </div>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <EnTeteTri colonne="date_depense" tri={tri} onTrier={basculer}>{t('Date')}</EnTeteTri>
              <EnTeteTri colonne="fournisseur" tri={tri} onTrier={basculer}>{t('Fournisseur')}</EnTeteTri>
              <EnTeteTri colonne="description" tri={tri} onTrier={basculer}>{t('Description')}</EnTeteTri>
              <EnTeteTri colonne="categorie" tri={tri} onTrier={basculer}>{t('Catégorie')}</EnTeteTri>
              <EnTeteTri
                colonne="kilometres" tri={tri} onTrier={basculer} className="numeric"
                suffixe={<InfoTooltip text={t("Distance parcourue, pour les déplacements. Le montant en découle au taux de l'année.")} />}
              >
                {t('Distance')}
              </EnTeteTri>
              {/* La bulle d'aide reste hors du bouton : elle alourdirait le nom
                  annoncé de la colonne, et se déclenche au survol. */}
              <EnTeteTri
                colonne="montant_ht" tri={tri} onTrier={basculer} className="numeric"
                suffixe={<InfoTooltip text={t('Hors taxes : le montant avant application des taxes.')} />}
              >
                {t('Montant HT')}
              </EnTeteTri>
              <EnTeteTri
                colonne="taxes" tri={tri} onTrier={basculer} className="numeric"
                suffixe={<InfoTooltip text={t('Les taxes payées sur vos achats, que vous pouvez réclamer (crédit ou remboursement de la taxe sur les intrants).')} />}
              >
                {t('Taxes (CTI/RTI)')}
              </EnTeteTri>
              <EnTeteTri
                colonne="montant_ttc" tri={tri} onTrier={basculer} className="numeric"
                suffixe={<InfoTooltip text={t('Toutes taxes comprises : le montant final payé.')} />}
              >
                {t('Total TTC')}
              </EnTeteTri>
              <th style={{ textAlign: 'right' }}>{t('Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="9" className="empty-state">{t('Chargement…')}</td></tr>
            ) : depensesFiltrees.length === 0 ? (
              <tr>
                <td colSpan="9" className="empty-state">
                  {expenses.length === 0 ? t('Aucune dépense enregistrée.') : t('Aucune dépense ne correspond à votre recherche.')}
                </td>
              </tr>
            ) : depensesAffichees.map((expense) => (
              <tr key={expense.id}>
                <td style={{ color: 'var(--text-muted)' }}>{expense.date_depense}</td>
                <td style={{ fontWeight: '500' }}>{expense.fournisseur}</td>
                <td style={{ color: 'var(--text-muted)' }}>{expense.description}</td>
                <td><span className="status-badge">{libelleCategorie(expense.categorie)}</span></td>
                <td className="numeric" style={{ color: 'var(--text-muted)' }}>
                  {expense.kilometres !== null && expense.kilometres !== undefined
                    ? km(expense.kilometres)
                    : '-'}
                </td>
                <td className="numeric">{formatMontant(expense.montant_ht)}</td>
                {/* Le violet de cette colonne mesurait 4,12:1 en thème clair et
                    3,84:1 en sombre, sous le seuil de 4,5:1 exigé du texte
                    courant, et ne dépendait de rien : un « 0,00 $ » s'annonçait
                    en crédit de taxes. La colonne se lit comme ses deux
                    voisines, le montant hors taxes et le total. */}
                <td className="numeric">
                  {formatMontant((expense.tps || 0) + (expense.tvq || 0))}
                </td>
                <td className="numeric" style={{ fontWeight: 'bold' }}>{formatMontant(expense.montant_ttc)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button type="button" className="btn-icon" onClick={() => openModal(expense)} aria-label={t('Modifier la dépense')} style={{ marginRight: '4px' }}><Pencil size={16} aria-hidden="true" /></button>
                  <button type="button" className="btn-danger" onClick={() => handleDelete(expense)} aria-label={t('Supprimer la dépense')}><Trash2 size={16} aria-hidden="true" /></button>
                </td>
              </tr>
            ))}
          </tbody>
          {depensesFiltrees.length > 0 && (
            <tfoot>
              <tr style={{ fontWeight: 'bold' }}>
                <td colSpan="4" style={{ paddingTop: '12px' }}>{tp(depensesFiltrees.length, 'Total ({n} dépense)', 'Total ({n} dépenses)')}</td>
                <td className="numeric" style={{ paddingTop: '12px', color: 'var(--text-muted)' }}>
                  {totaux.km > 0 ? km(totaux.km) : ''}
                </td>
                <td className="numeric" style={{ paddingTop: '12px' }}>{formatMontant(totaux.ht)}</td>
                <td className="numeric" style={{ paddingTop: '12px' }}>{formatMontant(totaux.taxes)}</td>
                <td className="numeric" style={{ paddingTop: '12px' }}>{formatMontant(totaux.ttc)}</td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <Pagination {...pagination} />

      {isModalOpen && (
        <div ref={modaleRef} className="modal-overlay" role="dialog" aria-modal="true" aria-label={titreModale}>
          <div className="modal-content glass-panel" style={{ maxWidth: '620px', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ marginTop: 0 }}>{titreModale}</h3>

            {modalError && <p className="alert alert-error" role="alert">{modalError}</p>}

            <form onSubmit={handleSave}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="form-group">
                  <label htmlFor="depense-date">{estDeplacement ? t('Date du déplacement *') : t('Date de la dépense *')}</label>
                  <input id="depense-date" type="date" className="form-control" value={currentExpense.date_depense} onChange={(e) => setCurrentExpense({ ...currentExpense, date_depense: e.target.value })} required />
                </div>
                {!estDeplacement && (
                  <div className="form-group">
                    <label htmlFor="depense-fournisseur">{t('Fournisseur *')}</label>
                    <input id="depense-fournisseur" type="text" className="form-control" value={currentExpense.fournisseur} onChange={(e) => setCurrentExpense({ ...currentExpense, fournisseur: e.target.value })} required />
                  </div>
                )}
                {estDeplacement && (
                  <div className="form-group">
                    {/* La bulle est hors du libellé : son bouton porte un nom
                        accessible, qui entrerait sinon dans celui du champ. */}
                    <span style={{ display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
                      <label htmlFor="depense-vehicule" style={{ marginBottom: 0 }}>{t('Véhicule ou transport')}</label>
                      <InfoTooltip text={t('Le véhicule employé, ou le mode de transport. Les valeurs déjà saisies vous sont proposées.')} />
                    </span>
                    <input id="depense-vehicule" type="text" className="form-control" list="vehicules-connus" placeholder={t('Toyota Corolla 2022')} value={currentExpense.vehicule || ''} onChange={(e) => setCurrentExpense({ ...currentExpense, vehicule: e.target.value })} />
                    <datalist id="vehicules-connus">
                      {vehicules.map((v) => <option key={v} value={v} />)}
                    </datalist>
                  </div>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="depense-description">{estDeplacement ? t('Motif du déplacement *') : t('Description')}</label>
                <input id="depense-description" type="text" className="form-control" placeholder={estDeplacement ? t('Audition à Montréal') : ''} value={currentExpense.description || ''} onChange={(e) => setCurrentExpense({ ...currentExpense, description: e.target.value })} required={estDeplacement} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="form-group">
                  <label htmlFor="depense-categorie">{t('Catégorie')}</label>
                  <select id="depense-categorie" className="form-control" value={currentExpense.categorie} onChange={(e) => setCurrentExpense({ ...currentExpense, categorie: e.target.value })}>
                    {CATEGORIES.map((cat) => <option key={cat} value={cat}>{t(cat)}</option>)}
                  </select>
                </div>
                {currentExpense.categorie === AUTRES && (
                  <div className="form-group">
                    <label htmlFor="depense-autre">{t('Précisez la catégorie *')}</label>
                    <input id="depense-autre" type="text" className="form-control" value={currentExpense.autre_categorie} onChange={(e) => setCurrentExpense({ ...currentExpense, autre_categorie: e.target.value })} required />
                  </div>
                )}
              </div>

              {estDeplacement && (
                <>
                  <h4 style={{ marginTop: '20px', marginBottom: '8px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '4px' }}>
                    {t('Distance parcourue')}
                  </h4>

                  <div className="form-group">
                    <label htmlFor="depense-km">{t('Kilomètres *')}</label>
                    <input id="depense-km" type="number" step="0.1" min="0.1" className="form-control" value={currentExpense.kilometres} onChange={(e) => setCurrentExpense({ ...currentExpense, kilometres: e.target.value })} required />
                  </div>

                  {tauxDeLAnnee ? (
                    <div style={{ padding: '16px', background: 'var(--glass-bg)', borderRadius: '8px', marginTop: '8px' }}>
                      <strong>{t('Indemnité kilométrique {annee}', { annee: tauxDeLAnnee.annee })}</strong>
                      <p style={{ margin: '4px 0 0', color: 'var(--text-muted)' }}>
                        {t("{taux_1} du kilomètre jusqu'à {seuil} dans l'année, puis {taux_2}.", {
                          taux_1: formatMontant(tauxDeLAnnee.taux_1),
                          seuil: km(tauxDeLAnnee.seuil_km),
                          taux_2: formatMontant(tauxDeLAnnee.taux_2)
                        })}
                      </p>
                      {/* Le montant n'est pas prévisualisé ici : il dépend des
                          kilomètres déjà parcourus dans l'année, et le calculer
                          une seconde fois au navigateur ouvrirait la porte à ce
                          qu'il diverge de celui du serveur. */}
                      <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                        {t("Le montant est calculé à l'enregistrement, selon les kilomètres "
                          + 'déjà parcourus cette année-là.')}
                      </p>
                    </div>
                  ) : (
                    <p className="alert alert-error" role="alert" style={{ marginTop: '8px' }}>
                      {t("Aucun taux kilométrique n'est réglé pour {annee}. "
                        + 'Un administrateur doit le renseigner dans Paramètres avant que ce déplacement puisse être inscrit.',
                      { annee: String(currentExpense.date_depense || '').slice(0, 4) })}
                    </p>
                  )}
                </>
              )}

              {!estDeplacement && (
              <>
              <h4 style={{ marginTop: '20px', marginBottom: '8px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '4px' }}>
                {t('Montants (reprenez les taxes exactes du reçu)')}
              </h4>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                <div className="form-group">
                  <span style={{ display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
                    <label htmlFor="depense-ht" style={{ marginBottom: 0 }}>{t('Montant HT ($) *')}</label>
                    <InfoTooltip text={t('Hors taxes : le montant avant application des taxes.')} />
                  </span>
                  <input id="depense-ht" type="number" step="0.01" min="0" className="form-control" value={currentExpense.montant_ht} onChange={(e) => setCurrentExpense({ ...currentExpense, montant_ht: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label htmlFor="depense-tps">{t('TPS / TVH ($)')}</label>
                  <input id="depense-tps" type="number" step="0.01" min="0" className="form-control" value={currentExpense.tps} onChange={(e) => setCurrentExpense({ ...currentExpense, tps: e.target.value })} />
                </div>
                <div className="form-group">
                  <label htmlFor="depense-tvq">{t('TVQ / TVP ($)')}</label>
                  <input id="depense-tvq" type="number" step="0.01" min="0" className="form-control" value={currentExpense.tvq} onChange={(e) => setCurrentExpense({ ...currentExpense, tvq: e.target.value })} />
                </div>
              </div>

              <div style={{ padding: '16px', background: 'var(--glass-bg)', borderRadius: '8px', marginTop: '8px', textAlign: 'right' }}>
                <strong>
                  {t('Total TTC')}
                  <InfoTooltip text={t('Toutes taxes comprises : le montant final payé.')} />
                  {t(' : ')}
                </strong>
                <span style={{ fontSize: '1.2rem', color: 'var(--text-main)', fontWeight: 'bold' }}>
                  {formatMontant(totalModale)}
                </span>
              </div>
              </>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px' }}>
                <button type="button" className="btn-secondary" onClick={() => setIsModalOpen(false)} disabled={saving}>{t('Annuler')}</button>
                <button type="submit" className="btn-primary" disabled={saving || (estDeplacement && !tauxDeLAnnee)}>{saving ? t('Enregistrement…') : t('Enregistrer')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default ExpenseList;
