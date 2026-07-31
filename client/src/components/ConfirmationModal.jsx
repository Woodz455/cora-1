import { useModale } from '../useModale';

/**
 * Fenêtre de confirmation, à la place de `window.confirm`.
 *
 * Les fenêtres natives posent trois problèmes ici : elles ignorent le thème de
 * l'application, elles bloquent le rendu tant qu'on n'a pas répondu, et elles
 * échappent à toute vérification automatique — le pilotage d'Electron reste
 * suspendu devant une boîte système. La famille est d'ailleurs déjà responsable
 * d'une régression livrée : `window.prompt` n'existe pas dans Electron, et
 * l'annulation d'un encaissement était inerte dans l'application de bureau.
 *
 * @param {string} titre
 * @param {string} message
 * @param {string} [libelleConfirmer]
 * @param {boolean} [danger] colore le bouton en rouge, pour une action qui détruit
 * @param {Function} onConfirmer
 * @param {Function} onAnnuler
 */
function ConfirmationModal({
  titre,
  message,
  libelleConfirmer = 'Confirmer',
  libelleAnnuler = 'Annuler',
  danger = false,
  onConfirmer,
  onAnnuler
}) {
  const modaleRef = useModale(onAnnuler, { onValider: onConfirmer });

  return (
    <div
      ref={modaleRef}
      className="modal-overlay"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirmation-titre"
      aria-describedby="confirmation-message"
    >
      <div className="modal-content glass-panel" style={{ maxWidth: '460px' }}>
        <h3 id="confirmation-titre" style={{ marginTop: 0 }}>{titre}</h3>
        <p id="confirmation-message" style={{ color: 'var(--text-muted)', lineHeight: 1.55 }}>
          {message}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '24px' }}>
          {/* « Annuler » d'abord dans le document : c'est lui qui reçoit le
              focus à l'ouverture, pour qu'une frappe distraite ne détruise rien. */}
          <button type="button" className="btn-secondary" onClick={onAnnuler}>
            {libelleAnnuler}
          </button>
          <button type="button" className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirmer}>
            {libelleConfirmer}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmationModal;
