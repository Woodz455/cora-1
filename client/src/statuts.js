/**
 * Statuts des factures et des devis, tels que le serveur les enregistre.
 *
 * Ce sont des valeurs, comparées par les filtres et par le serveur : elles
 * restent en français, et ne sont traduites qu'à l'affichage, par
 * `t(statut)`. Le test des traductions lit ce fichier pour s'assurer que
 * chacune a son équivalent anglais.
 */
export const STATUTS_FACTURE = ['En attente', 'Partiellement payée', 'Payée', 'Créditée', 'Annulée'];

export const STATUTS_DEVIS = ['En attente', 'Refusé', 'Converti'];
