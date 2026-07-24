import React, { useState, useEffect } from 'react';

function Settings() {
  const [settings, setSettings] = useState({
    entreprise_nom: '',
    entreprise_adresse: '',
    entreprise_email: '',
    taxe_1_nom: '',
    taxe_1_taux: 0,
    taxe_1_numero: '',
    taxe_2_nom: '',
    taxe_2_taux: 0,
    taxe_2_numero: '',
    payment_instructions: '',
    entreprise_logo: ''
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  // Sécurité
  const [securityData, setSecurityData] = useState({ currentPassword: '', newUsername: '', newPassword: '' });
  const [savingSec, setSavingSec] = useState(false);
  const [secMessage, setSecMessage] = useState('');

  // Utilisateurs
  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'employe' });
  const [usersMessage, setUsersMessage] = useState('');
  const [isAddingUser, setIsAddingUser] = useState(false);

  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        setSettings(data);
        setLoading(false);
      });
    
    fetch('/api/users')
      .then(res => {
        if (res.ok) return res.json();
        return [];
      })
      .then(data => setUsers(data))
      .catch(() => setUsers([]));
  }, []);

  const handleChange = (e) => {
    const { name, value, type } = e.target;
    setSettings(prev => ({
      ...prev,
      [name]: type === 'number' ? parseFloat(value) : value
    }));
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setMessage('Erreur: L\'image dépasse la taille maximale de 2 Mo.');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setSettings(prev => ({ ...prev, entreprise_logo: reader.result }));
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      if (!response.ok) throw new Error('Erreur de sauvegarde');
      setMessage('Paramètres sauvegardés avec succès !');
    } catch (err) {
      setMessage('Erreur lors de la sauvegarde.');
    } finally {
      setSaving(false);
    }
  };

  const handleSecuritySave = async (e) => {
    e.preventDefault();
    setSavingSec(true);
    setSecMessage('');
    try {
      const response = await fetch('/api/auth/credentials', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(securityData)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Erreur lors de la modification');
      setSecMessage('Identifiants modifiés avec succès. Vous devrez vous reconnecter.');
      setSecurityData({ currentPassword: '', newUsername: '', newPassword: '' });
      setTimeout(() => window.location.reload(), 2000);
    } catch (err) {
      setSecMessage(err.message);
    } finally {
      setSavingSec(false);
    }
  };

  const handleAddUser = async (e) => {
    e.preventDefault();
    setUsersMessage('');
    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Erreur lors de la création');
      setUsers(prev => [...prev, data]);
      setNewUser({ username: '', password: '', role: 'employe' });
      setIsAddingUser(false);
      setUsersMessage('Utilisateur ajouté avec succès.');
    } catch (err) {
      setUsersMessage(err.message);
    }
  };

  const handleDeleteUser = async (id) => {
    if (!window.confirm("Êtes-vous sûr de vouloir supprimer cet utilisateur ?")) return;
    try {
      const response = await fetch(`/api/users/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Erreur lors de la suppression');
      }
      setUsers(prev => prev.filter(u => u.id !== id));
      setUsersMessage('Utilisateur supprimé.');
    } catch (err) {
      setUsersMessage(err.message);
    }
  };

  if (loading) return <p style={{ color: 'var(--text-muted)' }}>Chargement des paramètres...</p>;

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      <h2 style={{ color: 'var(--text-main)', marginBottom: '30px' }}>Paramètres de l'entreprise</h2>
      
      {message && (
        <div style={{ 
          padding: '15px', 
          marginBottom: '20px', 
          borderRadius: '8px', 
          background: message.includes('Erreur') ? '#fee2e2' : '#d1fae5',
          color: message.includes('Erreur') ? '#ef4444' : '#10b981'
        }}>
          {message}
        </div>
      )}

      <form onSubmit={handleSave} className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
        
        {/* Identité Visuelle */}
        <div>
          <h3 style={{ margin: '0 0 15px 0', borderBottom: '1px solid var(--glass-border)', paddingBottom: '10px' }}>Identité Visuelle</h3>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '15px' }}>Ce logo/bannière s'affichera en haut de vos factures. (Taille max: 2 Mo)</p>
          <div className="form-group">
            <label>Logo de l'entreprise</label>
            <input type="file" accept="image/*" onChange={handleImageUpload} className="form-control" style={{ padding: '8px' }} />
          </div>
          {settings.entreprise_logo && (
            <div style={{ marginTop: '10px' }}>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Aperçu :</p>
              <img src={settings.entreprise_logo} alt="Aperçu logo" style={{ maxHeight: '100px', maxWidth: '100%', border: '1px solid var(--glass-border)', borderRadius: '4px', padding: '5px' }} />
              <button type="button" className="btn-secondary" style={{ marginTop: '10px', display: 'block', padding: '4px 8px', fontSize: '0.8rem' }} onClick={() => setSettings(prev => ({ ...prev, entreprise_logo: '' }))}>Supprimer le logo</button>
            </div>
          )}
        </div>

        {/* Informations générales */}
        <div>
          <h3 style={{ margin: '0 0 15px 0', borderBottom: '1px solid var(--glass-border)', paddingBottom: '10px' }}>Informations Générales</h3>
          <div className="form-group">
            <label>Nom de l'entreprise</label>
            <input type="text" className="form-control" name="entreprise_nom" value={settings.entreprise_nom || ''} onChange={handleChange} required />
          </div>
          <div className="form-group">
            <label>Courriel de contact</label>
            <input type="email" className="form-control" name="entreprise_email" value={settings.entreprise_email || ''} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label>Adresse complète</label>
            <textarea className="form-control" name="entreprise_adresse" value={settings.entreprise_adresse || ''} onChange={handleChange} rows="3"></textarea>
          </div>
        </div>

        {/* Instructions de paiement */}
        <div>
          <h3 style={{ margin: '0 0 15px 0', borderBottom: '1px solid var(--glass-border)', paddingBottom: '10px' }}>Paiement</h3>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '15px' }}>Ces instructions s'afficheront au bas de chaque facture (ex: Lien Stripe, instructions pour virement Interac).</p>
          <div className="form-group">
            <textarea className="form-control" name="payment_instructions" value={settings.payment_instructions || ''} onChange={handleChange} rows="4" placeholder="Ex: Merci de faire le virement Interac à... ou payez en ligne ici : https://buy.stripe.com/..."></textarea>
          </div>
        </div>

        {/* Taxes */}
        <div>
          <h3 style={{ margin: '0 0 15px 0', borderBottom: '1px solid var(--glass-border)', paddingBottom: '10px' }}>Configuration des Taxes</h3>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '20px' }}>Ces taux seront appliqués par défaut sur vos nouvelles factures.</p>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            {/* Taxe 1 */}
            <div style={{ padding: '15px', background: 'rgba(0,0,0,0.02)', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
              <div className="form-group">
                <label>Nom de la taxe 1 (ex: TPS)</label>
                <input type="text" className="form-control" name="taxe_1_nom" value={settings.taxe_1_nom || ''} onChange={handleChange} />
              </div>
              <div className="form-group">
                <label>Taux de la taxe 1 (ex: 0.05 pour 5%)</label>
                <input type="number" step="0.0001" className="form-control" name="taxe_1_taux" value={settings.taxe_1_taux || 0} onChange={handleChange} />
              </div>
              <div className="form-group">
                <label>Numéro d'enregistrement (affiché sur facture)</label>
                <input type="text" className="form-control" name="taxe_1_numero" value={settings.taxe_1_numero || ''} onChange={handleChange} />
              </div>
            </div>

            {/* Taxe 2 */}
            <div style={{ padding: '15px', background: 'rgba(0,0,0,0.02)', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
              <div className="form-group">
                <label>Nom de la taxe 2 (ex: TVQ)</label>
                <input type="text" className="form-control" name="taxe_2_nom" value={settings.taxe_2_nom || ''} onChange={handleChange} />
              </div>
              <div className="form-group">
                <label>Taux de la taxe 2 (ex: 0.09975 pour 9.975%)</label>
                <input type="number" step="0.00001" className="form-control" name="taxe_2_taux" value={settings.taxe_2_taux || 0} onChange={handleChange} />
              </div>
              <div className="form-group">
                <label>Numéro d'enregistrement (affiché sur facture)</label>
                <input type="text" className="form-control" name="taxe_2_numero" value={settings.taxe_2_numero || ''} onChange={handleChange} />
              </div>
            </div>
          </div>
        </div>

        <div style={{ textAlign: 'right', marginTop: '10px' }}>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Sauvegarde...' : 'Enregistrer les paramètres'}
          </button>
        </div>

      </form>

      <h2 style={{ color: 'var(--text-main)', marginTop: '50px', marginBottom: '30px' }}>Sécurité</h2>
      
      {secMessage && (
        <div style={{ 
          padding: '15px', 
          marginBottom: '20px', 
          borderRadius: '8px', 
          background: secMessage.includes('Erreur') || secMessage.includes('incorrect') ? '#fee2e2' : '#d1fae5',
          color: secMessage.includes('Erreur') || secMessage.includes('incorrect') ? '#ef4444' : '#10b981'
        }}>
          {secMessage}
        </div>
      )}

      <form onSubmit={handleSecuritySave} className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div className="form-group">
          <label>Mot de passe actuel</label>
          <input type="password" className="form-control" value={securityData.currentPassword} onChange={e => setSecurityData({...securityData, currentPassword: e.target.value})} required />
        </div>
        <div className="form-group">
          <label>Nouveau nom d'utilisateur</label>
          <input type="text" className="form-control" value={securityData.newUsername} onChange={e => setSecurityData({...securityData, newUsername: e.target.value})} required />
        </div>
        <div className="form-group">
          <label>Nouveau mot de passe (min 4 caractères)</label>
          <input type="password" className="form-control" value={securityData.newPassword} onChange={e => setSecurityData({...securityData, newPassword: e.target.value})} required minLength={4} />
        </div>
        <div style={{ textAlign: 'right', marginTop: '10px' }}>
          <button type="submit" className="btn-secondary" disabled={savingSec}>
            {savingSec ? 'Modification...' : 'Modifier les identifiants'}
          </button>
        </div>
      </form>

      <h2 style={{ color: 'var(--text-main)', marginTop: '50px', marginBottom: '30px' }}>Gestion des Utilisateurs</h2>

      {usersMessage && (
        <div style={{ 
          padding: '15px', 
          marginBottom: '20px', 
          borderRadius: '8px', 
          background: usersMessage.includes('Erreur') ? '#fee2e2' : '#d1fae5',
          color: usersMessage.includes('Erreur') ? '#ef4444' : '#10b981'
        }}>
          {usersMessage}
        </div>
      )}

      <div className="glass-panel" style={{ padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ margin: 0 }}>Liste des utilisateurs</h3>
          <button className="btn-primary" onClick={() => setIsAddingUser(!isAddingUser)}>
            {isAddingUser ? 'Annuler' : '+ Nouvel Utilisateur'}
          </button>
        </div>

        {isAddingUser && (
          <form onSubmit={handleAddUser} style={{ background: 'var(--glass-card-bg)', padding: '20px', borderRadius: '8px', marginBottom: '20px', border: '1px solid var(--glass-border)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '15px' }}>
              <div className="form-group">
                <label>Nom d'utilisateur</label>
                <input type="text" className="form-control" value={newUser.username} onChange={e => setNewUser({...newUser, username: e.target.value})} required />
              </div>
              <div className="form-group">
                <label>Mot de passe</label>
                <input type="password" className="form-control" value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} required minLength={4} />
              </div>
              <div className="form-group">
                <label>Rôle</label>
                <select className="form-control" value={newUser.role} onChange={e => setNewUser({...newUser, role: e.target.value})}>
                  <option value="employe">Employé (Accès restreint)</option>
                  <option value="comptable">Comptable (Accès rapports/dépenses)</option>
                  <option value="admin">Admin (Accès total)</option>
                </select>
              </div>
            </div>
            <div style={{ textAlign: 'right', marginTop: '15px' }}>
              <button type="submit" className="btn-primary">Créer l'utilisateur</button>
            </div>
          </form>
        )}

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--glass-border)', textAlign: 'left' }}>
              <th style={{ padding: '10px' }}>Nom d'utilisateur</th>
              <th style={{ padding: '10px' }}>Rôle</th>
              <th style={{ padding: '10px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map(user => (
              <tr key={user.id} style={{ borderBottom: '1px solid var(--glass-border)' }}>
                <td style={{ padding: '10px', fontWeight: '500' }}>{user.username}</td>
                <td style={{ padding: '10px' }}>
                  <span style={{ 
                    padding: '4px 8px', borderRadius: '12px', fontSize: '0.85rem', fontWeight: 'bold',
                    background: user.role === 'admin' ? '#d1fae5' : (user.role === 'comptable' ? '#dbeafe' : '#fef3c7'),
                    color: user.role === 'admin' ? '#065f46' : (user.role === 'comptable' ? '#1e40af' : '#92400e')
                  }}>
                    {user.role}
                  </span>
                </td>
                <td style={{ padding: '10px', textAlign: 'right' }}>
                  <button className="btn-secondary" onClick={() => handleDeleteUser(user.id)} style={{ color: '#ef4444', padding: '4px 8px' }}>
                    Supprimer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  );
}

export default Settings;
