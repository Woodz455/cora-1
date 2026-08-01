import { useEffect } from 'react';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';

const ICONES = { succes: CheckCircle, erreur: AlertCircle, info: Info };

/**
 * Message éphémère, affiché en superposition dans le coin de l'écran.
 *
 * Remplace `window.alert` et les bandeaux de succès que chaque écran gérait
 * pour son compte, avec son propre état et sa propre place dans la page. Les
 * erreurs, elles, restent affichées près du formulaire concerné : elles
 * demandent une correction et ne doivent pas disparaître toutes seules.
 *
 * `role="status"` plutôt que `role="alert"` : le message est annoncé sans
 * interrompre la saisie en cours. Le conteneur est rendu en permanence, même
 * vide : une zone vivante créée en même temps que son contenu n'est
 * généralement pas annoncée, le lecteur d'écran devant l'observer au préalable.
 */
function Notification({ notifications, onFermer }) {
  return (
    <div className="notifications" role="status" aria-live="polite">
      {notifications.map((n) => (
        <Message key={n.id} notification={n} onFermer={() => onFermer(n.id)} />
      ))}
    </div>
  );
}

function Message({ notification, onFermer }) {
  const { type, texte, duree } = notification;
  const Icone = ICONES[type] || Info;

  useEffect(() => {
    if (!duree) return undefined;
    const minuterie = setTimeout(onFermer, duree);
    return () => clearTimeout(minuterie);
    // `onFermer` est recréé à chaque rendu du parent : l'inclure relancerait le
    // compte à rebours sans cesse, et le message ne partirait jamais.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duree]);

  return (
    <div className={`notification notification-${type}`}>
      <Icone size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
      <span>{texte}</span>
      <button type="button" className="notification-fermer" onClick={onFermer} aria-label="Fermer le message">
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

export default Notification;
