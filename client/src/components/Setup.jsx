import { useState, useEffect } from 'react';
import { api } from '../api';
import ChoixProfil from './ChoixProfil';
import SelecteurLangue from './SelecteurLangue';
import { useLangue } from '../i18n.js';

function Setup({ onSetupComplete }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  // Le premier dossier se nommait « Mon entreprise » et se renommait ensuite
  // dans Paramètres, sans que rien ne le dise. Il se nomme ici, et prend le
  // profil qui règle ses valeurs de départ.
  const [entreprise, setEntreprise] = useState('');
  const [profil, setProfil] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  // La longueur minimale est dictée par le serveur, pour que les deux ne
  // puissent pas diverger.
  const [minLength, setMinLength] = useState(8);
  const { t, langue } = useLangue();

  useEffect(() => {
    api.get('/api/auth/setup-status')
      .then((data) => { if (data.minPasswordLength) setMinLength(data.minPasswordLength); })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError(t('Les mots de passe ne correspondent pas.'));
      return;
    }
    if (password.length < minLength) {
      setError(t('Le mot de passe doit contenir au moins {n} caractères.', { n: minLength }));
      return;
    }
    if (!profil) {
      setError(t('Choisissez le profil qui décrit le mieux votre entreprise.'));
      return;
    }

    setLoading(true);
    try {
      // La langue de cet écran devient celle du compte administrateur.
      await api.post('/api/auth/setup', { username, password, entreprise, profil, langue });
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
      <div className="glass-panel" style={{ width: '520px', maxWidth: '100%', maxHeight: '100vh', overflowY: 'auto', padding: '40px', textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
          <SelecteurLangue />
        </div>
        {/* Le tout premier écran qu'un client voit ne portait aucun logo,
            contrairement à l'écran de connexion des fois suivantes. */}
        <img
          src="/banner.png"
          alt=""
          style={{ maxWidth: '100%', marginBottom: '32px' }}
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
        <h1 style={{ color: 'var(--text-main)', marginBottom: '8px', fontSize: '1.6rem' }}>{t('Bienvenue sur Clora')}</h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: '32px', fontSize: '0.9rem' }}>
          {t('Première utilisation : nommez votre entreprise et créez le compte administrateur qui protégera vos données.')}
        </p>

        {error && <p className="alert alert-error" role="alert">{error}</p>}

        <form onSubmit={handleSubmit}>
          <div className="form-group" style={{ textAlign: 'left' }}>
            <label htmlFor="setup-entreprise">{t("Nom de l'entreprise")}</label>
            <input
              id="setup-entreprise"
              type="text"
              className="form-control"
              autoComplete="organization"
              value={entreprise}
              onChange={(e) => setEntreprise(e.target.value)}
              required
              maxLength={200}
              autoFocus
            />
          </div>
          <div className="form-group" style={{ textAlign: 'left' }}>
            <ChoixProfil valeur={profil} onChange={setProfil} />
          </div>
          <div className="form-group" style={{ textAlign: 'left' }}>
            <label htmlFor="setup-username">{t("Nom d'utilisateur")}</label>
            <input
              id="setup-username"
              type="text"
              className="form-control"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
            />
          </div>
          <div className="form-group" style={{ textAlign: 'left' }}>
            <label htmlFor="setup-password">{t('Mot de passe (au moins {n} caractères)', { n: minLength })}</label>
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
            <label htmlFor="setup-confirm">{t('Confirmez le mot de passe')}</label>
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
          <button type="submit" className="btn-primary" style={{ width: '100%', marginTop: '8px', padding: '12px' }} disabled={loading}>
            {loading ? t('Création en cours…') : t('Créer mon compte')}
          </button>
        </form>
      </div>
    </div>
  );
}

export default Setup;
