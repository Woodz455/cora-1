/**
 * Indemnité kilométrique, au taux à deux paliers.
 *
 * Un déplacement est une dépense dont `kilometres` n'est pas nul. Son montant
 * n'est pas saisi : il découle des kilomètres parcourus et du taux de l'année,
 * dégressif au-delà d'un seuil — les cinq mille premiers kilomètres à un taux,
 * le reste à un taux moindre.
 *
 * ## Pourquoi les montants sont recalculés, et non figés
 *
 * Le reste de Clora fige les montants à l'émission : une facture remise à un
 * client ne doit pas changer de montant parce qu'un taux a bougé. Le
 * kilométrage fait exception, **délibérément**.
 *
 * Le montant d'un déplacement est, par construction, fonction du **cumul de
 * l'année** : c'est ce cumul qui décide de quel côté du seuil il tombe. Le
 * figer à la saisie ferait dépendre le montant de l'ordre dans lequel les
 * trajets ont été entrés, et antidater un trajet oublié laisserait l'année
 * fausse sans que rien ne le signale.
 *
 * L'exception se tient parce qu'un déplacement n'est remis à personne. C'est
 * une ligne de journal interne, pas une pièce entre les mains d'un tiers : la
 * recalculer ne trahit aucune promesse.
 *
 * ## Réserve fiscale
 *
 * Le taux au kilomètre est la méthode de l'**indemnité** — juste pour un
 * employé indemnisé, ou un actionnaire qui se verse une allocation de sa
 * société. Un travailleur autonome non incorporé doit proratiser ses coûts
 * réels selon l'usage d'affaires de son véhicule ; le montant calculé ici n'est
 * alors qu'une estimation. L'interface nomme la chose « indemnité
 * kilométrique » pour cette raison.
 */

const { roundCents } = require('./money.js');
const { withTransaction } = require('./dbUtils.js');

/** Seuil proposé par défaut à qui règle une année pour la première fois. */
const SEUIL_PAR_DEFAUT = 5000;

/** Année d'une date au format AAAA-MM-JJ. */
function anneeDe(date) {
  const annee = Number(String(date || '').slice(0, 4));
  return Number.isInteger(annee) && annee > 1900 ? annee : null;
}

/**
 * Taux en vigueur pour une année.
 * Renvoie `null` lorsque l'année n'a pas été réglée — cas que les appelants
 * traitent en refusant la saisie, plutôt qu'en produisant un montant nul.
 */
async function tauxDeLAnnee(db, annee) {
  if (!Number.isInteger(annee)) return null;
  const ligne = await db.get(
    'SELECT annee, taux_1, taux_2, seuil_km FROM taux_kilometriques WHERE annee = ?',
    [annee]
  );
  return ligne || null;
}

/** Toutes les années réglées, de la plus récente à la plus ancienne. */
async function listerTaux(db) {
  return db.all('SELECT annee, taux_1, taux_2, seuil_km FROM taux_kilometriques ORDER BY annee DESC');
}

/**
 * Répartit une distance de part et d'autre du seuil.
 *
 * Un trajet peut l'enjamber : à 4 900 km déjà parcourus, un trajet de 200 km
 * compte 100 km au premier taux et 100 km au second. Le traiter en bloc, d'un
 * côté ou de l'autre, fausserait l'année de la différence entre les deux taux.
 *
 * @param {number} km distance du trajet
 * @param {number} cumulAvant kilomètres déjà parcourus dans l'année
 * @param {{taux_1: number, taux_2: number, seuil_km: number}} taux
 */
function repartir(km, cumulAvant, taux) {
  const souslePalier = Math.max(0, taux.seuil_km - cumulAvant);
  const km1 = Math.min(km, souslePalier);
  const km2 = km - km1;

  return {
    km_taux_1: km1,
    km_taux_2: km2,
    // Arrondi une fois, par trajet : le total d'une période est la somme de
    // montants déjà arrondis, comme partout ailleurs dans Clora.
    montant: roundCents(km1 * taux.taux_1 + km2 * taux.taux_2)
  };
}

/**
 * Recalcule les montants de tous les déplacements d'une année.
 *
 * Le tri par date puis par identifiant est ce qui rend le résultat indépendant
 * de l'ordre de saisie : deux trajets du même jour sont départagés par leur
 * identifiant, de façon stable.
 *
 * @returns {Promise<{trajets: number, kilometres: number, montant: number}>}
 */
async function recalculerAnnee(db, annee) {
  if (!Number.isInteger(annee)) return { trajets: 0, kilometres: 0, montant: 0 };

  const taux = await tauxDeLAnnee(db, annee);
  const trajets = await db.all(
    `SELECT id, kilometres FROM depenses
     WHERE kilometres IS NOT NULL AND date_depense >= ? AND date_depense <= ?
     ORDER BY date_depense ASC, id ASC`,
    [`${annee}-01-01`, `${annee}-12-31`]
  );

  if (trajets.length === 0) return { trajets: 0, kilometres: 0, montant: 0 };

  if (!taux) {
    // Ne devrait pas survenir : la saisie est refusée tant que l'année n'a pas
    // ses taux, et une année réglée ne se supprime pas. Échouer bruyamment vaut
    // mieux que réécrire des montants à zéro sans que personne ne le voie.
    throw Object.assign(
      new Error(`Aucun taux kilométrique n'est réglé pour ${annee}.`),
      { status: 400 }
    );
  }

  return withTransaction(db, async () => {
    let cumul = 0;
    let montantTotal = 0;

    for (const trajet of trajets) {
      const km = Number(trajet.kilometres) || 0;
      const { montant } = repartir(km, cumul, taux);
      cumul += km;
      montantTotal = roundCents(montantTotal + montant);

      // Une indemnité kilométrique n'ouvre à aucune taxe récupérable ici : les
      // deux colonnes sont remises à zéro plutôt que laissées telles quelles,
      // au cas où la dépense aurait d'abord été saisie comme une dépense
      // ordinaire puis convertie en déplacement.
      await db.run(
        'UPDATE depenses SET montant_ht = ?, tps = 0, tvq = 0, montant_ttc = ? WHERE id = ?',
        [montant, montant, trajet.id]
      );
    }

    return { trajets: trajets.length, kilometres: cumul, montant: montantTotal };
  });
}

/**
 * Recalcule les années touchées par un changement.
 *
 * Deux années lorsqu'un trajet change de date d'un exercice à l'autre : celle
 * qu'il quitte comme celle qu'il rejoint doivent être réajustées.
 */
async function recalculerAnnees(db, ...dates) {
  const annees = [...new Set(dates.map(anneeDe).filter((a) => a !== null))];
  for (const annee of annees) await recalculerAnnee(db, annee);
  return annees;
}

/**
 * Enregistre les taux d'une année, puis en réajuste les montants.
 *
 * La suppression n'est pas offerte : elle laisserait des déplacements dont
 * aucun taux ne peut plus expliquer le montant.
 */
async function definirTaux(db, { annee, taux_1, taux_2, seuil_km }) {
  return withTransaction(db, async () => {
    await db.run(
      `INSERT INTO taux_kilometriques (annee, taux_1, taux_2, seuil_km)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(annee) DO UPDATE SET taux_1 = excluded.taux_1,
                                        taux_2 = excluded.taux_2,
                                        seuil_km = excluded.seuil_km`,
      [annee, taux_1, taux_2, seuil_km]
    );
    await recalculerAnnee(db, annee);
    return tauxDeLAnnee(db, annee);
  });
}

module.exports = {
  SEUIL_PAR_DEFAUT,
  anneeDe,
  tauxDeLAnnee,
  listerTaux,
  repartir,
  recalculerAnnee,
  recalculerAnnees,
  definirTaux
};
