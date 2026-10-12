import { createContext, useContext } from 'react';
import EN from './traductions/en.js';

/**
 * Langue de l'interface.
 *
 * Le texte français est la clé : `t('Nouvelle facture')` rend « Nouvelle
 * facture » en français et « New invoice » en anglais. Le code se lit donc tel
 * qu'avant, et un texte absent du dictionnaire s'affiche en français plutôt
 * que vide. Un test refuse toute clé employée sans sa traduction.
 *
 * La langue appartient au compte : le serveur la garde, et la rend à la
 * connexion. Avant la connexion, elle vient de la dernière employée sur ce
 * poste, sinon de celle du système.
 */

export const LANGUES = ['fr', 'en'];

function langueInitiale() {
  try {
    const memorisee = localStorage.getItem('langue');
    if (LANGUES.includes(memorisee)) return memorisee;
  } catch {
    // Stockage indisponible : on se rabat sur la langue du système.
  }
  const systeme = (typeof navigator !== 'undefined' && navigator.language) || 'fr';
  return systeme.toLowerCase().startsWith('en') ? 'en' : 'fr';
}

/**
 * Langue courante, lisible hors des composants : le client HTTP l'annonce au
 * serveur, qui traduit ses messages en conséquence.
 */
let courante = langueInitiale();

export function langueCourante() {
  return courante;
}

/** Change la langue courante, et la retient sur ce poste. */
export function definirLangueCourante(nouvelle) {
  if (!LANGUES.includes(nouvelle)) return false;
  courante = nouvelle;
  try {
    localStorage.setItem('langue', nouvelle);
  } catch {
    // Sans stockage, la langue vaut pour la session seulement.
  }
  document.documentElement.lang = nouvelle;
  return true;
}

/** Remplace `{nom}` par la valeur correspondante. */
function remplir(texte, valeurs) {
  if (!valeurs) return texte;
  return texte.replace(/\{(\w+)\}/g, (tout, cle) => (cle in valeurs ? String(valeurs[cle]) : tout));
}

/**
 * Traduit un texte français dans la langue donnée.
 *
 * Une clé peut porter un contexte, un mot en minuscules collé après une
 * barre verticale en fin de clé : « {n} devis en attente de réponse|pluriel ». Il départage deux textes que le français écrit
 * pareil et que l'anglais distingue (« 1 quote », « 2 quotes »), et n'est
 * jamais affiché.
 */
export function traduire(texte, valeurs, langue = courante) {
  // Seul un mot collé en fin de clé est un contexte : « | Émise le … » commence
  // par une barre, et doit s'afficher tel quel.
  const base = langue === 'en' && texte in EN ? EN[texte] : texte.replace(/\|[a-z]+$/, '');
  return remplir(base, valeurs);
}

/**
 * Choisit entre singulier et pluriel, selon la règle de chaque langue : en
 * français, 0 et 1 sont au singulier ; en anglais, seul 1 l'est.
 */
export function traduirePluriel(n, singulier, pluriel, valeurs, langue = courante) {
  const unique = langue === 'en' ? n === 1 : Math.abs(n) < 2;
  return traduire(unique ? singulier : pluriel, { n, ...valeurs }, langue);
}

export const LangueContext = createContext(null);

/**
 * @returns {{langue: string, changerLangue: Function, t: Function, tp: Function, montant: Function}}
 */
export function useLangue() {
  const contexte = useContext(LangueContext);
  if (!contexte) throw new Error('useLangue doit être utilisé dans un LangueProvider.');
  return contexte;
}
