import { useState } from 'react';

function EmailModal({ isOpen, onClose, onSend, initialTo, initialSubject, defaultMessage }) {
  const [to, setTo] = useState(initialTo || '');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState(initialSubject || '');
  const [message, setMessage] = useState(defaultMessage || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await onSend({ to, cc, subject, message });
      setLoading(false);
      onClose();
    } catch (err) {
      setError(err.message || 'Une erreur est survenue');
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 10001 }}>
      <div className="modal-content glass-panel" style={{ maxWidth: '500px', width: '100%' }}>
        <h3 style={{ marginTop: 0, marginBottom: '20px', fontSize: '1.4rem' }}>Envoyer par courriel</h3>
        
        {error && <p style={{ color: 'red', background: '#fee2e2', padding: '10px', borderRadius: '5px' }}>{error}</p>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>À :</label>
            <input 
              type="text" 
              className="form-control" 
              value={to} 
              onChange={(e) => setTo(e.target.value)} 
              required 
              placeholder="Ex: client@email.com, autre@email.com"
            />
          </div>

          <div className="form-group">
            <label>Cc :</label>
            <input 
              type="text" 
              className="form-control" 
              value={cc} 
              onChange={(e) => setCc(e.target.value)} 
              placeholder="Ex: comptabilite@email.com"
            />
          </div>
          
          <div className="form-group">
            <label>Sujet :</label>
            <input 
              type="text" 
              className="form-control" 
              value={subject} 
              onChange={(e) => setSubject(e.target.value)} 
              required 
            />
          </div>

          <div className="form-group">
            <label>Message :</label>
            <textarea 
              className="form-control" 
              rows="5" 
              value={message} 
              onChange={(e) => setMessage(e.target.value)}
              required
            ></textarea>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
              Annuler
            </button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Envoi en cours...' : 'Envoyer 🚀'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default EmailModal;
