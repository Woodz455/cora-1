/**
 * Service gérant les devis (soumissions) et leur conversion en facture.
 */

const { createFacture, getTaxRatesForProvince } = require('./invoiceService.js');
const { sqlTotals } = require('./money.js');
const { withTransaction } = require('./dbUtils.js');
const { nextDocumentNumber } = require('./sequences.js');

/** Statuts possibles d'un devis. */
const STATUTS = {
  EN_ATTENTE: 'En attente',
  REFUSE: 'Refusé',
  CONVERTI: 'Converti'
};

/** Nombre de jours accordés au paiement d'une facture issue d'un devis. */
const DELAI_PAIEMENT_JOURS = 30;

const T = sqlTotals('tl.sous_total', 'd');

const CTE_LIGNES = `
  WITH total_lignes AS (
    SELECT devis_id, SUM(quantite * prix_unitaire) AS sous_total
    FROM lignes_devis
    GROUP BY devis_id
  )
`;

/**
 * Liste des devis avec leurs totaux.
 *
 * Les montants sont calculés par la base en une seule requête : la version
 * précédente rechargeait les lignes devis par devis (N+1 requêtes) pour un
 * résultat identique.
 */
async function getDevis(db) {
  return db.all(`
    ${CTE_LIGNES}
    SELECT
      d.id,
      d.numero_devis,
      d.client_id,
      c.nom_entreprise AS client,
      d.date_emission,
      d.date_validite,
      d.statut,
      d.facture_id,
      d.devise,
      d.taux_change,
      d.taux_taxe_1,
      d.taux_taxe_2,
      d.taxe_1_nom,
      d.taxe_2_nom,
      ${T.sousTotal} AS sous_total,
      ${T.taxe1} AS montant_taxe_1,
      ${T.taxe2} AS montant_taxe_2,
      ${T.montantTotal} AS montant_total
    FROM devis d
    JOIN clients c ON d.client_id = c.id
    LEFT JOIN total_lignes tl ON tl.devis_id = d.id
    ORDER BY d.date_emission DESC, d.id DESC
  `);
}

/** Détails complets d'un devis, pour l'impression et le courriel. */
async function getDevisDetails(db, devisId) {
  const devis = await db.get(`
    ${CTE_LIGNES}
    SELECT
      d.*,
      ${T.sousTotal} AS sous_total,
      ${T.taxe1} AS montant_taxe_1,
      ${T.taxe2} AS montant_taxe_2,
      ${T.montantTotal} AS montant_total
    FROM devis d
    LEFT JOIN total_lignes tl ON tl.devis_id = d.id
    WHERE d.id = ?
  `, [devisId]);

  if (!devis) return null;

  const [client, lignes, settings] = await Promise.all([
    db.get('SELECT * FROM clients WHERE id = ?', [devis.client_id]),
    db.all('SELECT * FROM lignes_devis WHERE devis_id = ? ORDER BY id ASC', [devisId]),
    db.get('SELECT * FROM settings LIMIT 1')
  ]);

  return {
    ...devis,
    client_details: client,
    lignes,
    settings,
    // Un devis n'enregistre pas de paiement : le solde vaut le total.
    montant_paye: 0,
    solde_restant: devis.montant_total
  };
}

/** Source de numérotation des devis (voir sequences.js). */
const SOURCE_NUMERO = { table: 'devis', column: 'numero_devis' };

/**
 * Génère le prochain numéro de devis au format DEV-AAAAMM-NNNN.
 * À appeler à l'intérieur d'une transaction.
 */
async function generateDevisNumber(db, dateStr) {
  return nextDocumentNumber(db, 'DEV', dateStr, SOURCE_NUMERO);
}

async function insertLignes(db, devisId, lignes) {
  for (const ligne of lignes) {
    await db.run(
      'INSERT INTO lignes_devis (devis_id, description, quantite, prix_unitaire) VALUES (?, ?, ?, ?)',
      [devisId, ligne.description, ligne.quantite, ligne.prix_unitaire]
    );
  }
}

/**
 * Crée un devis.
 *
 * Les taux de taxe proviennent de la province du client, exactement comme pour
 * une facture. Les devis s'appuyaient auparavant sur les taux globaux des
 * paramètres : un devis pour un client ontarien portait la TPS et la TVQ
 * québécoises, puis la facture issue de ce devis affichait la TVH — le montant
 * accepté par le client ne correspondait pas à celui facturé.
 */
async function createDevis(db, devisData, lignes) {
  const { client_id, date_emission, date_validite, devise = 'CAD', taux_change = 1.0 } = devisData;

  return withTransaction(db, async () => {
    const client = await db.get('SELECT id, province FROM clients WHERE id = ?', [client_id]);
    if (!client) {
      throw Object.assign(new Error('Client introuvable.'), { status: 400 });
    }

    const taxes = getTaxRatesForProvince(client.province);
    const numero_devis = await generateDevisNumber(db, date_emission);

    const result = await db.run(
      `INSERT INTO devis (numero_devis, client_id, date_emission, date_validite, statut,
                          taux_taxe_1, taux_taxe_2, taxe_1_nom, taxe_2_nom, devise, taux_change)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [numero_devis, client_id, date_emission, date_validite, STATUTS.EN_ATTENTE,
        taxes.taxe_1_taux, taxes.taxe_2_taux, taxes.taxe_1_nom, taxes.taxe_2_nom, devise, taux_change]
    );
    const devisId = result.lastID;

    await insertLignes(db, devisId, lignes);
    return { id: devisId, numero_devis };
  });
}

/** Modifie un devis en attente, en réalignant ses taxes sur le client retenu. */
async function updateDevis(db, devisId, devisData, lignes) {
  const { client_id, date_validite, devise = 'CAD', taux_change = 1.0 } = devisData;

  return withTransaction(db, async () => {
    const devis = await db.get('SELECT id, statut FROM devis WHERE id = ?', [devisId]);
    if (!devis) {
      throw Object.assign(new Error('Devis non trouvé.'), { status: 404 });
    }
    if (devis.statut !== STATUTS.EN_ATTENTE) {
      throw Object.assign(new Error('Seul un devis en attente peut être modifié.'), { status: 400 });
    }

    const client = await db.get('SELECT id, province FROM clients WHERE id = ?', [client_id]);
    if (!client) {
      throw Object.assign(new Error('Client introuvable.'), { status: 400 });
    }
    const taxes = getTaxRatesForProvince(client.province);

    await db.run(
      `UPDATE devis SET client_id = ?, date_validite = ?, devise = ?, taux_change = ?,
                        taux_taxe_1 = ?, taux_taxe_2 = ?, taxe_1_nom = ?, taxe_2_nom = ?
       WHERE id = ?`,
      [client_id, date_validite, devise, taux_change,
        taxes.taxe_1_taux, taxes.taxe_2_taux, taxes.taxe_1_nom, taxes.taxe_2_nom, devisId]
    );
    await db.run('DELETE FROM lignes_devis WHERE devis_id = ?', [devisId]);
    await insertLignes(db, devisId, lignes);

    return { message: 'Devis mis à jour.' };
  });
}

/** Marque un devis comme refusé. */
async function cancelDevis(db, devisId) {
  const devis = await db.get('SELECT id, statut FROM devis WHERE id = ?', [devisId]);
  if (!devis) {
    throw Object.assign(new Error('Devis non trouvé.'), { status: 404 });
  }
  if (devis.statut === STATUTS.CONVERTI) {
    throw Object.assign(new Error('Un devis converti en facture ne peut pas être refusé.'), { status: 400 });
  }
  if (devis.statut === STATUTS.REFUSE) {
    throw Object.assign(new Error('Ce devis est déjà refusé.'), { status: 400 });
  }

  await db.run('UPDATE devis SET statut = ? WHERE id = ?', [STATUTS.REFUSE, devisId]);
  return { message: 'Devis refusé.' };
}

/**
 * Convertit un devis en facture.
 *
 * La création de la facture et la mise à jour du devis partagent une seule
 * transaction. Auparavant la facture était validée par sa propre transaction
 * avant que le lien vers le devis n'échoue : chaque tentative de conversion
 * laissait une facture orpheline en base, et le devis restait « En attente ».
 *
 * @returns {Promise<Object>} la facture créée
 */
async function convertDevisToFacture(db, devisId) {
  return withTransaction(db, async () => {
    const devis = await db.get('SELECT * FROM devis WHERE id = ?', [devisId]);
    if (!devis) {
      throw Object.assign(new Error('Devis non trouvé.'), { status: 404 });
    }
    if (devis.statut === STATUTS.CONVERTI) {
      throw Object.assign(new Error('Ce devis a déjà été converti en facture.'), { status: 400 });
    }
    if (devis.statut !== STATUTS.EN_ATTENTE) {
      throw Object.assign(
        new Error(`Un devis « ${devis.statut} » ne peut pas être converti en facture.`),
        { status: 400 }
      );
    }

    const lignes = await db.all(
      'SELECT description, quantite, prix_unitaire FROM lignes_devis WHERE devis_id = ? ORDER BY id ASC',
      [devisId]
    );
    if (lignes.length === 0) {
      throw Object.assign(new Error('Un devis sans ligne ne peut pas être converti.'), { status: 400 });
    }

    const dateEmission = new Date();
    const dateEcheance = new Date(dateEmission);
    dateEcheance.setDate(dateEcheance.getDate() + DELAI_PAIEMENT_JOURS);
    const iso = (d) => d.toISOString().split('T')[0];

    const facture = await createFacture(db, {
      client_id: devis.client_id,
      date_emission: iso(dateEmission),
      date_echeance: iso(dateEcheance),
      devise: devis.devise || 'CAD',
      taux_change: devis.taux_change || 1.0
    }, lignes);

    await db.run(
      'UPDATE devis SET statut = ?, facture_id = ? WHERE id = ?',
      [STATUTS.CONVERTI, facture.id, devisId]
    );

    return facture;
  });
}

module.exports = {
  getDevis,
  getDevisDetails,
  createDevis,
  updateDevis,
  cancelDevis,
  convertDevisToFacture,
  STATUTS
};
