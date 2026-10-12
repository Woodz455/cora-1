/**
 * Statuts et valeurs fixes, tels que le serveur les enregistre.
 *
 * Ce sont des valeurs, comparées par les filtres et par le serveur : elles
 * restent en français, et ne sont traduites qu'à l'affichage, par
 * `t(statut)`. Le test des traductions lit ce fichier pour s'assurer que
 * chacune a son équivalent anglais.
 */
export const STATUTS_FACTURE = ['En attente', 'Partiellement payée', 'Payée', 'Créditée', 'Annulée'];

export const STATUTS_DEVIS = ['En attente', 'Refusé', 'Converti'];

export const STATUTS_ABONNEMENT = ['Actif', 'Inactif'];

export const CYCLES_ABONNEMENT = ['Mensuel', 'Annuel'];

/**
 * Catégories de dépenses proposées. Une catégorie saisie à la main est
 * enregistrée telle quelle et s'affiche telle quelle, dans toutes les langues.
 */
export const CATEGORIES_DEPENSE = [
  'Matériel',
  'Logiciels et abonnements',
  'Sous-traitance',
  "Repas d'affaires",
  'Frais de déplacement',
  'Fournitures de bureau',
  'Autres dépenses'
];
