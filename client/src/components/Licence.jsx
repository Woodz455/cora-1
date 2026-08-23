import { useState } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { api } from '../api';

/**
 * Écran d'activation, affiché quand l'installation n'est plus utilisable.
 *
 * Il passe avant la connexion : sans licence valable, il n'y a pas lieu de se
 * connecter, et demander un mot de passe pour ensuite refuser l'accès serait
 * une politesse inutile.
 *
 * Le message répète que **les données ne sont pas touchées**. C'est vrai, et
 * c'est ce que l'utilisateur veut savoir en premier quand un logiciel qui tient
 * sa comptabilité lui barre la route.
 */
function Licence({ etat, onActive }) {
  const [cle, setCle] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState(null);

  const maintenanceExpiree = etat.etat === 'maintenance_expiree';

  const activer = async (e) => {
    e.preventDefault();
    setEnCours(true);
    setErreur(null);
    try {
      onActive(await api.post('/api/licence/activer', { cle: cle.trim() }));
    } catch (err) {
      setErreur(err.message);
      setEnCours(false);
    }
  };

  return (
    <div style={{
      display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center',
      padding: '2rem', color: 'var(--text-main)'
    }}>
      <div style={{ width: '100%', maxWidth: '32rem' }}>
        <img src="/images/logotype.png" alt="Clora" style={{ height: '38px', marginBottom: '2rem' }} />

        <h1 style={{ fontSize: '1.4rem', margin: '0 0 .5rem' }}>
          {maintenanceExpiree ? 'Cette version dépasse votre maintenance' : "Votre période d'essai est terminée"}
        </h1>

        {maintenanceExpiree ? (
          <p style={{ color: 'var(--text-muted)', margin: '0 0 1.5rem', lineHeight: 1.6 }}>
            Votre licence couvre la maintenance jusqu'au <strong>{etat.maintenance_jusqu_au}</strong>,
            et cette version date du <strong>{etat.version_date}</strong>. Renouvelez la maintenance
            pour continuer ici, ou réinstallez une version antérieure —{' '}
            <strong>votre licence y reste valable pour toujours.</strong>
          </p>
        ) : (
          <p style={{ color: 'var(--text-muted)', margin: '0 0 1.5rem', lineHeight: 1.6 }}>
            Saisissez votre clé de licence pour continuer.
          </p>
        )}

        {/* Dit avant tout le reste : rien n'a été perdu. C'est la première
            question de quiconque voit son logiciel comptable se fermer. */}
        <p style={{
          display: 'flex', gap: '.6rem', alignItems: 'flex-start',
          padding: '.9rem 1rem', marginBottom: '1.5rem', borderRadius: '10px',
          background: 'rgba(36, 168, 144, .09)', borderLeft: '3px solid var(--safehill-teal)',
          fontSize: '.9rem'
        }}>
          <ShieldCheck size={18} style={{ flexShrink: 0, marginTop: '.1rem' }} />
          <span>
            Vos factures, vos clients et vos écritures sont intacts, à leur place habituelle.
            Rien n'a été effacé ni verrouillé.
          </span>
        </p>

        <form onSubmit={activer}>
          <div className="form-group">
            <label htmlFor="cle-licence">Clé de licence</label>
            <textarea
              id="cle-licence" className="form-control" rows={3} autoFocus
              value={cle} onChange={(ev) => setCle(ev.target.value)}
              placeholder="CLORA-…"
              style={{ fontFamily: 'ui-monospace, monospace', fontSize: '.8rem', resize: 'vertical' }}
            />
            <small style={{ color: 'var(--text-muted)' }}>
              Collez la clé reçue par courriel, en entier.
            </small>
          </div>

          {erreur && (
            <p style={{ color: 'var(--status-danger)', fontSize: '.9rem' }}>{erreur}</p>
          )}

          <button
            type="submit" className="btn-primary" disabled={enCours || !cle.trim()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '.5rem' }}
          >
            <KeyRound size={16} />
            {enCours ? 'Vérification…' : 'Activer'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default Licence;
