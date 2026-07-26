import { createContext, useContext } from 'react';

/**
 * Contexte du compte connecté.
 *
 * Les composants masquaient certaines actions selon le rôle sans jamais y avoir
 * accès : les boutons de suppression et d'encaissement étaient affichés à tout
 * le monde, et l'utilisateur découvrait le refus au moment du clic. Le serveur
 * reste seul juge des permissions ; ce contexte sert uniquement à ne pas
 * proposer une action vouée à être rejetée.
 */
export const UserContext = createContext(null);

export function useUser() {
  return useContext(UserContext);
}

/** Indique si le compte connecté possède l'un des rôles attendus. */
export function useHasRole(...roles) {
  const user = useUser();
  return Boolean(user && roles.includes(user.role));
}
