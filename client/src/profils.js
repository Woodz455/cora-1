/**
 * Profils de dossier proposés à la création.
 *
 * Dupliqué depuis `profils.js` côté serveur, faute de module partagé entre le
 * serveur et l'interface ; un test vérifie que les valeurs et les libellés
 * restent alignés. Les descriptions n'existent qu'ici : le serveur n'en a
 * pas l'usage.
 */
export const PROFILS = [
  {
    valeur: 'autonome', libelle: 'Travailleur autonome',
    description: 'Vous facturez seul. Vos clients paient à la réception, vos déplacements comptent.'
  },
  {
    valeur: 'startup', libelle: 'Startup en démarrage',
    description: 'Des abonnements, le paiement en ligne, et des clients à faire grandir.'
  },
  {
    valeur: 'pme', libelle: 'PME établie',
    description: 'Une équipe, un comptable, et un relevé bancaire à rapprocher.'
  }
];

/** Libellé d'un profil, ou une mention neutre pour un dossier qui n'en a pas. */
export function libelleProfil(valeur) {
  const profil = PROFILS.find((p) => p.valeur === valeur);
  return profil ? profil.libelle : 'Non précisé';
}
