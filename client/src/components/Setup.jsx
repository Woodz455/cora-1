import { useState, useEffect } from 'react';
import { api } from '../api';

function Setup({ onSetupComplete }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  // La longueur minimale est dictée par le serveur, pour que les deux ne
  // puissent pas diverger.
  const [minLength, setMinLength] = useState(8);

  useEffect(() => {
    api.get('/api/auth/setup-status')
      .then((data) => { if (data.minPasswordLength) setMinLength(data.minPasswordLength); })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }
    if (password.length < minLength) {
      setError(`Le mot de passe doit contenir au moins ${minLength} caractères.`);
      return;
    }

    setLoading(true);
    try {
      await api.post('/api/auth/setup', { username, password });
      const session = await api.get('/api/auth/check');
      // La configuration crée aussi le premier dossier : le transmettre évite
      // de faire choisir entre une seule possibilité juste après l'inscription.
      onSetupComplete({
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
      <div className="glass-panel" style={{ width: '450px', padding: '40px', textAlign: 'center' }}>
        {/* Le tout premier écran qu'un client voit ne portait aucun logo,
            contrairement à l'écran de connexion des fois suivantes. */}
        <img
          src="/banner.png"
          alt=""
          style={{ maxWidth: '100%', marginBottom: '30px' }}
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
        <h1 style={{ color: 'var(--text-main)', marginBottom: '10px', fontSize: '1.6rem' }}>Bienvenue sur Clora</h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: '30px', fontSize: '0.9rem' }}>
          Première utilisation : créez le compte administrateur qui protégera vos données.
        </p>

        {error && <p className="alert alert-error" role="alert">{error}</p>}

        <form onSubmit={handleSubmit}>
          <div className="form-group" style={{ textAlign: 'left' }}>
            <label htmlFor="setup-username">Nom d'utilisateur</label>
            <input
              id="setup-username"
              type="text"
              className="form-control"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              autoFocus
            />
          </div>
          <div className="form-group" style={{ textAlign: 'left' }}>
            <label htmlFor="setup-password">Mot de passe (au moins {minLength} caractères)</label>
            <input
              id="setup-password"
              type="password"
              className="form-control"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={minLength}
            />
          </div>
          <div className="form-group" style={{ textAlign: 'left' }}>
            <label htmlFor="setup-confirm">Confirmez le mot de passe</label>
            <input
              id="setup-confirm"
              type="password"
              className="form-control"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn-primary" style={{ width: '100%', marginTop: '10px', padding: '12px' }} disabled={loading}>
            {loading ? 'Création en cours…' : 'Créer mon compte'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default Setup;
