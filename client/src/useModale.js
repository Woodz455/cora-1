import { useEffect, useRef, useState } from 'react';

/** Éléments qui peuvent recevoir le focus, dans l'ordre du document. */
const FOCUSABLES = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])'
].join(', ');

/**
 * Rend une fenêtre modale utilisable au clavier.
 *
 * Les huit fenêtres de l'application annonçaient `role="dialog"` et
 * `aria-modal="true"` sans en tenir la promesse : Échap ne fermait rien, la
 * tabulation s'échappait derrière la fenêtre, et le focus n'était pas rendu à
 * son point de départ. Sur un logiciel où l'on enchaîne les saisies à la
 * journée, il fallait attraper la souris pour chaque fermeture.
 *
 * - `Échap` ferme la fenêtre.
 * - `Ctrl+Entrée` (ou `Cmd+Entrée`) valide, quand une action est fournie.
 * - La tabulation boucle à l'intérieur de la fenêtre.
 * - Le focus revient à l'élément qui a ouvert la fenêtre.
 *
 * L'écoute porte sur le document, et non sur le conteneur : plusieurs fenêtres
 * chargent leur contenu après le montage (la liste des clients, les détails
 * d'un document). Une écoute posée sur le conteneur ne recevait alors jamais
 * rien, faute d'un élément à focaliser au moment où elle s'installait.
 *
 * @param {Function} onFermer appelé sur Échap
 * @param {{onValider?: Function, actif?: boolean}} [options] `actif` pour les
 *   fenêtres rendues conditionnellement.
 * @returns {import('react').RefObject} à poser sur le conteneur de la fenêtre
 */
export function useModale(onFermer, { onValider, actif = true } = {}) {
  const conteneurRef = useRef(null);

  // Capturé au premier rendu, et non dans l'effet : au moment où l'effet
  // s'exécute, React a déjà donné le focus à un champ de la fenêtre, si bien
  // qu'on mémorisait un élément sur le point de disparaître — et le focus
  // retombait sur le corps de la page à la fermeture.
  const [origine] = useState(() => document.activeElement);

  // Les gestionnaires sont relus à chaque touche : sans cela, une fonction
  // recréée à chaque rendu relancerait l'effet et redonnerait le focus au
  // premier champ pendant la saisie.
  const actions = useRef({ onFermer, onValider });
  useEffect(() => { actions.current = { onFermer, onValider }; });

  useEffect(() => {
    const conteneur = conteneurRef.current;
    if (!actif || !conteneur) return undefined;

    const visibles = () => [...conteneur.querySelectorAll(FOCUSABLES)]
      .filter((el) => el.offsetParent !== null);

    /** Une fenêtre ouverte par-dessus une autre est seule à répondre au clavier. */
    const estAuPremierPlan = () => {
      const ouvertes = [...document.querySelectorAll('.modal-overlay')];
      return ouvertes[ouvertes.length - 1] === conteneur;
    };

    const donnerLeFocus = () => {
      const liste = visibles();
      if (liste.length === 0 || conteneur.contains(document.activeElement)) return false;
      liste[0].focus();
      return true;
    };

    // Le contenu arrive parfois après le montage : on réessaie tant qu'il n'y a
    // rien à focaliser, puis on cesse d'observer.
    let observateur = null;
    if (!donnerLeFocus()) {
      observateur = new MutationObserver(() => {
        if (donnerLeFocus()) {
          observateur.disconnect();
          observateur = null;
        }
      });
      observateur.observe(conteneur, { childList: true, subtree: true });
    }

    const surTouche = (e) => {
      if (!estAuPremierPlan()) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        actions.current.onFermer?.();
        return;
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        actions.current.onValider?.();
        return;
      }
      if (e.key !== 'Tab') return;

      const liste = visibles();
      if (liste.length === 0) return;
      const premier = liste[0];
      const dernier = liste[liste.length - 1];

      // Focus resté à l'extérieur : on le ramène plutôt que de le laisser
      // parcourir la page derrière la fenêtre.
      if (!conteneur.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? dernier : premier).focus();
        return;
      }
      if (e.shiftKey && document.activeElement === premier) {
        e.preventDefault();
        dernier.focus();
      } else if (!e.shiftKey && document.activeElement === dernier) {
        e.preventDefault();
        premier.focus();
      }
    };

    document.addEventListener('keydown', surTouche);
    return () => {
      document.removeEventListener('keydown', surTouche);
      if (observateur) observateur.disconnect();

      // Rendre le focus permet d'enchaîner : on rouvre la fenêtre suivante
      // depuis la même ligne, sans repartir du haut de la page. La restauration
      // attend l'image suivante : appelée pendant le démontage, elle était
      // aussitôt défaite par le navigateur, qui replaçait le focus sur le corps
      // de la page en retirant la fenêtre.
      if (origine && typeof origine.focus === 'function') {
        requestAnimationFrame(() => {
          if (origine.isConnected) origine.focus();
        });
      }
    };
    // `origine` provient d'un état initialisé une seule fois : il ne change
    // jamais, l'inclure dans les dépendances n'apporterait rien.
  }, [actif, origine]);

  return conteneurRef;
}
