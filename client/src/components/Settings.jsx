import { useState, useEffect } from 'react';
import { api } from '../api';
import { useUser } from '../UserContext';
import { useFeedback } from '../FeedbackContext';

const TAILLE_MAX_LOGO = 2 * 1024 * 1024;

const ROLES = [
  { valeur: 'employe', libelle: 'Employé — factures, devis, clients, catalogue' },
  { valeur: 'comptable', libelle: 'Comptable — encaissements, dépenses, rapports, banque' },
  { valeur: 'admin', libelle: 'Administrateur — accès complet' }
];

// Les fonds étaient écrits en dur : ils ne suivaient pas le thème sombre, où
// les teintes de statut sont éclaircies.
const COULEURS_ROLE = {
  admin: { fond: 'var(--status-paid-bg)', texte: 'var(--status-paid)' },
  comptable: { fond: 'var(--status-pending-bg)', texte: 'var(--status-pending)' },
  employe: { fond: 'var(--status-partial-bg)', texte: 'var(--status-partial)' }
};

/**
 * Message d'état. Le type est passé explicitement plutôt que deviné à partir du
 * texte : la version précédente cherchait le mot « Erreur » dans le message et
 * affichait en vert tout échec formulé autrement.
 */
function Message({ contenu }) {
  if (!contenu) return null;
  const estErreur = contenu.type === 'error';
  return (
    <p className={`alert alert-${estErreur ? 'error' : 'success'}`} role={estErreur ? 'alert' : 'status'}>
      {contenu.texte}
    </p>
  );
}

function Settings() {
  const utilisateurCourant = useUser();
  const { notifier, confirmer } = useFeedback();

  const [settings, setSettings] = useState({
    entreprise_nom: '', entreprise_adresse: '', entreprise_email: '',
    taxe_1_nom: '', taxe_1_taux: 0, taxe_1_numero: '',
    taxe_2_nom: '', taxe_2_taux: 0, taxe_2_numero: '',
    payment_instructions: '', entreprise_logo: '',
    relances_actives: 0, relances_paliers: '7,15,30'
  });
  const [relancesDues, setRelancesDues] = useState(null);
  const [relanceMessage, setRelanceMessage] = useState(null); // { texte, erreur }
  const [relanceEnCours, setRelanceEnCours] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const [securityData, setSecurityData] = useState({ currentPassword: '', newUsername: '', newPassword: '' });
  const [savingSec, setSavingSec] = useState(false);
  const [secMessage, setSecMessage] = useState(null);

  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'employe' });
  const [usersMessage, setUsersMessage] = useState(null);
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [minLength, setMinLength] = useState(8);

  useEffect(() => {
    api.get('/api/settings')
      .then((data) => setSettings((prev) => ({ ...prev, ...data })))
      .catch((err) => setMessage({ type: 'error', texte: err.message }))
      .finally(() => setLoading(false));

    api.get('/api/users').then(setUsers).catch(() => setUsers([]));
    api.get('/api/relances/dues').then(setRelancesDues).catch(() => setRelancesDues(null));
    api.get('/api/auth/setup-status')
      .then((data) => { if (data.minPasswordLength) setMinLength(data.minPasswordLength); })
      .catch(() => {});
  }, []);

  const handleChange = (e) => {
    const { name, value, type } = e.target;
    setSettings((prev) => ({ ...prev, [name]: type === 'number' ? parseFloat(value) : value }));
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > TAILLE_MAX_LOGO) {
      setMessage({ type: 'error', texte: "L'image dépasse la taille maximale de 2 Mo." });
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => setSettings((prev) => ({ ...prev, entreprise_logo: reader.result }));
    reader.onerror = () => setMessage({ type: 'error', texte: "L'image n'a pas pu être lue." });
    reader.readAsDataURL(file);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await api.put('/api/settings', settings);
      notifier('Paramètres enregistrés.');
    } catch (err) {
      setMessage({ type: 'error', texte: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleSecuritySave = async (e) => {
    e.preventDefault();
    setSavingSec(true);
    setSecMessage(null);
    try {
      await api.put('/api/auth/credentials', securityData);
      setSecMessage({ type: 'success', texte: 'Identifiants modifiés. Vous allez être déconnecté.' });
      setSecurityData({ currentPassword: '', newUsername: '', newPassword: '' });
      // La session est invalidée côté serveur : un rechargement ramène à l'écran de connexion.
      setTimeout(() => window.location.reload(), 2000);
    } catch (err) {
      setSecMessage({ type: 'error', texte: err.message });
      setSavingSec(false);
    }
  };

  const handleAddUser = async (e) => {
    e.preventDefault();
    setUsersMessage(null);
    try {
      const cree = await api.post('/api/users', newUser);
      setUsers((prev) => [...prev, cree]);
      setNewUser({ username: '', password: '', role: 'employe' });
      setIsAddingUser(false);
      notifier(`Compte « ${cree.username} » ajouté.`);
    } catch (err) {
      setUsersMessage({ type: 'error', texte: err.message });
    }
  };

  const handleDeleteUser = async (utilisateur) => {
    const accepte = await confirmer({
      titre: `Supprimer le compte « ${utilisateur.username} » ?`,
      message: 'La personne perdra immédiatement l\'accès à Clora. Les documents '
        + "qu'elle a créés sont conservés.",
      libelleConfirmer: 'Supprimer le compte',
      danger: true
    });
    if (!accepte) return;
    setUsersMessage(null);
    try {
      await api.del(`/api/users/${utilisateur.id}`);
      setUsers((prev) => prev.filter((u) => u.id !== utilisateur.id));
      notifier(`Compte « ${utilisateur.username} » supprimé.`);
    } catch (err) {
      setUsersMessage({ type: 'error', texte: err.message });
    }
  };

  if (loading) return <p style={{ color: 'var(--text-muted)' }}>Chargement des paramètres…</p>;

  return (
    <div style={{ maxWidth: '820px', margin: '0 auto' }}>
      <h2 style={{ color: 'var(--text-main)', marginBottom: '20px' }}>Paramètres de l'entreprise</h2>

      <Message contenu={message} />

      <form onSubmit={handleSave} className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
        <div>
          <h3 style={{ margin: '0 0 15px 0', borderBottom: '1px solid var(--glass-border)', paddingBottom: '10px' }}>Identité visuelle</h3>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '15px' }}>
            Ce logo apparaît en haut de vos factures et devis. Taille maximale : 2 Mo.
          </p>
          <div className="form-group">
            <label htmlFor="logo">Logo de l'entreprise</label>
            <input id="logo" type="file" accept="image/*" onChange={handleImageUpload} className="form-control" style={{ padding: '8px' }} />
          </div>
          {settings.entreprise_logo && (
            <div style={{ marginTop: '10px' }}>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Aperçu :</p>
              <img src={settings.entreprise_logo} alt="Aperçu du logo" style={{ maxHeight: '100px', maxWidth: '100%', border: '1px solid var(--glass-border)', borderRadius: '4px', padding: '5px' }} />
              <button
                type="button" className="btn-secondary"
                style={{ marginTop: '10px', display: 'block', padding: '4px 8px', fontSize: '0.8rem' }}
                onClick={() => setSettings((prev) => ({ ...prev, entreprise_logo: '' }))}
              >
                Supprimer le logo
              </button>
            </div>
          )}
        </div>

        <div>
          <h3 style={{ margin: '0 0 15px 0', borderBottom: '1px solid var(--glass-border)', paddingBottom: '10px' }}>Informations générales</h3>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '15px' }}>
            Ce nom identifie votre entreprise sur les documents et comme expéditeur de vos courriels.
          </p>
          <div className="form-group">
            <label htmlFor="entreprise_nom">Nom de l'entreprise *</label>
            <input id="entreprise_nom" type="text" className="form-control" name="entreprise_nom" value={settings.entreprise_nom || ''} onChange={handleChange} required />
          </div>
          <div className="form-group">
            <label htmlFor="entreprise_email">Courriel de contact</label>
            <input id="entreprise_email" type="email" className="form-control" name="entreprise_email" value={settings.entreprise_email || ''} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label htmlFor="entreprise_adresse">Adresse complète</label>
            <textarea id="entreprise_adresse" className="form-control" name="entreprise_adresse" value={settings.entreprise_adresse || ''} onChange={handleChange} rows="3"></textarea>
          </div>
        </div>

        <div>
          <h3 style={{ margin: '0 0 15px 0', borderBottom: '1px solid var(--glass-border)', paddingBottom: '10px' }}>Paiement</h3>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '15px' }}>
            Ces instructions s'affichent au bas de chaque facture (virement Interac, lien de paiement…).
          </p>
          <div className="form-group">
            <label htmlFor="payment_instructions" style={{ position: 'absolute', left: '-9999px' }}>Instructions de paiement</label>
            <textarea id="payment_instructions" className="form-control" name="payment_instructions" value={settings.payment_instructions || ''} onChange={handleChange} rows="4" placeholder="Ex. : virement Interac à comptabilite@exemple.ca, ou paiement en ligne à l'adresse…"></textarea>
          </div>
        </div>

        <div>
          <h3 style={{ margin: '0 0 15px 0', borderBottom: '1px solid var(--glass-border)', paddingBottom: '10px' }}>
            Relances automatiques
          </h3>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '15px' }}>
            Un rappel de paiement est envoyé au client dès qu'une facture impayée dépasse l'un des
            paliers ci-dessous. Chaque palier ne part qu'une fois par facture, et plus rien n'est
            envoyé dès que la facture est réglée ou créditée.
          </p>

          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={Boolean(settings.relances_actives)}
                onChange={(e) => setSettings((prev) => ({ ...prev, relances_actives: e.target.checked ? 1 : 0 }))}
                style={{ width: '18px', height: '18px' }}
              />
              Activer l'envoi automatique des rappels
            </label>
          </div>

          <div className="form-group">
            <label htmlFor="relances_paliers">Paliers, en jours après l'échéance</label>
            <input
              id="relances_paliers" type="text" className="form-control" name="relances_paliers"
              value={settings.relances_paliers || ''} onChange={handleChange}
              placeholder="7, 15, 30"
            />
          </div>

          {/* Le rappel automatique part en texte : le PDF est produit par le
              navigateur au moment de l'impression et n'existe pas côté serveur. */}
          <p className="alert alert-info">
            Le rappel automatique est un courriel texte reprenant le numéro, le solde dû et
            l'échéance. Pour envoyer la facture en pièce jointe, utilisez le bouton « Relancer »
            depuis la liste des factures.
          </p>

          {relancesDues && (
            <div style={{ marginTop: '15px' }}>
              {relanceMessage && (
                <p
                  className={`alert ${relanceMessage.erreur ? 'alert-error' : 'alert-success'}`}
                  role={relanceMessage.erreur ? 'alert' : 'status'}
                >
                  {relanceMessage.texte}
                </p>
              )}
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                {relancesDues.factures.length === 0
                  ? 'Aucune facture n\'atteint actuellement un palier de relance.'
                  : `${relancesDues.factures.length} facture(s) atteignent un palier et seraient relancées au prochain passage :`}
              </p>
              {relancesDues.factures.length > 0 && (
                <ul style={{ color: 'var(--text-muted)', fontSize: '0.9rem', paddingLeft: '20px' }}>
                  {relancesDues.factures.slice(0, 8).map((f) => (
                    <li key={f.id}>
                      {f.numero_facture} — {f.client} ({f.retard} jours de retard, palier {f.palier})
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button" className="btn-secondary"
                disabled={relanceEnCours || relancesDues.factures.length === 0}
                onClick={async () => {
                  setRelanceMessage(null);
                  setRelanceEnCours(true);
                  try {
                    const r = await api.post('/api/relances/envoyer');
                    setRelanceMessage({
                      texte: `${r.envoyees} rappel(s) envoyé(s), ${r.erreurs} en échec.`,
                      erreur: r.erreurs > 0
                    });
                    setRelancesDues(await api.get('/api/relances/dues'));
                  } catch (err) {
                    setRelanceMessage({ texte: err.message, erreur: true });
                  } finally {
                    setRelanceEnCours(false);
                  }
                }}
              >
                {relanceEnCours ? 'Envoi en cours…' : 'Envoyer maintenant'}
              </button>
            </div>
          )}
        </div>

        <div>
          <h3 style={{ margin: '0 0 15px 0', borderBottom: '1px solid var(--glass-border)', paddingBottom: '10px' }}>Numéros de taxes</h3>
          {/* Les taux appliqués aux documents proviennent de la province du
              client. Ces champs ne servent qu'à l'affichage des numéros
              d'enregistrement au bas des factures. */}
          <p className="alert alert-info">
            Les taux de taxe sont déterminés automatiquement par la province de chaque client
            (TPS et TVQ au Québec, TVH en Ontario, etc.). Ces champs servent uniquement à faire
            figurer vos numéros d'enregistrement sur les documents.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
            <div style={{ padding: '15px', background: 'var(--hover-subtle)', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
              <div className="form-group">
                <label htmlFor="taxe_1_nom">Nom de la taxe 1 (ex. : TPS)</label>
                <input id="taxe_1_nom" type="text" className="form-control" name="taxe_1_nom" value={settings.taxe_1_nom || ''} onChange={handleChange} />
              </div>
              <div className="form-group">
                <label htmlFor="taxe_1_numero">Numéro d'enregistrement</label>
                <input id="taxe_1_numero" type="text" className="form-control" name="taxe_1_numero" value={settings.taxe_1_numero || ''} onChange={handleChange} />
              </div>
            </div>

            <div style={{ padding: '15px', background: 'var(--hover-subtle)', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
              <div className="form-group">
                <label htmlFor="taxe_2_nom">Nom de la taxe 2 (ex. : TVQ)</label>
                <input id="taxe_2_nom" type="text" className="form-control" name="taxe_2_nom" value={settings.taxe_2_nom || ''} onChange={handleChange} />
              </div>
              <div className="form-group">
                <label htmlFor="taxe_2_numero">Numéro d'enregistrement</label>
                <input id="taxe_2_numero" type="text" className="form-control" name="taxe_2_numero" value={settings.taxe_2_numero || ''} onChange={handleChange} />
              </div>
            </div>
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Sauvegarde…' : 'Enregistrer les paramètres'}
          </button>
        </div>
      </form>

      <h2 style={{ color: 'var(--text-main)', marginTop: '50px', marginBottom: '20px' }}>Mes identifiants</h2>
      <Message contenu={secMessage} />

      <form onSubmit={handleSecuritySave} className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
        <div className="form-group">
          <label htmlFor="sec-actuel">Mot de passe actuel</label>
          <input id="sec-actuel" type="password" autoComplete="current-password" className="form-control" value={securityData.currentPassword} onChange={(e) => setSecurityData({ ...securityData, currentPassword: e.target.value })} required />
        </div>
        <div className="form-group">
          <label htmlFor="sec-nom">Nouveau nom d'utilisateur</label>
          <input id="sec-nom" type="text" autoComplete="username" className="form-control" value={securityData.newUsername} onChange={(e) => setSecurityData({ ...securityData, newUsername: e.target.value })} required minLength={3} />
        </div>
        <div className="form-group">
          <label htmlFor="sec-mdp">Nouveau mot de passe (au moins {minLength} caractères)</label>
          <input id="sec-mdp" type="password" autoComplete="new-password" className="form-control" value={securityData.newPassword} onChange={(e) => setSecurityData({ ...securityData, newPassword: e.target.value })} required minLength={minLength} />
        </div>
        <div style={{ textAlign: 'right' }}>
          <button type="submit" className="btn-secondary" disabled={savingSec}>
            {savingSec ? 'Modification…' : 'Modifier mes identifiants'}
          </button>
        </div>
      </form>

      <h2 style={{ color: 'var(--text-main)', marginTop: '50px', marginBottom: '20px' }}>Gestion des utilisateurs</h2>
      <Message contenu={usersMessage} />

      <div className="glass-panel" style={{ padding: '20px' }}>
        <div className="toolbar">
          <h3 style={{ margin: 0 }}>Comptes</h3>
          <button type="button" className="btn-primary" onClick={() => setIsAddingUser(!isAddingUser)}>
            {isAddingUser ? 'Annuler' : '+ Nouvel utilisateur'}
          </button>
        </div>

        {isAddingUser && (
          <form onSubmit={handleAddUser} style={{ background: 'var(--glass-card-bg)', padding: '20px', borderRadius: '8px', marginBottom: '20px', border: '1px solid var(--glass-border)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '15px' }}>
              <div className="form-group">
                <label htmlFor="nouvel-utilisateur">Nom d'utilisateur</label>
                <input id="nouvel-utilisateur" type="text" className="form-control" value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} required minLength={3} />
              </div>
              <div className="form-group">
                <label htmlFor="nouveau-mdp">Mot de passe (au moins {minLength} caractères)</label>
                <input id="nouveau-mdp" type="password" autoComplete="new-password" className="form-control" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} required minLength={minLength} />
              </div>
              <div className="form-group">
                <label htmlFor="nouveau-role">Rôle</label>
                <select id="nouveau-role" className="form-control" value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
                  {ROLES.map((r) => <option key={r.valeur} value={r.valeur}>{r.libelle}</option>)}
                </select>
              </div>
            </div>
            <div style={{ textAlign: 'right', marginTop: '15px' }}>
              <button type="submit" className="btn-primary">Créer l'utilisateur</button>
            </div>
          </form>
        )}

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nom d'utilisateur</th>
                <th>Rôle</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const couleurs = COULEURS_ROLE[user.role] || COULEURS_ROLE.employe;
                const estMoi = utilisateurCourant && user.username === utilisateurCourant.username;
                return (
                  <tr key={user.id}>
                    <td style={{ fontWeight: '500' }}>
                      {user.username}
                      {estMoi && <span style={{ color: 'var(--text-muted)', fontWeight: 'normal' }}> (vous)</span>}
                    </td>
                    <td>
                      <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '0.85rem', fontWeight: 'bold', background: couleurs.fond, color: couleurs.texte }}>
                        {user.role}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {/* Supprimer son propre compte est refusé par le serveur :
                          autant ne pas proposer l'action. */}
                      <button
                        type="button" className="btn-danger"
                        onClick={() => handleDeleteUser(user)}
                        disabled={estMoi}
                        title={estMoi ? 'Vous ne pouvez pas supprimer votre propre compte.' : undefined}
                      >
                        Supprimer
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default Settings;
