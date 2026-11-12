/**
 * La date du jour, telle que l'utilisateur la lit sur son horloge.
 *
 * `new Date().toISOString()` rend la date en heure universelle. Au Québec, elle
 * a cinq heures d'avance l'hiver et quatre l'été : dès 19 h ou 20 h, les
 * formulaires proposaient la date du lendemain et une facture due le jour même
 * s'affichait en retard.
 *
 * Même règle que `dates.js` côté serveur, dupliquée faute de module partagé
 * entre l'interface et le serveur.
 */

const deuxChiffres = (n) => String(n).padStart(2, '0');

/** Jour civil d'un instant, AAAA-MM-JJ, dans le fuseau du poste. */
export function dateLocale(date = new Date()) {
  return `${date.getFullYear()}-${deuxChiffres(date.getMonth() + 1)}-${deuxChiffres(date.getDate())}`;
}

/** La date du jour, AAAA-MM-JJ, dans le fuseau du poste. */
export function aujourdhui() {
  return dateLocale(new Date());
}
