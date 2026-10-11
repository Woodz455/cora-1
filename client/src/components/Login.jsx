import { useState } from 'react';
import { api } from '../api';
import { useLangue } from '../i18n.js';
import SelecteurLangue from './SelecteurLangue';

function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const { t, langue, changerLangue } = useLangue();
  // Une langue choisie ici est une décision : elle est enregistrée sur le
  // compte à la connexion. Sinon, c'est celle du compte qui s'applique.
  const [langueChoisie, setLangueChoisie] = useState(false);

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
        <img
          src="/banner.png"
          alt=""
          style={{ maxWidth: '100%', marginBottom: '32px' }}
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
        <h1 style={{ color: 'var(--text-main)', marginBottom: '20px', fontSize: '1.6rem' }}>{t('Connexion à Clora')}</h1>

        {error && <p className="alert alert-error" role="alert">{error}</p>}

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
        </form>
      </div>
    </div>
  );
}

export default Login;
