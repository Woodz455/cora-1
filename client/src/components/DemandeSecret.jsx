import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useModale } from '../useModale';
import { useLangue } from '../i18n.js';

/**
 * Demande une valeur avant une action : le mot de passe pour afficher une
 * clé, la clé pour ouvrir une sauvegarde chiffrée.
 *
 * `window.prompt` n'existe pas dans Electron, et ne masquerait pas un mot de
 * passe : cette fenêtre en tient lieu.
 *
 * @param {{titre: string, message: string, libelle: string, type?: 'password'|'text',
 *   libelleValider?: string, onValider: Function, onAnnuler: Function}} props
 */
function DemandeSecret({ titre, message, libelle, type = 'password', libelleValider, onValider, onAnnuler }) {
  const { t } = useLangue();
  const [valeur, setValeur] = useState('');
  const conteneur = useModale(onAnnuler);

  const valider = (e) => {
    e.preventDefault();
    if (valeur.trim()) onValider(valeur);
  };

  // Dans `body`, comme la feuille de secours : un parent flouté enfermerait
  // la fenêtre dans son propre cadre.
  return createPortal(
    <div
      ref={conteneur}
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="demande-titre"
      aria-describedby="demande-message"
    >
      <form className="modal-content glass-panel" style={{ maxWidth: '460px' }} onSubmit={valider}>
        <h3 id="demande-titre" style={{ marginTop: 0 }}>{titre}</h3>
        <p id="demande-message" style={{ color: 'var(--text-muted)', lineHeight: 1.55 }}>{message}</p>
        <div className="form-group">
          <label htmlFor="demande-valeur">{libelle}</label>
          <input
            id="demande-valeur"
            type={type}
            className="form-control"
            value={valeur}
            onChange={(e) => setValeur(e.target.value)}
            autoComplete={type === 'password' ? 'current-password' : 'off'}
            spellCheck={false}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '24px' }}>
          <button type="button" className="btn-secondary" onClick={onAnnuler}>{t('Annuler')}</button>
          <button type="submit" className="btn-primary" disabled={!valeur.trim()}>{libelleValider || t('Continuer')}</button>
        </div>
      </form>
    </div>,
    document.body
  );
}

export default DemandeSecret;
