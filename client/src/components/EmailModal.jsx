import { useState, useEffect, useRef } from 'react';
import { useModale } from '../useModale';

function EmailModal({ isOpen, onClose, onSend, initialTo, initialSubject, defaultMessage }) {
  const modaleRef = useModale(onClose, { actif: isOpen });
  const [to, setTo] = useState(initialTo || '');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState(initialSubject || '');
  const [message, setMessage] = useState(defaultMessage || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Message proposé la dernière fois. Le lien de paiement en ligne arrive après
   * l'ouverture de la fenêtre : le texte proposé doit alors se compléter, mais
   * jamais écraser ce que l'utilisateur a commencé à écrire.
   */
  const proposition = useRef(defaultMessage || '');
  useEffect(() => {
    const nouveau = defaultMessage || '';
    if (nouveau === proposition.current) return;
    setMessage((actuel) => (actuel === proposition.current ? nouveau : actuel));
    proposition.current = nouveau;
  }, [defaultMessage]);

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
    <div ref={modaleRef} className="modal-overlay" role="dialog" aria-modal="true"
      aria-label="Envoyer par courriel" style={{ zIndex: 10001 }}>
      <div className="modal-content glass-panel" style={{ maxWidth: '500px', width: '100%' }}>
        <h3 style={{ marginTop: 0, marginBottom: '20px', fontSize: '1.4rem' }}>Envoyer par courriel</h3>
        
        {error && <p style={{ color: 'red', background: '#fee2e2', padding: '10px', borderRadius: '5px' }}>{error}</p>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="courriel-a">À :</label>
            <input 
              id="courriel-a"
              type="text" 
              className="form-control" 
              value={to} 
              onChange={(e) => setTo(e.target.value)} 
              required 
              placeholder="Ex: client@email.com, autre@email.com"
            />
          </div>

          <div className="form-group">
            <label htmlFor="courriel-cc">Cc :</label>
            <input 
              id="courriel-cc"
              type="text" 
              className="form-control" 
              value={cc} 
              onChange={(e) => setCc(e.target.value)} 
              placeholder="Ex: comptabilite@email.com"
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="courriel-sujet">Sujet :</label>
            <input 
              id="courriel-sujet"
              type="text" 
              className="form-control" 
              value={subject} 
              onChange={(e) => setSubject(e.target.value)} 
              required 
            />
          </div>

          <div className="form-group">
            <label htmlFor="courriel-message">Message :</label>
            <textarea 
              id="courriel-message"
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
