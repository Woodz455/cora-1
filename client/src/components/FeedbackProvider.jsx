import { useState, useRef, useCallback, useMemo } from 'react';
import Notification from './Notification';
import ConfirmationModal from './ConfirmationModal';
import { FeedbackContext } from '../FeedbackContext';

/** Un succès s'efface seul ; une erreur attend qu'on l'ait lue. */
const DUREES = { succes: 4000, info: 5000, erreur: 0 };

/**
 * Monte une fois, à la racine, le fil des messages et la fenêtre de
 * confirmation, et les expose à toute l'application.
 */
function FeedbackProvider({ children }) {
  const [notifications, setNotifications] = useState([]);
  const [confirmation, setConfirmation] = useState(null);
  const compteur = useRef(0);

  const fermer = useCallback((id) => {
    setNotifications((prec) => prec.filter((n) => n.id !== id));
  }, []);

  const notifier = useCallback((texte, type = 'succes') => {
    compteur.current += 1;
    const id = compteur.current;
    setNotifications((prec) => [...prec, { id, texte, type, duree: DUREES[type] ?? 4000 }]);
    return id;
  }, []);

  /**
   * Ouvre la fenêtre et rend une promesse : l'appelant écrit
   * `if (!await confirmer({…})) return;`, comme avec `window.confirm`.
   */
  const confirmer = useCallback((options) => new Promise((resoudre) => {
    setConfirmation({ ...options, resoudre });
  }), []);

  const repondre = useCallback((reponse) => {
    setConfirmation((prec) => {
      prec?.resoudre(reponse);
      return null;
    });
  }, []);

  // Mémorisé : sans cela, chaque rendu du provider donnerait une nouvelle
  // valeur au contexte et rendrait à nouveau tous les écrans.
  const valeur = useMemo(() => ({ notifier, confirmer }), [notifier, confirmer]);

  return (
    <FeedbackContext.Provider value={valeur}>
      {children}
      <Notification notifications={notifications} onFermer={fermer} />
      {confirmation && (
        <ConfirmationModal
          titre={confirmation.titre}
          message={confirmation.message}
          libelleConfirmer={confirmation.libelleConfirmer}
          libelleAnnuler={confirmation.libelleAnnuler}
          danger={confirmation.danger}
          onConfirmer={() => repondre(true)}
          onAnnuler={() => repondre(false)}
        />
      )}
    </FeedbackContext.Provider>
  );
}

export default FeedbackProvider;
