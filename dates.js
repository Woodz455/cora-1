/**
 * La date du jour, telle que l'utilisateur la lit sur son horloge.
 *
 * `new Date().toISOString()` rend la date en heure universelle. Au Québec, elle
 * a cinq heures d'avance l'hiver et quatre l'été : dès 19 h ou 20 h,
 * « aujourd'hui » devenait le lendemain. Une facture émise le 30 novembre au
 * soir était datée du 1er décembre, numérotée dans la série de décembre et
 * comptée dans la mauvaise période de taxes ; une facture due le jour même
 * passait en retard avant minuit.
 *
 * Seule la lecture de la date du jour est concernée. L'arithmétique sur des
 * dates déjà enregistrées (échéances, jours de retard) reste en heure
 * universelle, où un jour compte toujours vingt-quatre heures.
 */

const deuxChiffres = (n) => String(n).padStart(2, '0');

/**
 * Jour civil d'un instant, dans le fuseau du poste.
 *
 * @param {Date} [date]
 * @returns {string} AAAA-MM-JJ
 */
function dateLocale(date = new Date()) {
  return `${date.getFullYear()}-${deuxChiffres(date.getMonth() + 1)}-${deuxChiffres(date.getDate())}`;
}

/** La date du jour, AAAA-MM-JJ, dans le fuseau du poste. */
function aujourdhui() {
  return dateLocale(new Date());
}

module.exports = { dateLocale, aujourdhui };
