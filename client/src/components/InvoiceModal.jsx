import { useState, useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { api, calculerEcheance, CONDITIONS } from '../api';
import { useModale } from '../useModale';
import { useLangue } from '../i18n.js';

/** Identifiant local d'une ligne, stable pour la clé React. */
let compteurLignes = 0;
const nouvelleLigne = (valeurs = {}) => ({
  cle: `ligne-${++compteurLignes}`,
  description: '',
  quantite: 1,
  prix_unitaire: 0,
  ...valeurs
});

const dateISO = (date) => date.toISOString().split('T')[0];

function InvoiceModal({ factureIdToEdit, onClose, onSuccess, mode = 'facture' }) {
  const modaleRef = useModale(onClose);
  const estDevis = mode === 'devis';
  const { t, montant } = useLangue();

  const [clients, setClients] = useState([]);
  const [catalogue, setCatalogue] = useState([]);
  const [formData, setFormData] = useState(() => {
    const aujourdhui = new Date();
    const echeance = new Date();
    echeance.setDate(echeance.getDate() + 15);
    return {
      client_id: '',
      date_emission: dateISO(aujourdhui),
      date_echeance: dateISO(echeance),
      devise: 'CAD',
      taux_change: 1.0
    };
  });

  /**
   * Choisir un client réaligne l'échéance sur son terme de paiement.
   *
   * Elle reste modifiable ensuite : le terme est une valeur par défaut utile,
   * pas une contrainte. Un devis conserve sa date de validité, qui n'a rien à
   * voir avec un délai de règlement.
   */
  const choisirClient = (clientId) => {
    const client = clients.find((c) => String(c.id) === String(clientId));
    setFormData((prev) => ({
      ...prev,
      client_id: clientId,
      date_echeance: estDevis || !client
        ? prev.date_echeance
        : calculerEcheance(prev.date_emission, client.conditions_paiement)
    }));
  };

  /** Terme du client sélectionné, pour expliquer d'où vient l'échéance proposée. */
  const termeDuClient = (() => {
    const client = clients.find((c) => String(c.id) === String(formData.client_id));
    return client ? CONDITIONS.find((c) => c.valeur === (client.conditions_paiement || 'net30')) : null;
  })();

  const [lignes, setLignes] = useState([nouvelleLigne()]);
  const [loading, setLoading] = useState(false);
  const [chargement, setChargement] = useState(Boolean(factureIdToEdit));
  const [error, setError] = useState(null);

  useEffect(() => {
    let annule = false;

    const charger = async () => {
      try {
        const [listeClients, listeCatalogue] = await Promise.all([
          api.get('/api/clients'),
          api.get('/api/catalogue').catch(() => [])
        ]);
        if (annule) return;

        setClients(listeClients);
        setCatalogue(listeCatalogue);

        if (factureIdToEdit) {
          const endpoint = estDevis
            ? `/api/devis/${factureIdToEdit}/details`
            : `/api/factures/${factureIdToEdit}/details`;
          const data = await api.get(endpoint);
          if (annule) return;

          setFormData({
            client_id: data.client_details.id,
            date_emission: data.date_emission,
            date_echeance: estDevis ? data.date_validite : data.date_echeance,
            devise: data.devise || 'CAD',
            taux_change: data.taux_change || 1.0
          });
          setLignes(data.lignes.map((l) => nouvelleLigne({
            description: l.description,
            quantite: l.quantite,
            prix_unitaire: l.prix_unitaire
          })));
        } else if (listeClients.length > 0) {
          const premier = listeClients[0];
          setFormData((prev) => ({
            ...prev,
            client_id: premier.id,
            date_echeance: estDevis
              ? prev.date_echeance
              : calculerEcheance(prev.date_emission, premier.conditions_paiement)
          }));
        }
      } catch (err) {
        if (!annule) setError(err.message);
      } finally {
        if (!annule) setChargement(false);
      }
    };

    charger();
    // `mode` figure bien dans les dépendances : il déterminait le point d'entrée
    // à interroger sans jamais déclencher de rechargement.
    return () => { annule = true; };
  }, [factureIdToEdit, mode, estDevis]);

  /** Met à jour une ligne sans muter l'objet existant. */
  const handleLigneChange = (index, champs) => {
    setLignes((prev) => prev.map((ligne, i) => (i === index ? { ...ligne, ...champs } : ligne)));
  };

  const addLigne = () => setLignes((prev) => [...prev, nouvelleLigne()]);

  const removeLigne = (index) => {
    setLignes((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const baseUrl = estDevis ? '/api/devis' : '/api/factures';
      const payload = {
        client_id: formData.client_id,
        date_emission: formData.date_emission,
        devise: formData.devise,
        taux_change: parseFloat(formData.taux_change) || 1,
        lignes: lignes.map((l) => ({
          description: l.description,
          quantite: parseFloat(l.quantite),
          prix_unitaire: parseFloat(l.prix_unitaire)
        }))
      };
      if (estDevis) payload.date_validite = formData.date_echeance;
      else payload.date_echeance = formData.date_echeance;

      if (factureIdToEdit) await api.put(`${baseUrl}/${factureIdToEdit}`, payload);
      else await api.post(baseUrl, payload);

      onSuccess();
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const total = useMemo(
    () => lignes.reduce((sum, l) => sum + ((parseFloat(l.quantite) || 0) * (parseFloat(l.prix_unitaire) || 0)), 0),
    [lignes]
  );

  const titre = factureIdToEdit
    ? (estDevis ? t('Modifier le devis') : t('Modifier la facture'))
    : (estDevis ? t('Nouveau devis') : t('Nouvelle facture'));

  return (
    <div ref={modaleRef} className="modal-overlay" role="dialog" aria-modal="true" aria-label={titre}>
      <div className="modal-content glass-panel" style={{ maxWidth: '760px', width: '90%', maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ marginTop: 0, marginBottom: '24px', fontSize: '1.6rem', color: 'var(--text-main)', fontWeight: '700' }}>
          {titre}
        </h3>

        {error && <p className="alert alert-error" role="alert">{error}</p>}

        {chargement ? (
          <p style={{ color: 'var(--text-muted)' }}>{t('Chargement du document…')}</p>
        ) : clients.length === 0 ? (
          <>
            <p className="alert alert-info">
              {t("Créez d'abord un client dans le répertoire : un document doit être rattaché à un client.")}
            </p>
            <div style={{ textAlign: 'right' }}>
              <button type="button" className="btn-secondary" onClick={onClose}>{t('Fermer')}</button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
              <div className="form-group">
                <label htmlFor="doc-client">{t('Client *')}</label>
                <select
                  id="doc-client"
                  className="form-control"
                  value={formData.client_id}
                  onChange={(e) => choisirClient(e.target.value)}
                  required
                >
                  <option value="">{t('Sélectionner un client')}</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.nom_entreprise} ({c.province})</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  {t('Le numéro est généré automatiquement ({prefixe}-AAAAMM-NNNN). Les taxes suivent la province du client.', { prefixe: estDevis ? 'DEV' : 'SHT' })}
                </p>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
              <div className="form-group">
                <label htmlFor="doc-emission">{t("Date d'émission *")}</label>
                <input
                  id="doc-emission"
                  type="date"
                  className="form-control"
                  value={formData.date_emission}
                  onChange={(e) => setFormData({ ...formData, date_emission: e.target.value })}
                  disabled={Boolean(factureIdToEdit)}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="doc-echeance">{estDevis ? t('Date de validité *') : t("Date d'échéance *")}</label>
                <input
                  id="doc-echeance"
                  type="date"
                  className="form-control"
                  value={formData.date_echeance}
                  onChange={(e) => setFormData({ ...formData, date_echeance: e.target.value })}
                  min={formData.date_emission}
                  required
                />
                {!estDevis && termeDuClient && (
                  <small style={{ color: 'var(--text-muted)' }}>
                    {t('Terme du client : {terme}. La date reste modifiable.', { terme: t(termeDuClient.libelle) })}
                  </small>
                )}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '32px' }}>
              <div className="form-group">
                <label htmlFor="doc-devise">{t('Devise *')}</label>
                <select
                  id="doc-devise"
                  className="form-control"
                  value={formData.devise}
                  onChange={(e) => setFormData({
                    ...formData,
                    devise: e.target.value,
                    taux_change: e.target.value === 'CAD' ? 1.0 : formData.taux_change
                  })}
                >
                  <option value="CAD">{t('CAD (dollars canadiens)')}</option>
                  <option value="USD">{t('USD (dollars américains)')}</option>
                </select>
              </div>
              {formData.devise !== 'CAD' && (
                <div className="form-group">
                  <label htmlFor="doc-taux">{t('Taux de change (1 {devise} = ? CAD) *', { devise: formData.devise })}</label>
                  <input
                    id="doc-taux"
                    type="number"
                    step="0.0001"
                    min="0.0001"
                    className="form-control"
                    value={formData.taux_change}
                    onChange={(e) => setFormData({ ...formData, taux_change: e.target.value })}
                    required
                  />
                </div>
              )}
            </div>

            <h4 style={{ color: 'var(--text-main)', borderBottom: '1px solid var(--glass-border)', paddingBottom: '8px' }}>
              {t('Lignes de facturation')}
            </h4>

            {lignes.map((ligne, index) => (
              // La clé est propre à la ligne et non son index : supprimer une
              // ligne du milieu décalait les valeurs saisies dans les suivantes.
              <div key={ligne.cle} style={{ display: 'flex', gap: '16px', marginBottom: '16px', alignItems: 'flex-start' }}>
                <div className="form-group" style={{ flex: 3, marginBottom: 0 }}>
                  <input
                    type="text"
                    className="form-control"
                    placeholder={t('Description du service')}
                    aria-label={t('Description de la ligne {n}', { n: index + 1 })}
                    value={ligne.description}
                    onChange={(e) => handleLigneChange(index, { description: e.target.value })}
                    required
                  />
                  {catalogue.length > 0 && (
                    <select
                      className="form-control"
                      style={{ marginTop: '4px', padding: '4px', fontSize: '0.85rem' }}
                      aria-label={t('Insérer un service du catalogue dans la ligne {n}', { n: index + 1 })}
                      value=""
                      onChange={(e) => {
                        const item = catalogue.find((c) => String(c.id) === e.target.value);
                        if (!item) return;
                        handleLigneChange(index, {
                          description: item.nom + (item.description ? ` : ${item.description}` : ''),
                          prix_unitaire: item.prix_unitaire
                        });
                      }}
                    >
                      <option value="">{t('Insérer depuis le catalogue…')}</option>
                      {catalogue.map((c) => (
                        <option key={c.id} value={c.id}>{c.nom} ({montant(c.prix_unitaire)})</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  <input
                    type="number"
                    className="form-control"
                    placeholder={t('Qté / h')}
                    aria-label={t('Quantité de la ligne {n}', { n: index + 1 })}
                    value={ligne.quantite}
                    onChange={(e) => handleLigneChange(index, { quantite: e.target.value })}
                    min="0.01"
                    step="0.01"
                    required
                  />
                </div>
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  <input
                    type="number"
                    className="form-control"
                    placeholder={t('Prix / tarif')}
                    aria-label={t('Prix unitaire de la ligne {n}', { n: index + 1 })}
                    value={ligne.prix_unitaire}
                    onChange={(e) => handleLigneChange(index, { prix_unitaire: e.target.value })}
                    min="0"
                    step="0.01"
                    required
                  />
                </div>
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => removeLigne(index)}
                  disabled={lignes.length === 1}
                  aria-label={t('Supprimer la ligne {n}', { n: index + 1 })}
                  style={{ padding: '12px' }}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={addLigne}
              style={{ padding: '8px 16px', background: 'var(--glass-bg)', border: '1px dashed var(--safehill-blue)', color: 'var(--safehill-blue)', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' }}
            >
              {t('+ Ajouter une ligne')}
            </button>

            <div style={{ textAlign: 'right', marginTop: '20px', fontSize: '1.2rem', color: 'var(--text-main)' }}>
              {t('Sous-total hors taxes :')} <strong>{montant(total, formData.devise)}</strong>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                {t("Les taxes sont calculées à l'enregistrement, selon la province du client.")}
              </p>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '32px' }}>
              <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>{t('Annuler')}</button>
              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? t('Enregistrement…') : (factureIdToEdit ? t('Enregistrer les modifications') : (estDevis ? t('Créer le devis') : t('Créer la facture')))}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default InvoiceModal;
