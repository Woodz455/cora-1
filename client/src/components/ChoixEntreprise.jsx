import { useEffect, useState } from 'react';
import { Building2, Plus, ArrowRight, Pencil, Archive, ArchiveRestore } from 'lucide-react';
import { api } from '../api';
import ChoixProfil from './ChoixProfil';
import { useFeedback } from '../FeedbackContext';
import { useLangue } from '../i18n.js';
import Logotype from './Logotype';

/** Petit bouton d'action, à côté de la rangée d'un dossier. */
const STYLE_ACTION = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: '2.4rem', borderRadius: '10px', cursor: 'pointer',
  border: '1px solid var(--glass-border)', background: 'var(--card-bg)', color: 'inherit'
};

/**
 * Choix du dossier d'entreprise.
 *
 * N'apparaît que lorsqu'il y a réellement un choix à faire : avec un seul
 * dossier accessible, la connexion l'ouvre d'elle-même. Imposer un écran
 * intermédiaire à qui n'a qu'une entreprise serait une friction quotidienne
 * pour la majorité des utilisateurs.
 */
function ChoixEntreprise({ entreprises, ouvertId = null, onOuvert, onListe, onAnnuler }) {
  const [enCours, setEnCours] = useState(null);
  const [creation, setCreation] = useState(false);
  const [nouveau, setNouveau] = useState('');
  const [profil, setProfil] = useState('');
  const [erreur, setErreur] = useState(null);
  // Dossier dont le nom est en cours de modification, et ce nom.
  const [renomme, setRenomme] = useState(null);
  const [archives, setArchives] = useState([]);
  const [voirArchives, setVoirArchives] = useState(false);
  const { t } = useLangue();
  const { confirmer } = useFeedback();

  /** Relit les deux listes après un changement : le serveur fait foi. */
  const relire = async () => {
    const r = await api.get('/api/entreprises');
    setArchives(r.archives || []);
    if (onListe) onListe(r.entreprises || []);
  };

  useEffect(() => {
    api.get('/api/entreprises').then((r) => setArchives(r.archives || [])).catch(() => {});
  }, []);

  const renommer = async (e) => {
    e.preventDefault();
    setErreur(null);
    try {
      await api.put(`/api/entreprises/${renomme.id}`, { nom: renomme.nom });
      setRenomme(null);
      await relire();
    } catch (err) {
      setErreur(err.message);
    }
  };

  const archiver = async (entreprise, archive) => {
    if (archive) {
      const accepte = await confirmer({
        titre: t('Archiver le dossier « {nom} » ?', { nom: entreprise.nom }),
        message: t("Il ne sera plus proposé à l'ouverture, ni sauvegardé tant qu'il reste archivé. "
          + 'Rien n\'est effacé : vous pourrez le réactiver ici.'),
        libelleConfirmer: t('Archiver')
      });
      if (!accepte) return;
    }
    setErreur(null);
    try {
      await api.put(`/api/entreprises/${entreprise.id}/archive`, { archive });
      await relire();
    } catch (err) {
      setErreur(err.message);
    }
  };

  const ouvrir = async (entreprise) => {
    setEnCours(entreprise.id);
    setErreur(null);
    try {
      const r = await api.post(`/api/entreprises/${entreprise.id}/ouvrir`, {});
      onOuvert(r.ouvert);
    } catch (err) {
      setErreur(err.message);
      setEnCours(null);
    }
  };

  const creer = async (e) => {
    e.preventDefault();
    setErreur(null);
    if (!profil) {
      setErreur(t('Choisissez le profil qui décrit le mieux cette entreprise.'));
      return;
    }
    try {
      const r = await api.post('/api/entreprises', { nom: nouveau, profil });
      onOuvert(r.entreprise);
    } catch (err) {
      setErreur(err.message);
    }
  };

  return (
    <div style={{
      display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center',
      padding: '2rem', color: 'var(--text-main)'
    }}>
      <div style={{ width: '100%', maxWidth: '30rem' }}>
        <Logotype style={{ height: '38px', marginBottom: '2rem' }} />

        <h1 style={{ fontSize: '1.4rem', margin: '0 0 .4rem' }}>{t('Quel dossier ouvrir\u00a0?')}</h1>
        <p style={{ color: 'var(--text-muted)', margin: '0 0 1.5rem', fontSize: '.9rem' }}>
          {t("Chaque dossier a sa propre comptabilité. Rien n'y est partagé avec les autres.")}
        </p>

        {erreur && (
          <p style={{ color: 'var(--status-danger)', fontSize: '.9rem' }}>{erreur}</p>
        )}

        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1.25rem' }}>
          {entreprises.map((e) => (renomme && renomme.id === e.id ? (
            <li key={e.id} style={{ marginBottom: '.5rem' }}>
              <form onSubmit={renommer} style={{ display: 'flex', gap: '.5rem' }}>
                <input
                  className="form-control" autoFocus maxLength={200} style={{ flex: 1 }}
                  aria-label={t('Nouveau nom du dossier')}
                  value={renomme.nom} onChange={(ev) => setRenomme({ ...renomme, nom: ev.target.value })}
                />
                <button type="submit" className="btn-primary" disabled={!renomme.nom.trim()}>{t('Enregistrer')}</button>
                <button type="button" className="btn-secondary" onClick={() => setRenomme(null)}>{t('Annuler')}</button>
              </form>
            </li>
          ) : (
            <li key={e.id} style={{ marginBottom: '.5rem', display: 'flex', gap: '.4rem' }}>
              <button
                type="button"
                onClick={() => ouvrir(e)}
                disabled={enCours !== null}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '.75rem',
                  padding: '.9rem 1rem', borderRadius: '10px', cursor: 'pointer',
                  border: '1px solid var(--glass-border)', background: 'var(--card-bg)',
                  color: 'inherit', textAlign: 'left', font: 'inherit'
                }}
              >
                <Building2 size={18} style={{ flexShrink: 0, opacity: .7 }} />
                <span style={{ flex: 1 }}>
                  {e.nom}
                  {/* Le rôle est annoncé ici plutôt que découvert au premier
                      bouton grisé : on peut être administrateur chez un client
                      et simple lecteur chez un autre. */}
                  <span style={{ display: 'block', fontSize: '.8rem', color: 'var(--text-muted)' }}>
                    {t(e.role)}
                  </span>
                </span>
                {enCours === e.id
                  ? <span style={{ fontSize: '.85rem', color: 'var(--text-muted)' }}>{t('Ouverture…')}</span>
                  : <ArrowRight size={16} style={{ opacity: .5 }} />}
              </button>
              {/* Renommer et archiver changent ce que voient tous ceux qui ont
                  accès au dossier : réservés à son administrateur. Le dossier
                  ouvert ne s'archive pas, on en ouvre d'abord un autre. */}
              {e.role === 'admin' && (
                <button
                  type="button" style={STYLE_ACTION} disabled={enCours !== null}
                  onClick={() => setRenomme({ id: e.id, nom: e.nom })}
                  aria-label={t('Renommer le dossier « {nom} »', { nom: e.nom })} title={t('Renommer')}
                >
                  <Pencil size={16} aria-hidden="true" />
                </button>
              )}
              {e.role === 'admin' && (
                <button
                  type="button" disabled={enCours !== null || e.id === ouvertId}
                  style={{ ...STYLE_ACTION, ...(e.id === ouvertId ? { opacity: .4, cursor: 'not-allowed' } : {}) }}
                  onClick={() => archiver(e, true)}
                  aria-label={t('Archiver le dossier « {nom} »', { nom: e.nom })}
                  title={e.id === ouvertId ? t("Ouvrez un autre dossier avant d'archiver celui-ci.") : t('Archiver')}
                >
                  <Archive size={16} aria-hidden="true" />
                </button>
              )}
            </li>
          )))}
        </ul>

        {archives.length > 0 && (
          <div style={{ margin: '0 0 1.25rem' }}>
            <button
              type="button" onClick={() => setVoirArchives(!voirArchives)} aria-expanded={voirArchives}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', font: 'inherit', padding: 0, fontSize: '.9rem' }}
            >
              {voirArchives ? t('Masquer les dossiers archivés') : t('Dossiers archivés ({n})', { n: archives.length })}
            </button>
            {voirArchives && (
              <ul style={{ listStyle: 'none', padding: 0, margin: '.5rem 0 0' }}>
                {archives.map((e) => (
                  <li key={e.id} style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.6rem 1rem', marginBottom: '.4rem', borderRadius: '10px', border: '1px dashed var(--glass-border)', color: 'var(--text-muted)' }}>
                    <Archive size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
                    <span style={{ flex: 1 }}>{e.nom}</span>
                    {e.role === 'admin' && (
                      <button
                        type="button" className="btn-secondary" onClick={() => archiver(e, false)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem' }}
                      >
                        <ArchiveRestore size={16} aria-hidden="true" /> {t('Réactiver')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {creation ? (
          <form onSubmit={creer} style={{ display: 'flex', flexDirection: 'column', gap: '.9rem' }}>
            <input
              className="form-control" autoFocus placeholder={t("Nom de l'entreprise")}
              aria-label={t("Nom de l'entreprise")} maxLength={200}
              value={nouveau} onChange={(ev) => setNouveau(ev.target.value)}
            />
            <ChoixProfil valeur={profil} onChange={setProfil} />
            <button type="submit" className="btn-primary" disabled={!nouveau.trim()} style={{ alignSelf: 'flex-start' }}>
              {t('Créer le dossier')}
            </button>
          </form>
        ) : (
          <button
            type="button" className="btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '.5rem' }}
            onClick={() => setCreation(true)}
          >
            <Plus size={16} /> {t('Nouveau dossier')}
          </button>
        )}

        {onAnnuler && (
          <button
            type="button"
            onClick={onAnnuler}
            style={{
              display: 'block', marginTop: '1.5rem', background: 'none', border: 'none',
              color: 'var(--text-muted)', cursor: 'pointer', font: 'inherit', padding: 0
            }}
          >
            {t('Annuler')}
          </button>
        )}
      </div>
    </div>
  );
}

export default ChoixEntreprise;
