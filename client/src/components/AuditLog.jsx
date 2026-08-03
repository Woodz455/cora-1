import { useState, useMemo } from 'react';
import { useApiResource } from '../useApiResource';
import Pagination from './Pagination';

const PAR_PAGE = 25;

const FILTRES_VIDES = { action: '', utilisateur: '', depuis: '', jusqu: '' };

/** Formes attendues avant le premier chargement, pour éviter tout garde partout. */
const VIDE = { lignes: [], total: 0, page: 1, nbPages: 1 };
const OPTIONS_VIDES = { actions: [], auteurs: [] };

/**
 * Noms de champs en clair.
 *
 * Le journal stocke les noms de colonnes, qui sont le bon niveau pour la base
 * mais pas pour la personne qui relit : « taxe_1_taux » ne se lit pas.
 */
const LIBELLES_CHAMPS = {
  nom_entreprise: 'Nom', nom_contact: 'Contact', email: 'Courriel',
  adresse: 'Adresse', langue: 'Langue', province: 'Province',
  entreprise_nom: "Nom de l'entreprise", entreprise_adresse: 'Adresse',
  entreprise_email: 'Courriel',
  taxe_1_nom: 'Nom de la taxe 1', taxe_1_taux: 'Taux de la taxe 1',
  taxe_1_numero: 'Numéro de la taxe 1',
  taxe_2_nom: 'Nom de la taxe 2', taxe_2_taux: 'Taux de la taxe 2',
  taxe_2_numero: 'Numéro de la taxe 2',
  payment_instructions: 'Instructions de paiement',
  relances_actives: 'Relances automatiques', relances_paliers: 'Paliers de relance',
  sauvegarde_active: 'Sauvegardes automatiques', sauvegarde_dossier: 'Dossier des sauvegardes',
  sauvegarde_retention: 'Sauvegardes conservées',
  username: 'Identifiant', role: 'Rôle', numero: 'Numéro', nom: 'Nom',
  montant_total: 'Montant', motif: 'Motif', facture: 'Facture',
  mot_de_passe_change: 'Mot de passe changé', sauvegarde: 'Sauvegarde',
  datee_du: 'Datée du'
};

const nommer = (champ) => LIBELLES_CHAMPS[champ] || champ.replace(/_/g, ' ');

/** Une valeur vide se lit mieux « vide » que par un blanc. */
const afficher = (valeur) => (
  valeur === null || valeur === undefined || valeur === '' ? 'vide' : String(valeur)
);

/**
 * Rend lisible le détail d'une entrée.
 *
 * Le journal stocke du JSON pour rester exploitable ; l'afficher brut à un
 * comptable ne l'aiderait pas.
 */
function decrire(details) {
  if (!details) return '—';

  const transition = (champ, { avant, apres }) => (
    `${nommer(champ)} : « ${afficher(avant)} » → « ${afficher(apres)} »`
  );

  if (details.changements) {
    return Object.entries(details.changements).map(([c, v]) => transition(c, v)).join(' · ');
  }

  return Object.entries(details)
    .filter(([, valeur]) => valeur !== null && valeur !== undefined)
    .map(([cle, valeur]) => {
      if (valeur && typeof valeur === 'object' && 'avant' in valeur) return transition(cle, valeur);
      if (typeof valeur === 'boolean') return valeur ? nommer(cle) : null;
      return `${nommer(cle)} : ${valeur}`;
    })
    .filter(Boolean)
    .join(' · ') || '—';
}

/**
 * Journal des actions sensibles.
 *
 * La pagination est demandée au serveur, contrairement aux autres écrans de
 * liste qui chargent tout et découpent au navigateur : le journal est la seule
 * table qui ne fait que croître et n'est jamais purgée.
 */
function AuditLog() {
  const [filtres, setFiltres] = useState(FILTRES_VIDES);
  const [page, setPage] = useState(1);

  // L'URL porte l'état de la recherche : `useApiResource` recharge de lui-même
  // dès qu'elle change, et ignore les réponses devenues obsolètes.
  const url = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), parPage: String(PAR_PAGE) });
    for (const [cle, valeur] of Object.entries(filtres)) {
      if (valeur) params.set(cle, valeur);
    }
    return `/api/audit?${params}`;
  }, [filtres, page]);

  const { data: donnees, loading: chargement, error: erreur } = useApiResource(url, VIDE);
  const { data: options } = useApiResource('/api/audit/filtres', OPTIONS_VIDES);

  const changerFiltre = (champ, valeur) => {
    // Revenir en première page : rester en page 4 d'un filtre qui n'a plus que
    // deux pages afficherait un tableau vide sans explication.
    setPage(1);
    setFiltres((prec) => ({ ...prec, [champ]: valeur }));
  };

  const filtreActif = Object.values(filtres).some(Boolean);

  return (
    <div className="glass-panel" style={{ padding: '25px' }}>
      <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
        Chaque action sensible est consignée ici : annulation d'un encaissement, suppression
        d'une facture, changement d'un taux de taxe, modification d'un compte. Le journal ne
        peut être ni modifié ni vidé, y compris depuis la base.
      </p>

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '20px' }}>
        <div className="form-group" style={{ margin: 0, minWidth: '200px' }}>
          <label htmlFor="filtre-action">Action</label>
          <select
            id="filtre-action" className="form-control"
            value={filtres.action} onChange={(e) => changerFiltre('action', e.target.value)}
          >
            <option value="">Toutes</option>
            {options.actions.map((a) => <option key={a.valeur} value={a.valeur}>{a.libelle}</option>)}
          </select>
        </div>

        <div className="form-group" style={{ margin: 0, minWidth: '160px' }}>
          <label htmlFor="filtre-auteur">Auteur</label>
          <select
            id="filtre-auteur" className="form-control"
            value={filtres.utilisateur} onChange={(e) => changerFiltre('utilisateur', e.target.value)}
          >
            <option value="">Tous</option>
            {options.auteurs.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>

        <div className="form-group" style={{ margin: 0 }}>
          <label htmlFor="filtre-depuis">Du</label>
          <input
            id="filtre-depuis" type="date" className="form-control"
            value={filtres.depuis} onChange={(e) => changerFiltre('depuis', e.target.value)}
          />
        </div>

        <div className="form-group" style={{ margin: 0 }}>
          <label htmlFor="filtre-jusqu">Au</label>
          <input
            id="filtre-jusqu" type="date" className="form-control"
            value={filtres.jusqu} onChange={(e) => changerFiltre('jusqu', e.target.value)}
          />
        </div>

        {filtreActif && (
          <button
            type="button" className="btn-secondary"
            onClick={() => { setPage(1); setFiltres(FILTRES_VIDES); }}
          >
            Effacer les filtres
          </button>
        )}
      </div>

      {erreur && <p className="alert alert-error" role="alert">{erreur}</p>}

      {chargement ? (
        <p style={{ color: 'var(--text-muted)' }}>Chargement…</p>
      ) : donnees.lignes.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>
          {filtreActif
            ? 'Aucune entrée ne correspond à ces critères.'
            : 'Aucune action sensible n\'a encore été consignée.'}
        </p>
      ) : (
        <>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            {donnees.total} entrée(s).
          </p>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Auteur</th>
                  <th>Action</th>
                  <th>Détail</th>
                </tr>
              </thead>
              <tbody>
                {donnees.lignes.map((l) => (
                  <tr key={l.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {new Date(l.date_heure).toLocaleString('fr-CA')}
                    </td>
                    <td>
                      {l.utilisateur || '—'}
                      {l.role && (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}> ({l.role})</span>
                      )}
                    </td>
                    <td>{l.libelle}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{decrire(l.details)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={donnees.page} nbPages={donnees.nbPages} onChange={setPage} />
        </>
      )}
    </div>
  );
}

export default AuditLog;
