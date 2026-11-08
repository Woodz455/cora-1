import { useState } from 'react';
import { api } from '../api';
import { useLangue } from '../i18n.js';
import SelecteurLangue from './SelecteurLangue';
import Logotype from './Logotype';
import FeuilleDeSecours from './FeuilleDeSecours';

function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const { t, langue, changerLangue } = useLangue();
  // Une langue choisie ici est une décision : elle est enregistrée sur le
  // compte à la connexion. Sinon, c'est celle du compte qui s'applique.
  const [langueChoisie, setLangueChoisie] = useState(false);
  // « Mot de passe oublié ? » : le même écran, avec le code de récupération à
  // la place du mot de passe.
  const [oubli, setOubli] = useState(false);
  const [code, setCode] = useState('');
  const [nouveau, setNouveau] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [nouveauCode, setNouveauCode] = useState(null);
  const [codeNote, setCodeNote] = useState(false);
  const [info, setInfo] = useState(null);

  const basculer = (versOubli) => {
    setOubli(versOubli);
    setError(null);
    setInfo(null);
    setPassword('');
  };

  const reinitialiser = async (e) => {
    e.preventDefault();
    setError(null);
    if (nouveau !== confirmation) {
      setError(t('Les mots de passe ne correspondent pas.'));
      return;
    }
    setLoading(true);
    try {
      const r = await api.post('/api/auth/reinitialiser', { username, code, nouveauMotDePasse: nouveau });
      setCodeNote(false);
      setNouveauCode(r.code_recuperation);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const terminerReinitialisation = () => {
    setNouveauCode(null);
    setCode('');
    setNouveau('');
    setConfirmation('');
    basculer(false);
    setInfo(t('Mot de passe changé : connectez-vous avec le nouveau.'));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await api.post('/api/auth/login', { username, password });
      // Le rôle est relu auprès du serveur plutôt que déduit côté client.
      if (langueChoisie) {
        await api.put('/api/auth/langue', { langue }).catch(() => {});
      }
      const session = await api.get('/api/auth/check');
      if (!langueChoisie && session.langue) changerLangue(session.langue);
      // Un rechargement complet de la page n'est plus nécessaire : l'état
      // applicatif suffit, et l'interface ne clignote plus à la connexion.
      // Les dossiers accompagnent la session : c'est `App` qui décide s'il
      // faut en faire choisir un, ou en ouvrir le seul qui existe.
      onLogin({
        username: session.username,
        role: session.role,
        visite_vue: session.visite_vue,
        entreprises: session.entreprises || [],
        ouvert: session.ouvert || null
      });
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: 'var(--app-bg)' }}>
      <div className="glass-panel" style={{ width: '400px', padding: '40px', textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
          <SelecteurLangue onChange={() => setLangueChoisie(true)} />
        </div>
        <Logotype
          alt=""
          style={{ maxWidth: '100%', marginBottom: '32px' }}
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
        <h1 style={{ color: 'var(--text-main)', marginBottom: '20px', fontSize: '1.6rem' }}>
          {oubli ? t('Mot de passe oublié') : t('Connexion à Clora')}
        </h1>

        {error && <p className="alert alert-error" role="alert">{error}</p>}
        {info && <p className="alert alert-success" role="status">{info}</p>}

        {nouveauCode && (
          <FeuilleDeSecours nature="recuperation" code={nouveauCode} sujet={username} titre={t('Votre nouveau code de récupération')}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '20px', cursor: 'pointer', textAlign: 'left' }}>
              <input type="checkbox" checked={codeNote} onChange={(e) => setCodeNote(e.target.checked)} style={{ width: '18px', height: '18px' }} />
              {t("J'ai imprimé ou noté ce code en lieu sûr")}
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px' }}>
              <button type="button" className="btn-primary" disabled={!codeNote} onClick={terminerReinitialisation}>{t('Continuer')}</button>
            </div>
          </FeuilleDeSecours>
        )}

        {oubli ? (
          <form onSubmit={reinitialiser}>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'left', marginTop: 0 }}>
              {t('Saisissez le code de récupération imprimé sur votre feuille de secours, puis choisissez un nouveau mot de passe.')}
            </p>
            <div className="form-group" style={{ textAlign: 'left' }}>
              <label htmlFor="oubli-username">{t("Nom d'utilisateur")}</label>
              <input id="oubli-username" type="text" className="form-control" autoComplete="username"
                value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
            </div>
            <div className="form-group" style={{ textAlign: 'left' }}>
              <label htmlFor="oubli-code">{t('Code de récupération')}</label>
              <input id="oubli-code" type="text" className="form-control" autoComplete="off" spellCheck={false}
                placeholder={t('XXXX-XXXX-XXXX-XXXX-XXXX')} value={code} onChange={(e) => setCode(e.target.value)} required />
            </div>
            <div className="form-group" style={{ textAlign: 'left' }}>
              <label htmlFor="oubli-nouveau">{t('Nouveau mot de passe')}</label>
              <input id="oubli-nouveau" type="password" className="form-control" autoComplete="new-password"
                value={nouveau} onChange={(e) => setNouveau(e.target.value)} required />
            </div>
            <div className="form-group" style={{ textAlign: 'left' }}>
              <label htmlFor="oubli-confirmation">{t('Confirmer le mot de passe')}</label>
              <input id="oubli-confirmation" type="password" className="form-control" autoComplete="new-password"
                value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required />
            </div>
            <button type="submit" className="btn-primary" style={{ width: '100%', marginTop: '8px', padding: '12px' }} disabled={loading}>
              {t('Changer le mot de passe')}
            </button>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'left' }}>
              {t('Pas de code ? Un autre administrateur du dossier peut vous donner un nouveau mot de passe dans Paramètres.')}
            </p>
            <button type="button" className="lien-discret" onClick={() => basculer(false)}>{t('Retour à la connexion')}</button>
          </form>
        ) : (
        <form onSubmit={handleSubmit}>
          <div className="form-group" style={{ textAlign: 'left' }}>
            <label htmlFor="login-username">{t("Nom d'utilisateur")}</label>
            <input
              id="login-username"
              type="text"
              className="form-control"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="form-group" style={{ textAlign: 'left' }}>
            <label htmlFor="login-password">{t('Mot de passe')}</label>
            <input
              id="login-password"
              type="password"
              className="form-control"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn-primary" style={{ width: '100%', marginTop: '8px', padding: '12px' }} disabled={loading}>
            {loading ? t('Connexion en cours…') : t('Se connecter')}
          </button>
          <button type="button" className="lien-discret" style={{ marginTop: '16px' }} onClick={() => basculer(true)}>
            {t('Mot de passe oublié ?')}
          </button>
        </form>
        )}
      </div>
    </div>
  );
}

export default Login;
