import { useState, useMemo } from 'react';
import { Plus, Trash2, Calendar, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { useApiResource } from '../useApiResource';
import { usePagination } from '../usePagination';
import Pagination from './Pagination';
import { useTri } from '../useTri';
import { useFeedback } from '../FeedbackContext';
import EnTeteTri from './EnTeteTri';
import { useLangue } from '../i18n.js';
import { CYCLES_ABONNEMENT } from '../statuts.js';

let compteurLignes = 0;
const nouvelleLigne = (valeurs = {}) => ({
  cle: `abo-ligne-${++compteurLignes}`,
  description: '',
  quantite: 1,
  prix_unitaire: 0,
  ...valeurs
});

/**
 * Formulaire vierge. Le titre et la première ligne proposés sont écrits dans la
 * langue de l'utilisateur : ce sont des suggestions, qu'il modifie à sa guise.
 */
function abonnementVide(t) {
  return {
    client_id: '',
    titre: t('Abonnement mensuel'),
    cycle: 'Mensuel',
    date_prochaine_generation: new Date().toISOString().split('T')[0],
    devise: 'CAD',
    lignes: [nouvelleLigne({ description: t('Services professionnels'), prix_unitaire: 100 })]
  };
}

function SubscriptionList() {
  const { notifier, confirmer } = useFeedback();
  const { t, tp, montant } = useLangue();
  const abonnementsRes = useApiResource('/api/abonnements', []);
  const clientsRes = useApiResource('/api/clients', []);

  const [recherche, setRecherche] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [newSub, setNewSub] = useState(() => abonnementVide(t));
  const [erreurAction, setErreurAction] = useState(null);
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
      setNewSub(abonnementVide(t));
      notifier(t('Abonnement créé.'));
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
    const accepte = await confirmer({
      titre: t("Supprimer l'abonnement « {titre} » ?", { titre: sub.titre }),
      message: t('Plus aucune facture ne sera générée pour cet abonnement. Celles déjà '
        + 'émises sont conservées. Pour interrompre sans supprimer, désactivez-le.'),
      libelleConfirmer: t('Supprimer'),
      danger: true
    });
    if (!accepte) return;
    try {
      setErreurAction(null);
      await api.del(`/api/abonnements/${sub.id}`);
      notifier(t('Abonnement « {titre} » supprimé.', { titre: sub.titre }));
      fetchData();
    } catch (err) {
      notifier(err.message, 'erreur');
    }
  };

  /** Déclenche immédiatement la génération des factures dues. */
  const genererMaintenant = async () => {
    try {
      setErreurAction(null);
      await api.post('/api/abonnements/generer');
      notifier(t('Vérification effectuée. Les factures dues ont été générées.'));
      fetchData();
    } catch (err) {
      setErreurAction(err.message);
    }
  };

  const aujourdhui = new Date().toISOString().split('T')[0];

  const totalLignes = newSub.lignes.reduce(
    (sum, l) => sum + ((parseFloat(l.quantite) || 0) * (parseFloat(l.prix_unitaire) || 0)), 0
  );

  if (loading) return <p style={{ color: 'var(--text-muted)' }}>{t('Chargement…')}</p>;

  return (
    <div>
      {error && <p className="alert alert-error" role="alert">{error}</p>}

      <div className="toolbar">
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem', maxWidth: '540px' }}>
          {t("Les factures dues sont générées automatiquement, toutes les heures tant que "
            + "l'application est ouverte. Chaque période échue produit sa propre facture.")}
        </p>
        <div className="toolbar-group">
          <button type="button" className="btn-secondary" onClick={genererMaintenant} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <RefreshCw size={16} aria-hidden="true" /> {t('Générer maintenant')}
          </button>
          <button type="button" className="btn-primary" onClick={() => setShowForm(!showForm)} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={18} aria-hidden="true" /> {showForm ? t('Annuler') : t('Nouvel abonnement')}
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="glass-panel" style={{ padding: '20px', marginBottom: '32px' }}>
          <h3 style={{ margin: '0 0 16px 0' }}>{t('Créer un abonnement')}</h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '20px' }}>
            <div className="form-group">
              <label htmlFor="abo-client">{t('Client *')}</label>
              <select id="abo-client" className="form-control" value={newSub.client_id} onChange={(e) => setNewSub({ ...newSub, client_id: e.target.value })} required>
                <option value="">{t('Sélectionner un client…')}</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.nom_entreprise}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="abo-titre">{t("Titre de l'abonnement *")}</label>
              <input id="abo-titre" type="text" className="form-control" value={newSub.titre} onChange={(e) => setNewSub({ ...newSub, titre: e.target.value })} required />
            </div>
            <div className="form-group">
              <label htmlFor="abo-devise">{t('Devise')}</label>
              <select id="abo-devise" className="form-control" value={newSub.devise} onChange={(e) => setNewSub({ ...newSub, devise: e.target.value })}>
                <option value="CAD">CAD</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="abo-cycle">{t('Cycle')}</label>
              <select id="abo-cycle" className="form-control" value={newSub.cycle} onChange={(e) => setNewSub({ ...newSub, cycle: e.target.value })}>
                {CYCLES_ABONNEMENT.map((c) => <option key={c} value={c}>{t(c)}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="abo-date">{t('Prochaine génération *')}</label>
              <input id="abo-date" type="date" className="form-control" value={newSub.date_prochaine_generation} onChange={(e) => setNewSub({ ...newSub, date_prochaine_generation: e.target.value })} required />
            </div>
          </div>

          <h4 style={{ margin: '0 0 8px 0' }}>{t('Lignes de la facture à générer')}</h4>
          {newSub.lignes.map((ligne, i) => (
            <div key={ligne.cle} style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="text" className="form-control" style={{ flex: 2, minWidth: '220px' }}
                placeholder={t('Description (ex. : hébergement web)')}
                aria-label={t('Description de la ligne {n}', { n: i + 1 })}
                value={ligne.description}
                onChange={(e) => handleLineChange(i, { description: e.target.value })}
                required
              />
              <input
                type="number" className="form-control" style={{ flex: 1, minWidth: '90px' }}
                min="0.01" step="0.01" placeholder={t('Qté')}
                aria-label={t('Quantité de la ligne {n}', { n: i + 1 })}
                value={ligne.quantite}
                onChange={(e) => handleLineChange(i, { quantite: e.target.value })}
                required
              />
              <input
                type="number" className="form-control" style={{ flex: 1, minWidth: '110px' }}
                min="0" step="0.01" placeholder={t('Prix')}
                aria-label={t('Prix unitaire de la ligne {n}', { n: i + 1 })}
                value={ligne.prix_unitaire}
                onChange={(e) => handleLineChange(i, { prix_unitaire: e.target.value })}
                required
              />
              <button
                type="button" className="btn-danger"
                onClick={() => handleRemoveLine(i)}
                disabled={newSub.lignes.length === 1}
                aria-label={t('Supprimer la ligne {n}', { n: i + 1 })}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
          ))}
          <button type="button" className="btn-secondary" style={{ marginTop: '8px' }} onClick={handleAddLine}>
            {t('+ Ajouter une ligne')}
          </button>

          <div style={{ textAlign: 'right', marginTop: '20px' }}>
            <p style={{ margin: '0 0 8px 0', color: 'var(--text-muted)' }}>
              {t('Sous-total hors taxes par facture : ')}<strong style={{ color: 'var(--text-main)' }}>{montant(totalLignes, newSub.devise)}</strong>
            </p>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? t('Enregistrement…') : t("Enregistrer l'abonnement")}
            </button>
          </div>
        </form>
      )}

      <div className="glass-panel" style={{ padding: '20px' }}>
        <div className="toolbar-group" style={{ marginBottom: '16px' }}>
          <label htmlFor="recherche-abonnement" style={{ position: 'absolute', left: '-9999px' }}>
            {t('Rechercher un abonnement')}
          </label>
          <input
            id="recherche-abonnement"
            type="search"
            className="search-input"
            style={{ width: '20em' }}
            placeholder={t('Rechercher un titre ou un client…')}
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />
          <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            {tp(subs.length, '{n} abonnement', '{n} abonnements')}
          </span>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <EnTeteTri colonne="client_nom" tri={tri} onTrier={basculer}>{t('Client')}</EnTeteTri>
                <EnTeteTri colonne="titre" tri={tri} onTrier={basculer}>{t('Titre')}</EnTeteTri>
                <EnTeteTri colonne="cycle" tri={tri} onTrier={basculer} style={{ textAlign: 'center' }}>{t('Cycle')}</EnTeteTri>
                <EnTeteTri colonne="date_prochaine_generation" tri={tri} onTrier={basculer} style={{ textAlign: 'center' }}>
                  {t('Prochaine date')}
                </EnTeteTri>
                <EnTeteTri colonne="statut" tri={tri} onTrier={basculer} style={{ textAlign: 'center' }}>{t('Statut')}</EnTeteTri>
                <th style={{ textAlign: 'right' }}>{t('Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {subs.length === 0 ? (
                <tr><td colSpan="6" className="empty-state">{t('Aucun abonnement configuré.')}</td></tr>
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
                        {t(sub.cycle)}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center', color: enRetard ? 'var(--status-danger)' : 'inherit' }}>
                      {sub.date_prochaine_generation}
                      {enRetard && <div style={{ fontSize: '0.75rem' }}>{t('À générer')}</div>}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {sub.statut === 'Actif' ? (
                        <span style={{ color: 'var(--status-paid)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <CheckCircle size={16} aria-hidden="true" /> {t('Actif')}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <XCircle size={16} aria-hidden="true" /> {t('Inactif')}
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button type="button" className="btn-icon" onClick={() => toggleStatut(sub)} style={{ marginRight: '8px' }}>
                        {sub.statut === 'Actif' ? t('Désactiver') : t('Activer')}
                      </button>
                      <button type="button" className="btn-danger" onClick={() => handleDelete(sub)} aria-label={t('Supprimer {nom}', { nom: sub.titre })}>
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
