import { createContext, useContext } from 'react';

/**
 * Retour d'information unifié : messages éphémères et demandes de confirmation.
 *
 * L'application mélangeait trois conventions — des bandeaux `alert` que chaque
 * écran gérait pour son compte, un `window.alert`, et huit `window.confirm`.
 * Les fenêtres natives échappent au thème comme aux vérifications automatiques,
 * et l'une d'elles, `window.prompt`, n'existe simplement pas dans Electron.
 */
export const FeedbackContext = createContext(null);

/**
 * @returns {{notifier: Function, confirmer: (options: Object) => Promise<boolean>}}
 *   `notifier(texte, type)` avec `type` parmi `succes`, `erreur`, `info`.
 *   `confirmer({titre, message, libelleConfirmer, danger})` résout à `true` si
 *   l'utilisateur accepte, à `false` s'il annule ou ferme la fenêtre.
 */
export function useFeedback() {
  const contexte = useContext(FeedbackContext);
  if (!contexte) {
    throw new Error('useFeedback doit être utilisé dans un FeedbackProvider.');
  }
  return contexte;
}
