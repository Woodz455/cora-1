import { useState } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import { useLangue } from '../i18n.js';
import SelecteurLangue from './SelecteurLangue';

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
  const { t } = useLangue();
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
        {/* L'écran passe avant la connexion : la langue se choisit ici, comme à
            l'écran de connexion, faute de compte qui la porterait. */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' }}>
          <img src="/images/logotype.png" alt="Clora" style={{ height: '38px' }} />
          <SelecteurLangue />
        </div>

        <h1 style={{ fontSize: '1.4rem', margin: '0 0 .5rem' }}>
          {maintenanceExpiree ? t('Cette version dépasse votre maintenance') : t("Votre période d'essai est terminée")}
        </h1>

        {maintenanceExpiree ? (
          <p style={{ color: 'var(--text-muted)', margin: '0 0 1.5rem', lineHeight: 1.6 }}>
            {t("Votre licence couvre la maintenance jusqu'au ")}<strong>{etat.maintenance_jusqu_au}</strong>
            {t(', et cette version date du ')}<strong>{etat.version_date}</strong>
            {t('. Renouvelez la maintenance pour continuer ici, ou réinstallez une version antérieure : ')}
            <strong>{t('votre licence y reste valable pour toujours.')}</strong>
          </p>
        ) : (
          <p style={{ color: 'var(--text-muted)', margin: '0 0 1.5rem', lineHeight: 1.6 }}>
            {t('Saisissez votre clé de licence pour continuer.')}
          </p>
        )}

        {/* Dit avant tout le reste : rien n'a été perdu. C'est la première
            question de quiconque voit son logiciel comptable se fermer. */}
        <p style={{
          display: 'flex', gap: '.6rem', alignItems: 'flex-start',
          padding: '.9rem 1rem', marginBottom: '1.5rem', borderRadius: '10px',
          background: 'rgba(36, 168, 144, .09)', border: '1px solid var(--glass-border)',
          fontSize: '.9rem'
        }}>
          <ShieldCheck size={18} style={{ flexShrink: 0, marginTop: '.1rem' }} />
          <span>
            {t("Vos factures, vos clients et vos écritures sont intacts, à leur place habituelle. "
              + "Rien n'a été effacé ni verrouillé.")}
          </span>
        </p>

        <form onSubmit={activer}>
          <div className="form-group">
            <label htmlFor="cle-licence">{t('Clé de licence')}</label>
            <textarea
              id="cle-licence" className="form-control" rows={3} autoFocus
              value={cle} onChange={(ev) => setCle(ev.target.value)}
              placeholder="CLORA-…"
              style={{ fontFamily: 'ui-monospace, monospace', fontSize: '.8rem', resize: 'vertical' }}
            />
            <small style={{ color: 'var(--text-muted)' }}>
              {t('Collez la clé reçue par courriel, en entier.')}
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
            {enCours ? t('Vérification…') : t('Activer')}
          </button>
        </form>
      </div>
    </div>
  );
}

export default Licence;
