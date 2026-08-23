import { useState } from 'react';
import { Building2, Plus, ArrowRight } from 'lucide-react';
import { api } from '../api';

/**
 * Choix du dossier d'entreprise.
 *
 * N'apparaît que lorsqu'il y a réellement un choix à faire : avec un seul
 * dossier accessible, la connexion l'ouvre d'elle-même. Imposer un écran
 * intermédiaire à qui n'a qu'une entreprise serait une friction quotidienne
 * pour la majorité des utilisateurs.
 */
function ChoixEntreprise({ entreprises, onOuvert, onAnnuler }) {
  const [enCours, setEnCours] = useState(null);
  const [creation, setCreation] = useState(false);
  const [nouveau, setNouveau] = useState('');
  const [erreur, setErreur] = useState(null);

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
    try {
      const r = await api.post('/api/entreprises', { nom: nouveau });
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
        <img
          src="/images/logotype.png" alt="Clora"
          style={{ height: '38px', marginBottom: '2rem' }}
        />

        <h1 style={{ fontSize: '1.4rem', margin: '0 0 .4rem' }}>Quel dossier ouvrir&nbsp;?</h1>
        <p style={{ color: 'var(--text-muted)', margin: '0 0 1.5rem', fontSize: '.9rem' }}>
          Chaque dossier a sa propre comptabilité. Rien n'y est partagé avec les autres.
        </p>

        {erreur && (
          <p style={{ color: 'var(--status-danger)', fontSize: '.9rem' }}>{erreur}</p>
        )}

        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1.25rem' }}>
          {entreprises.map((e) => (
            <li key={e.id} style={{ marginBottom: '.5rem' }}>
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
                    {e.role}
                  </span>
                </span>
                {enCours === e.id
                  ? <span style={{ fontSize: '.85rem', color: 'var(--text-muted)' }}>Ouverture…</span>
                  : <ArrowRight size={16} style={{ opacity: .5 }} />}
              </button>
            </li>
          ))}
        </ul>

        {creation ? (
          <form onSubmit={creer} style={{ display: 'flex', gap: '.5rem' }}>
            <input
              className="form-control" autoFocus placeholder="Nom de l'entreprise"
              value={nouveau} onChange={(ev) => setNouveau(ev.target.value)}
            />
            <button type="submit" className="btn-primary" disabled={!nouveau.trim()}>Créer</button>
          </form>
        ) : (
          <button
            type="button" className="btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '.5rem' }}
            onClick={() => setCreation(true)}
          >
            <Plus size={16} /> Nouveau dossier
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
            Annuler
          </button>
        )}
      </div>
    </div>
  );
}

export default ChoixEntreprise;
