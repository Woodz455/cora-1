/**
 * Planificateur des tâches récurrentes.
 *
 * La génération des factures d'abonnement n'avait lieu qu'au démarrage du
 * serveur : sur un poste laissé allumé, aucune facture récurrente n'était jamais
 * émise. Elle est désormais revérifiée périodiquement.
 *
 * L'opération est idempotente — `date_prochaine_generation` avance à chaque
 * facture émise — donc une vérification fréquente est sans risque.
 */

const { checkAndGenerateRecurringInvoices } = require('./subscriptionService.js');
const { envoyerRelancesDues } = require('./relanceService.js');

/** Intervalle entre deux vérifications. */
const INTERVALLE_MS = 60 * 60 * 1000; // 1 heure

let timer = null;

async function runOnce(db) {
  try {
    const { generees, erreurs } = await checkAndGenerateRecurringInvoices(db);
    if (generees > 0 || erreurs > 0) {
      console.log(`Facturation récurrente : ${generees} facture(s) générée(s), ${erreurs} erreur(s).`);
    }
  } catch (error) {
    console.error('Échec de la vérification des abonnements :', error.message);
  }

  try {
    const resultat = await envoyerRelancesDues(db);
    if (resultat.envoyees > 0 || resultat.erreurs > 0) {
      console.log(`Relances : ${resultat.envoyees} envoyée(s), ${resultat.erreurs} en échec.`);
    }
  } catch (error) {
    console.error('Échec de l\'envoi des relances :', error.message);
  }
}

/**
 * Démarre la vérification périodique des abonnements.
 * @param {import('sqlite').Database} db
 */
function startScheduler(db) {
  runOnce(db);

  timer = setInterval(() => runOnce(db), INTERVALLE_MS);
  // Ne pas maintenir le processus en vie pour ce seul minuteur.
  if (typeof timer.unref === 'function') timer.unref();

  return timer;
}

function stopScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { startScheduler, stopScheduler, runOnce, INTERVALLE_MS };
