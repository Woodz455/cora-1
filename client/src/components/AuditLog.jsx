import { useState, useMemo } from 'react';
import { useApiResource } from '../useApiResource';
import Pagination from './Pagination';
import { useLangue } from '../i18n.js';

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
  payment_instructions_en: 'Instructions de paiement (anglais)',
  relances_actives: 'Relances automatiques', relances_paliers: 'Paliers de relance',
  sauvegarde_active: 'Sauvegardes automatiques', sauvegarde_dossier: 'Dossier des sauvegardes',
  sauvegarde_retention: 'Sauvegardes conservées',
  username: 'Identifiant', role: 'Rôle', numero: 'Numéro', nom: 'Nom',
  montant_total: 'Montant', motif: 'Motif', facture: 'Facture',
  mot_de_passe_change: 'Mot de passe changé', sauvegarde: 'Sauvegarde',
  datee_du: 'Datée du',
  // Ces champs s'affichaient sous leur nom de colonne, sans libellé. Le
  // français les garde tels quels ; l'anglais leur donne un vrai nom.
  verifier_maj: 'verifier maj', profil: 'profil', conditions_defaut: 'conditions defaut',
  smtp_host: 'smtp host', smtp_port: 'smtp port', smtp_user: 'smtp user',
  stripe_actif: 'stripe actif',
  conditions_paiement: 'conditions paiement', fichier: 'fichier', inseres: 'inseres',
  ignores: 'ignores', rejetes: 'rejetes', annee: 'annee', taux_1: 'taux 1', taux_2: 'taux 2',
  seuil_km: 'seuil km', facture_id: 'facture id', devise: 'devise', mode: 'mode', session: 'session'
};

/** Rôles et auteur automatique, enregistrés en français. */
const VALEURS = new Set(['admin', 'comptable', 'employe', 'automatique', '[non journalisé]']);

/**
 * Rend lisible le détail d'une entrée.
 *
 * Le journal stocke du JSON pour rester exploitable ; l'afficher brut à un
 * comptable ne l'aiderait pas. Les valeurs consignées (un nom, un motif) restent
 * telles qu'elles ont été saisies ; seuls les noms de champs et les rôles se
 * traduisent.
 */
function decrire(details, t) {
  // Un rôle se traduit ; toute autre valeur reste telle que consignée.
  const traduireValeur = (valeur) => (VALEURS.has(valeur) ? t(valeur) : String(valeur));
  const nommer = (champ) => (LIBELLES_CHAMPS[champ] ? t(LIBELLES_CHAMPS[champ]) : champ.replace(/_/g, ' '));
  /** Une valeur vide se lit mieux « vide » que par un blanc. */
  const afficher = (valeur) => {
    if (valeur === null || valeur === undefined || valeur === '') return t('vide');
    return traduireValeur(valeur);
  };

  if (!details) return '-';

  const transition = (champ, { avant, apres }) => (
    t('{champ} : « {avant} » → « {apres} »', { champ: nommer(champ), avant: afficher(avant), apres: afficher(apres) })
  );

  if (details.changements) {
    return Object.entries(details.changements).map(([c, v]) => transition(c, v)).join(' · ');
  }

  return Object.entries(details)
    .filter(([, valeur]) => valeur !== null && valeur !== undefined)
    .map(([cle, valeur]) => {
      if (valeur && typeof valeur === 'object' && 'avant' in valeur) return transition(cle, valeur);
      if (typeof valeur === 'boolean') return valeur ? nommer(cle) : null;
      return t('{champ} : {valeur}', { champ: nommer(cle), valeur: traduireValeur(valeur) });
    })
    .filter(Boolean)
    .join(' · ') || '-';
}

/**
 * Journal des actions sensibles.
 *
 * La pagination est demandée au serveur, contrairement aux autres écrans de
 * liste qui chargent tout et découpent au navigateur : le journal est la seule
 * table qui ne fait que croître et n'est jamais purgée.
 */
function AuditLog() {
  const { langue, t, tp } = useLangue();
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
    <div className="glass-panel" style={{ padding: '24px' }}>
      <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
        {t("Chaque action sensible est consignée ici : annulation d'un encaissement, suppression "
          + "d'une facture, changement d'un taux de taxe, modification d'un compte. Le journal ne "
          + 'peut être ni modifié ni vidé, y compris depuis la base.')}
      </p>

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '20px' }}>
        <div className="form-group" style={{ margin: 0, minWidth: '200px' }}>
          <label htmlFor="filtre-action">{t('Action')}</label>
          <select
            id="filtre-action" className="form-control"
            value={filtres.action} onChange={(e) => changerFiltre('action', e.target.value)}
          >
            <option value="">{t('Toutes')}</option>
            {options.actions.map((a) => <option key={a.valeur} value={a.valeur}>{t(a.libelle)}</option>)}
          </select>
        </div>

        <div className="form-group" style={{ margin: 0, minWidth: '160px' }}>
          <label htmlFor="filtre-auteur">{t('Auteur')}</label>
          <select
            id="filtre-auteur" className="form-control"
            value={filtres.utilisateur} onChange={(e) => changerFiltre('utilisateur', e.target.value)}
          >
            <option value="">{t('Tous')}</option>
            {options.auteurs.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>

        <div className="form-group" style={{ margin: 0 }}>
          <label htmlFor="filtre-depuis">{t('Du')}</label>
          <input
            id="filtre-depuis" type="date" className="form-control"
            value={filtres.depuis} onChange={(e) => changerFiltre('depuis', e.target.value)}
          />
        </div>

        <div className="form-group" style={{ margin: 0 }}>
          <label htmlFor="filtre-jusqu">{t('Au')}</label>
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
            {t('Effacer les filtres')}
          </button>
        )}
      </div>

      {erreur && <p className="alert alert-error" role="alert">{erreur}</p>}

      {chargement ? (
        <p style={{ color: 'var(--text-muted)' }}>{t('Chargement…')}</p>
      ) : donnees.lignes.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>
          {filtreActif
            ? t('Aucune entrée ne correspond à ces critères.')
            : t("Aucune action sensible n'a encore été consignée.")}
        </p>
      ) : (
        <>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            {tp(donnees.total, '{n} entrée(s).', '{n} entrée(s).|pluriel')}
          </p>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('Date')}</th>
                  <th>{t('Auteur')}</th>
                  <th>{t('Action')}</th>
                  <th>{t('Détail')}</th>
                </tr>
              </thead>
              <tbody>
                {donnees.lignes.map((l) => (
                  <tr key={l.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {new Date(l.date_heure).toLocaleString(langue === 'en' ? 'en-CA' : 'fr-CA')}
                    </td>
                    <td>
                      {l.utilisateur || '-'}
                      {l.role && (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}> ({VALEURS.has(l.role) ? t(l.role) : l.role})</span>
                      )}
                    </td>
                    <td>{t(l.libelle)}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{decrire(l.details, t)}</td>
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
