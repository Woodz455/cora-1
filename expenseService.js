/**
 * Service gérant les dépenses et achats (et les taxes récupérables, CTI/RTI).
 *
 * Une dépense dont `kilometres` n'est pas nul est un **déplacement** : son
 * montant n'est pas saisi mais calculé par `kilometrageService`, au taux à deux
 * paliers de l'année. Voir ce module pour la règle et sa réserve fiscale.
 */

const { sanitizeText, isValidDate } = require('./validators.js');
const { roundCents } = require('./money.js');
const { withTransaction } = require('./dbUtils.js');
const {
  anneeDe, tauxDeLAnnee, recalculerAnnees
} = require('./kilometrageService.js');

/**
 * Lit la distance d'un déplacement.
 *
 * Renvoie `null` pour une dépense ordinaire — champ absent, vide ou nul —, et
 * `undefined` lorsque la valeur est présente mais inutilisable, ce que
 * l'appelant traduit en erreur.
 */
function parseKilometres(valeur) {
  if (valeur === undefined || valeur === null || valeur === '') return null;

  const km = Number(valeur);
  if (!Number.isFinite(km) || km <= 0) return undefined;
  // Le dixième de kilomètre suffit : au taux courant, il pèse sept cents.
  return Math.round(km * 10) / 10;
}

/**
 * Valide une dépense et recalcule son total.
 *
 * Le montant TTC est toujours recalculé côté serveur : il était jusqu'ici repris
 * tel quel du formulaire, ce qui permettait d'enregistrer une dépense dont le
 * total ne correspondait pas à ses composantes et faussait le rapport de taxes.
 *
 * @returns {{error: string} | {depense: Object}}
 */
function validateExpense(body) {
  if (!isValidDate(body.date_depense)) {
    return { error: 'La date de la dépense est requise (format AAAA-MM-JJ).' };
  }

  const kilometres = parseKilometres(body.kilometres);
  if (kilometres === undefined) {
    return { error: 'La distance parcourue doit être un nombre de kilomètres supérieur à zéro.' };
  }

  const commun = {
    fournisseur: sanitizeText(body.fournisseur, 200),
    description: sanitizeText(body.description, 500),
    date_depense: body.date_depense,
    categorie: sanitizeText(body.categorie, 100),
    kilometres,
    vehicule: sanitizeText(body.vehicule, 120)
  };

  // Déplacement : le montant vient du calcul, jamais du formulaire. Reprendre
  // un `montant_ht` envoyé par le client laisserait inscrire l'indemnité de son
  // choix, taux et distance n'ayant alors plus aucun rapport avec le montant.
  if (kilometres !== null) {
    return { depense: { ...commun, montant_ht: 0, tps: 0, tvq: 0, montant_ttc: 0 } };
  }

  const montant_ht = Number(body.montant_ht);
  if (!Number.isFinite(montant_ht) || montant_ht < 0) {
    return { error: 'Le montant hors taxes doit être un nombre positif.' };
  }

  const tps = Number(body.tps) || 0;
  const tvq = Number(body.tvq) || 0;
  if (tps < 0 || tvq < 0) {
    return { error: 'Les montants de taxes ne peuvent pas être négatifs.' };
  }

  const ht = roundCents(montant_ht);
  const t1 = roundCents(tps);
  const t2 = roundCents(tvq);

  return {
    depense: {
      ...commun,
      montant_ht: ht,
      tps: t1,
      tvq: t2,
      montant_ttc: roundCents(ht + t1 + t2)
    }
  };
}

/**
 * Refuse un déplacement dont l'année n'a pas de taux.
 *
 * Sans ce contrôle, la saisie produirait un montant nul, silencieusement : un
 * acteur inscrirait ses trajets pendant des semaines avant de s'apercevoir que
 * sa déduction est à zéro.
 */
async function exigerTaux(db, depense) {
  if (depense.kilometres === null) return;

  const annee = anneeDe(depense.date_depense);
  if (!await tauxDeLAnnee(db, annee)) {
    throw Object.assign(
      new Error(`Aucun taux kilométrique n'est réglé pour ${annee}. `
        + 'Renseignez-le dans Paramètres avant d\'inscrire un déplacement.'),
      { status: 400 }
    );
  }
}

async function getExpenses(db) {
  return db.all('SELECT * FROM depenses ORDER BY date_depense DESC, id DESC');
}

/** Véhicules déjà employés, pour épargner la ressaisie à chaque trajet. */
async function getVehicules(db) {
  const lignes = await db.all(
    `SELECT DISTINCT vehicule FROM depenses
     WHERE vehicule IS NOT NULL AND vehicule != ''
     ORDER BY vehicule ASC`
  );
  return lignes.map((l) => l.vehicule);
}

async function createExpense(db, body) {
  const { error, depense } = validateExpense(body);
  if (error) throw Object.assign(new Error(error), { status: 400 });

  return withTransaction(db, async () => {
    await exigerTaux(db, depense);

    const result = await db.run(
      `INSERT INTO depenses (fournisseur, description, date_depense, montant_ht, tps, tvq,
                             montant_ttc, categorie, kilometres, vehicule)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [depense.fournisseur, depense.description, depense.date_depense, depense.montant_ht,
        depense.tps, depense.tvq, depense.montant_ttc, depense.categorie,
        depense.kilometres, depense.vehicule]
    );

    if (depense.kilometres !== null) await recalculerAnnees(db, depense.date_depense);
    return db.get('SELECT * FROM depenses WHERE id = ?', [result.lastID]);
  });
}

async function updateExpense(db, id, body) {
  const { error, depense } = validateExpense(body);
  if (error) throw Object.assign(new Error(error), { status: 400 });

  return withTransaction(db, async () => {
    const existant = await db.get('SELECT id, date_depense, kilometres FROM depenses WHERE id = ?', [id]);
    if (!existant) throw Object.assign(new Error('Dépense introuvable.'), { status: 404 });

    await exigerTaux(db, depense);

    await db.run(
      `UPDATE depenses SET fournisseur = ?, description = ?, date_depense = ?, montant_ht = ?,
                           tps = ?, tvq = ?, montant_ttc = ?, categorie = ?,
                           kilometres = ?, vehicule = ?
       WHERE id = ?`,
      [depense.fournisseur, depense.description, depense.date_depense, depense.montant_ht,
        depense.tps, depense.tvq, depense.montant_ttc, depense.categorie,
        depense.kilometres, depense.vehicule, id]
    );

    // Les deux années sont réajustées : celle que le trajet quitte perd ses
    // kilomètres, celle qu'il rejoint les gagne, et le seuil peut basculer des
    // deux côtés. Ne recalculer que la nouvelle laisserait l'ancienne fausse.
    if (depense.kilometres !== null || existant.kilometres !== null) {
      await recalculerAnnees(db, existant.date_depense, depense.date_depense);
    }

    return db.get('SELECT * FROM depenses WHERE id = ?', [id]);
  });
}

async function deleteExpense(db, id) {
  return withTransaction(db, async () => {
    const existant = await db.get('SELECT id, date_depense, kilometres FROM depenses WHERE id = ?', [id]);
    if (!existant) throw Object.assign(new Error('Dépense introuvable.'), { status: 404 });

    await db.run('DELETE FROM depenses WHERE id = ?', [id]);

    // Retirer un trajet libère des kilomètres sous le seuil : les trajets
    // suivants de l'année peuvent basculer au taux supérieur.
    if (existant.kilometres !== null) await recalculerAnnees(db, existant.date_depense);

    return { message: 'Dépense supprimée.' };
  });
}

module.exports = {
  getExpenses, getVehicules, createExpense, updateExpense, deleteExpense
};
