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
const { sauvegardeSiNecessaire } = require('./backupService.js');
const { ouvrirEntreprise } = require('./companyStore.js');
const { relever } = require('./paiementEnLigneService.js');

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

  // Les règlements reçus en ligne sont portés aux comptes ici : c'est ce qui
  // dispense l'utilisateur d'aller consulter son tableau de bord Stripe et de
  // ressaisir à la main ce qu'il y trouve. `relever` ne lève pas et ne fait
  // rien tant que le paiement en ligne n'est pas configuré.
  try {
    const stripe = await relever(db);
    if (stripe.inscrits > 0 || stripe.refuses > 0) {
      console.log(`Paiements en ligne : ${stripe.inscrits} encaissement(s) inscrit(s), `
        + `${stripe.refuses} non imputé(s).`);
    }
  } catch (error) {
    console.error('Échec du relevé des paiements en ligne :', error.message);
  }

  // `sauvegardeSiNecessaire` ne lève pas : un dossier de destination absent —
  // un espace synchronisé hors ligne, par exemple — ne doit pas empêcher la
  // facturation récurrente de tourner au passage suivant.
  await sauvegardeSiNecessaire(db);
}

/**
 * Passe sur **tous** les dossiers enregistrés.
 *
 * Le planificateur ne traitait qu'une base. Avec plusieurs dossiers, s'en tenir
 * à celui qui est ouvert aurait laissé les autres sans relances, sans factures
 * récurrentes et surtout **sans sauvegarde** — un comptable qui ne rouvre un
 * dossier qu'au trimestre n'en aurait plus aucune copie entre-temps.
 *
 * Un dossier en échec — fichier déplacé, disque plein — n'interrompt pas les
 * suivants : c'est la même règle que pour les relances individuelles.
 */
async function runOnceTousDossiers(comptesDb) {
  const dossiers = await comptesDb.all('SELECT id, nom, chemin FROM entreprises WHERE archive = 0');

  for (const dossier of dossiers) {
    try {
      const db = await ouvrirEntreprise(dossier.chemin);
      await runOnce(db);
    } catch (error) {
      console.error(`Passage impossible sur le dossier « ${dossier.nom} » :`, error.message);
    }
  }
}

/**
 * Démarre la vérification périodique, sur l'ensemble des dossiers.
 *
 * Le planificateur tourne sur minuterie, donc hors de toute requête : il reçoit
 * le registre explicitement plutôt que par le contexte asynchrone, qui n'existe
 * que le temps d'une requête HTTP.
 *
 * @param {import('sqlite').Database} comptesDb
 */
function startScheduler(comptesDb) {
  runOnceTousDossiers(comptesDb);

  timer = setInterval(() => runOnceTousDossiers(comptesDb), INTERVALLE_MS);
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

module.exports = { startScheduler, stopScheduler, runOnce, runOnceTousDossiers, INTERVALLE_MS };
