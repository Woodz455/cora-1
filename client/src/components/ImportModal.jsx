import { useState, useRef } from 'react';
import { Upload, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api } from '../api';

/**
 * Import d'un tableur, en trois temps : choisir le fichier, vérifier les
 * colonnes, confirmer.
 *
 * L'étape du milieu est celle qui compte. Aucun fichier réel n'a les en-têtes
 * qu'on espérait, et une correspondance devinée puis appliquée en silence
 * verserait des courriels dans la colonne des adresses sans que personne ne
 * s'en aperçoive. La proposition automatique est donc affichée, modifiable, et
 * le résultat montré avant toute écriture.
 */
function ImportModal({ modele, titre, onFerme, onTermine }) {
  const [fichier, setFichier] = useState(null);
  const [contenu, setContenu] = useState(null);
  const [apercu, setApercu] = useState(null);
  const [correspondance, setCorrespondance] = useState({});
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [resultat, setResultat] = useState(null);
  const champFichier = useRef(null);

  /** Demande un aperçu au serveur ; rien n'est écrit à ce stade. */
  const analyser = async (nom, base64, correspondanceForcee) => {
    setEnCours(true);
    setErreur(null);
    try {
      const r = await api.post('/api/import/apercu', {
        modele,
        nom_fichier: nom,
        contenu: base64,
        ...(correspondanceForcee ? { correspondance: correspondanceForcee } : {})
      });
      setApercu(r);
      setCorrespondance(r.correspondance);
    } catch (err) {
      setErreur(err.message);
      setApercu(null);
    } finally {
      setEnCours(false);
    }
  };

  const choisirFichier = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;

    const lecteur = new FileReader();
    lecteur.onload = () => {
      const base64 = String(lecteur.result).split('base64,')[1] || '';
      setFichier(f.name);
      setContenu(base64);
      setResultat(null);
      analyser(f.name, base64);
    };
    lecteur.onerror = () => setErreur("Ce fichier n'a pas pu être lu.");
    lecteur.readAsDataURL(f);
  };

  /** Change l'association d'un champ et redemande un aperçu. */
  const associer = (cle, valeur) => {
    const suivante = { ...correspondance };
    if (valeur === '') delete suivante[cle];
    else suivante[cle] = Number(valeur);

    setCorrespondance(suivante);
    analyser(fichier, contenu, suivante);
  };

  const executer = async () => {
    setEnCours(true);
    setErreur(null);
    try {
      const r = await api.post('/api/import/executer', {
        modele, nom_fichier: fichier, contenu, correspondance
      });
      setResultat(r);
      onTermine();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnCours(false);
    }
  };

  const champsRequisManquants = (apercu ? apercu.champs : [])
    .filter((c) => c.requis && correspondance[c.cle] === undefined)
    .map((c) => c.libelle);

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={titre}>
      {/* `glass-panel` porte le fond du panneau : sans elle le contenu flotte
          au-dessus de la page. La hauteur est bornée parce que la liste des
          lignes refusées peut être longue. */}
      <div
        className="modal-content glass-panel"
        style={{ maxWidth: '46rem', width: '90%', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <h3 style={{ marginTop: 0 }}>{titre}</h3>

        {resultat ? (
          <>
            <p style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
              <CheckCircle2 size={18} style={{ color: 'var(--status-paid)' }} />
              {resultat.message}
              {resultat.ignores > 0 && ` ${resultat.ignores} déjà présent(s), laissé(s) intact(s).`}
            </p>
            <div className="modal-actions">
              <button type="button" className="btn-primary" onClick={onFerme}>Fermer</button>
            </div>
          </>
        ) : (
          <>
            <p style={{ color: 'var(--text-muted)', fontSize: '.9rem' }}>
              Fichier Excel (.xlsx) ou CSV. La première ligne doit contenir les titres des colonnes.
            </p>

            <div className="form-group">
              <input
                ref={champFichier} type="file" accept=".xlsx,.csv,.txt"
                onChange={choisirFichier} className="form-control"
              />
            </div>

            {erreur && (
              <p style={{ color: 'var(--status-danger)', fontSize: '.9rem' }}>{erreur}</p>
            )}

            {apercu && (
              <>
                <h4 style={{ marginBottom: '.5rem' }}>Colonnes</h4>
                <p style={{ color: 'var(--text-muted)', fontSize: '.85rem', marginTop: 0 }}>
                  Vérifiez chaque association&nbsp;: c'est ici que se jouent les erreurs d'import.
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.6rem', marginBottom: '1.25rem' }}>
                  {apercu.champs.map((champ) => (
                    <label key={champ.cle} style={{ fontSize: '.9rem' }}>
                      {champ.libelle}{champ.requis && ' *'}
                      <select
                        className="form-control"
                        value={correspondance[champ.cle] ?? ''}
                        onChange={(e) => associer(champ.cle, e.target.value)}
                      >
                        <option value="">— non importé —</option>
                        {apercu.entetes.map((entete, i) => (
                          <option key={i} value={i}>{entete || `Colonne ${i + 1}`}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>

                <p style={{ fontSize: '.95rem' }}>
                  <strong>{apercu.valides}</strong> ligne(s) sur {apercu.total} seront importées.
                </p>

                {apercu.rejets.length > 0 && (
                  <details style={{ marginBottom: '1rem' }}>
                    <summary style={{ cursor: 'pointer', color: 'var(--status-warning)', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                      <AlertTriangle size={16} />
                      {apercu.rejets.length} ligne(s) seront ignorées — voir lesquelles
                    </summary>
                    {/* Toutes les lignes refusées, pas un échantillon : un import
                        où trente fiches disparaissent sans qu'on sache lesquelles
                        est inutilisable. */}
                    <ul style={{ maxHeight: '11rem', overflowY: 'auto', fontSize: '.85rem', marginTop: '.5rem' }}>
                      {apercu.rejets.map((r) => (
                        <li key={r.ligne}>
                          Ligne {r.ligne}{r.valeur ? ` (${r.valeur})` : ''} — {r.motif}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                {champsRequisManquants.length > 0 && (
                  <p style={{ color: 'var(--status-danger)', fontSize: '.9rem' }}>
                    Associez d'abord&nbsp;: {champsRequisManquants.join(', ')}.
                  </p>
                )}
              </>
            )}

            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={onFerme}>Annuler</button>
              <button
                type="button" className="btn-primary"
                disabled={!apercu || enCours || apercu.valides === 0 || champsRequisManquants.length > 0}
                onClick={executer}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '.5rem' }}
              >
                <Upload size={16} />
                {enCours ? 'Import en cours…' : `Importer ${apercu ? apercu.valides : ''} ligne(s)`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ImportModal;
