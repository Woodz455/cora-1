/**
 * Service gérant les abonnements (facturation récurrente).
 */

const { createFacture } = require('./invoiceService.js');
const { validateLignes } = require('./validators.js');

const CYCLES = ['Mensuel', 'Annuel'];
const STATUTS = ['Actif', 'Inactif'];

/** Délai de paiement des factures générées automatiquement, en jours. */
const DELAI_PAIEMENT_JOURS = 30;

/**
 * Garde-fou : nombre maximal de factures générées pour un même abonnement lors
 * d'un seul passage. Protège contre une date de départ lointaine saisie par
 * erreur, qui produirait des centaines de factures.
 */
const MAX_RATTRAPAGE = 24;

const iso = (date) => date.toISOString().split('T')[0];

/**
 * Ajoute un cycle à une date, en bornant le jour du mois.
 *
 * `setMonth` seul déborde : le 31 janvier + 1 mois donnerait le 3 mars. Une
 * échéance mensuelle fixée au 31 doit tomber le 28 ou 29 février.
 *
 * @param {string} dateStr date au format YYYY-MM-DD
 * @param {string} cycle 'Mensuel' ou 'Annuel'
 * @returns {string} nouvelle date au format YYYY-MM-DD
 */
function addCycle(dateStr, cycle) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const targetYear = cycle === 'Annuel' ? y + 1 : (m === 12 ? y + 1 : y);
  const targetMonth = cycle === 'Annuel' ? m : (m === 12 ? 1 : m + 1);
  const daysInTarget = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const day = Math.min(d, daysInTarget);
  return iso(new Date(Date.UTC(targetYear, targetMonth - 1, day)));
}

async function getSubscriptions(db) {
  return db.all(`
    SELECT a.*, c.nom_entreprise AS client_nom
    FROM abonnements a
    JOIN clients c ON a.client_id = c.id
    ORDER BY a.statut ASC, a.date_prochaine_generation ASC
  `);
}

/**
 * Valide les lignes stockées sous forme de JSON dans l'abonnement.
 * @returns {Array} lignes normalisées
 */
function parseLignesJson(lignesJson) {
  let parsed;
  try {
    parsed = typeof lignesJson === 'string' ? JSON.parse(lignesJson) : lignesJson;
  } catch (e) {
    throw Object.assign(new Error('Les lignes de l\'abonnement sont illisibles.'), { status: 400 });
  }
  const result = validateLignes(parsed);
  if (result.error) {
    throw Object.assign(new Error(result.error), { status: 400 });
  }
  return result.lignes;
}

async function createSubscription(db, data) {
  const { client_id, titre, lignes_json, cycle, date_prochaine_generation, devise } = data;

  const client = await db.get('SELECT id FROM clients WHERE id = ?', [client_id]);
  if (!client) {
    throw Object.assign(new Error('Client introuvable.'), { status: 400 });
  }
  const lignes = parseLignesJson(lignes_json);
  const cycleValide = CYCLES.includes(cycle) ? cycle : 'Mensuel';

  const result = await db.run(
    `INSERT INTO abonnements (client_id, titre, lignes_json, cycle, date_prochaine_generation, devise)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [client_id, titre, JSON.stringify(lignes), cycleValide, date_prochaine_generation, devise || 'CAD']
  );
  return db.get('SELECT * FROM abonnements WHERE id = ?', [result.lastID]);
}

async function updateSubscription(db, id, data) {
  const existant = await db.get('SELECT * FROM abonnements WHERE id = ?', [id]);
  if (!existant) {
    throw Object.assign(new Error('Abonnement non trouvé.'), { status: 404 });
  }

  // Mise à jour partielle : les champs absents de la requête conservent leur
  // valeur, ce qui évite qu'un simple basculement de statut efface les lignes.
  const titre = data.titre !== undefined ? data.titre : existant.titre;
  const lignes = data.lignes_json !== undefined
    ? JSON.stringify(parseLignesJson(data.lignes_json))
    : existant.lignes_json;
  const cycle = CYCLES.includes(data.cycle) ? data.cycle : existant.cycle;
  const statut = STATUTS.includes(data.statut) ? data.statut : existant.statut;
  const devise = data.devise !== undefined ? data.devise : existant.devise;
  const prochaine = data.date_prochaine_generation !== undefined
    ? data.date_prochaine_generation
    : existant.date_prochaine_generation;

  await db.run(
    `UPDATE abonnements SET titre = ?, lignes_json = ?, cycle = ?,
                            date_prochaine_generation = ?, statut = ?, devise = ?
     WHERE id = ?`,
    [titre, lignes, cycle, prochaine, statut, devise, id]
  );
  return db.get('SELECT * FROM abonnements WHERE id = ?', [id]);
}

async function deleteSubscription(db, id) {
  const existant = await db.get('SELECT id FROM abonnements WHERE id = ?', [id]);
  if (!existant) {
    throw Object.assign(new Error('Abonnement non trouvé.'), { status: 404 });
  }
  await db.run('DELETE FROM abonnements WHERE id = ?', [id]);
  return { success: true };
}

/**
 * Génère les factures des abonnements arrivés à échéance.
 *
 * Chaque période échue donne sa propre facture, datée de la période concernée :
 * l'implémentation précédente n'émettait qu'une seule facture puis repoussait la
 * date au prochain cycle, si bien qu'un abonnement laissé trois mois sans
 * exécution perdait définitivement deux mois de facturation.
 *
 * @returns {Promise<{generees: number, erreurs: number}>}
 */
async function checkAndGenerateRecurringInvoices(db) {
  const today = iso(new Date());
  const dueSubs = await db.all(
    "SELECT * FROM abonnements WHERE statut = 'Actif' AND date_prochaine_generation <= ?",
    [today]
  );

  let generees = 0;
  let erreurs = 0;

  for (const sub of dueSubs) {
    try {
      const lignes = parseLignesJson(sub.lignes_json);
      let dateGeneration = sub.date_prochaine_generation;
      let iterations = 0;

      while (dateGeneration <= today && iterations < MAX_RATTRAPAGE) {
        const echeance = new Date(`${dateGeneration}T00:00:00Z`);
        echeance.setUTCDate(echeance.getUTCDate() + DELAI_PAIEMENT_JOURS);

        await createFacture(db, {
          client_id: sub.client_id,
          date_emission: dateGeneration,
          date_echeance: iso(echeance),
          devise: sub.devise || 'CAD',
          taux_change: 1.0
        }, lignes);

        generees += 1;
        iterations += 1;
        dateGeneration = addCycle(dateGeneration, sub.cycle);
      }

      await db.run(
        'UPDATE abonnements SET date_prochaine_generation = ? WHERE id = ?',
        [dateGeneration, sub.id]
      );
      console.log(`Abonnement ${sub.id} : ${iterations} facture(s) générée(s). Prochaine échéance le ${dateGeneration}.`);
    } catch (e) {
      erreurs += 1;
      console.error(`Erreur de génération pour l'abonnement ${sub.id} :`, e.message);
    }
  }

  return { generees, erreurs };
}

module.exports = {
  getSubscriptions,
  createSubscription,
  updateSubscription,
  deleteSubscription,
  checkAndGenerateRecurringInvoices,
  addCycle,
  CYCLES,
  STATUTS
};
