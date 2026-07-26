import { useState } from 'react';
import { api } from '../api';

function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await api.post('/api/auth/login', { username, password });
      // Le rôle est relu auprès du serveur plutôt que déduit côté client.
      const session = await api.get('/api/auth/check');
      // Un rechargement complet de la page n'est plus nécessaire : l'état
      // applicatif suffit, et l'interface ne clignote plus à la connexion.
      onLogin({ username: session.username, role: session.role });
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: 'var(--app-bg)' }}>
      <div className="glass-panel" style={{ width: '400px', padding: '40px', textAlign: 'center' }}>
        <img
          src="/banner.png"
          alt=""
          style={{ maxWidth: '100%', marginBottom: '30px' }}
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
        <h1 style={{ color: 'var(--text-main)', marginBottom: '20px', fontSize: '1.6rem' }}>Connexion à Clora</h1>

        {error && <p className="alert alert-error" role="alert">{error}</p>}

        <form onSubmit={handleSubmit}>
          <div className="form-group" style={{ textAlign: 'left' }}>
            <label htmlFor="login-username">Nom d'utilisateur</label>
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
            <label htmlFor="login-password">Mot de passe</label>
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
          <button type="submit" className="btn-primary" style={{ width: '100%', marginTop: '10px', padding: '12px' }} disabled={loading}>
            {loading ? 'Connexion en cours…' : 'Se connecter'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default Login;
