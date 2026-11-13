import { useEffect, useRef, useState } from 'react';
import { FileText, Image as ImageIcon, ExternalLink, Download, Trash2 } from 'lucide-react';
import { api } from '../api';
import { useModale } from '../useModale';
import { useFeedback } from '../FeedbackContext';
import { useLangue } from '../i18n.js';

/** Formats acceptés : les mêmes que le serveur, qui les vérifie à leur contenu. */
const ACCEPTES = 'application/pdf,image/jpeg,image/png,image/webp';

/** « 245 Ko », « 3,1 Mo » : une taille lisible plutôt qu'un nombre d'octets. */
function taille(octets, langue) {
  const locale = langue === 'en' ? 'en-CA' : 'fr-CA';
  if (octets < 1024 * 1024) {
    return `${Math.max(1, Math.round(octets / 1024)).toLocaleString(locale)} ${langue === 'en' ? 'KB' : 'Ko'}`;
  }
  return `${(octets / (1024 * 1024)).toLocaleString(locale, { maximumFractionDigits: 1 })} ${langue === 'en' ? 'MB' : 'Mo'}`;
}

/**
 * Les reçus d'une dépense : les joindre, les rouvrir, les retirer.
 *
 * Ouverte aussi pour une dépense d'une période close : on peut encore y
 * joindre un reçu, qui complète la justification sans changer les chiffres.
 * Seul le retrait y est refusé.
 */
function PiecesJustificatives({ depense, onFermer, onChangement }) {
  const modaleRef = useModale(onFermer);
  const { notifier, confirmer } = useFeedback();
  const { langue, t } = useLangue();
  const [pieces, setPieces] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const champFichier = useRef(null);

  const libelle = depense.fournisseur || depense.description || depense.date_depense;
  const close = Boolean(depense.verrouillee);

  const charger = () => api.get(`/api/depenses/${depense.id}/pieces`)
    .then(setPieces)
    .catch((err) => setErreur(err.message));

  useEffect(() => { charger(); }, [depense.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const joindre = async (fichiers) => {
    if (!fichiers || fichiers.length === 0) return;
    setEnvoi(true);
    setErreur(null);
    try {
      for (const fichier of fichiers) {
        await api.envoyerFichier(`/api/depenses/${depense.id}/pieces`, fichier);
      }
      notifier(t('Pièce jointe.'));
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoi(false);
      if (champFichier.current) champFichier.current.value = '';
      await charger();
      onChangement();
    }
  };

  /**
   * Dans l'application de bureau, la pièce s'ouvre dans la visionneuse du
   * système. Ailleurs, elle se télécharge.
   */
  const ouvrir = async (piece) => {
    try {
      await api.post(`/api/depenses/pieces/${piece.id}/ouvrir`, {});
    } catch (err) {
      if (err.status === 501) {
        window.location.assign(`/api/depenses/pieces/${piece.id}?telecharger=1`);
      } else {
        setErreur(err.message);
      }
    }
  };

  const retirer = async (piece) => {
    const accepte = await confirmer({
      titre: t('Retirer « {nom} » ?', { nom: piece.nom }),
      message: t('La pièce ne sera plus jointe à cette dépense. Les exemplaires déjà déposés dans le '
        + 'dossier des sauvegardes sont conservés.'),
      libelleConfirmer: t('Retirer'),
      danger: true
    });
    if (!accepte) return;
    try {
      await api.del(`/api/depenses/pieces/${piece.id}`);
      notifier(t('Pièce retirée.'));
      await charger();
      onChangement();
    } catch (err) {
      setErreur(err.message);
    }
  };

  const titre = t('Pièces justificatives : {depense}', { depense: libelle });

  return (
    <div ref={modaleRef} className="modal-overlay" role="dialog" aria-modal="true" aria-label={titre}>
      <div className="modal-content glass-panel" style={{ maxWidth: '640px', maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ marginTop: 0 }}>{titre}</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: 0 }}>
          {t('Conservez vos reçus six ans : les autorités fiscales peuvent les demander. Ils sont '
            + 'gardés avec le dossier et déposés dans le dossier des sauvegardes, chiffrés si vos '
            + 'sauvegardes le sont.')}
        </p>

        {erreur && <p className="alert alert-error" role="alert">{erreur}</p>}

        {pieces === null ? (
          <p style={{ color: 'var(--text-muted)' }}>{t('Chargement…')}</p>
        ) : pieces.length === 0 ? (
          <p className="empty-state" style={{ padding: '16px' }}>{t('Aucune pièce jointe à cette dépense.')}</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px 0', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {pieces.map((piece) => {
              const estImage = piece.type.startsWith('image/');
              const Icone = estImage ? ImageIcon : FileText;
              return (
                <li key={piece.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px', border: '1px solid var(--glass-border)', borderRadius: '8px' }}>
                  {estImage ? (
                    <img src={`/api/depenses/pieces/${piece.id}`} alt="" style={{ width: '48px', height: '48px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} />
                  ) : (
                    <Icone size={32} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={piece.nom}>{piece.nom}</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      {t('{taille}, jointe le {date} par {auteur}', {
                        taille: taille(piece.taille, langue),
                        date: String(piece.ajoute_le).slice(0, 10),
                        auteur: piece.ajoute_par || t('inconnu')
                      })}
                    </div>
                  </div>
                  <button type="button" className="btn-icon" onClick={() => ouvrir(piece)} aria-label={t('Ouvrir « {nom} »', { nom: piece.nom })} title={t('Ouvrir')}>
                    <ExternalLink size={16} aria-hidden="true" />
                  </button>
                  <a className="btn-icon" href={`/api/depenses/pieces/${piece.id}?telecharger=1`} download={piece.nom} aria-label={t('Télécharger « {nom} »', { nom: piece.nom })} title={t('Télécharger')}>
                    <Download size={16} aria-hidden="true" />
                  </a>
                  {!close && (
                    <button type="button" className="btn-danger" onClick={() => retirer(piece)} aria-label={t('Retirer « {nom} »', { nom: piece.nom })} title={t('Retirer')}>
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {close && (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            {t('Cette dépense appartient à une période verrouillée : vous pouvez y joindre un reçu, mais pas en retirer.')}
          </p>
        )}

        <div className="form-group">
          <label htmlFor="pieces-fichier">{t('Joindre un reçu (PDF ou image, 15 Mo au plus)')}</label>
          <input
            id="pieces-fichier" ref={champFichier} type="file" className="form-control" style={{ padding: '8px' }}
            accept={ACCEPTES} multiple disabled={envoi}
            onChange={(e) => joindre([...e.target.files])}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
          <button type="button" className="btn-primary" onClick={onFermer} disabled={envoi}>
            {envoi ? t('Envoi en cours…') : t('Fermer')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PiecesJustificatives;
