/**
 * Service gérant les factures, les paiements et les calculs financiers.
 */

const { roundCents, computeTotals, formatMontant } = require('./money.js');
const { withTransaction } = require('./dbUtils.js');
const { nextDocumentNumber } = require('./sequences.js');

/** Statuts possibles d'une facture. */
const STATUTS = {
  EN_ATTENTE: 'En attente',
  PARTIELLE: 'Partiellement payée',
  PAYEE: 'Payée',
  ANNULEE: 'Annulée',
  // Intégralement neutralisée par une ou plusieurs notes de crédit, sans
  // qu'aucun encaissement n'ait eu lieu : la distinguer de « Payée » évite de
  // faire croire à une rentrée d'argent qui n'a pas eu lieu.
  CREDITEE: 'Créditée'
};

/** Tolérance d'un demi-cent, pour absorber les résidus de calcul flottant. */
const EPSILON = 0.005;

/**
 * Taux de taxe applicables selon la province de facturation du client.
 * Taux en vigueur en 2026.
 */
function getTaxRatesForProvince(province) {
  const p = (province || '').toUpperCase();
  switch (p) {
    case 'QC': return { taxe_1_nom: 'TPS', taxe_1_taux: 0.05, taxe_2_nom: 'TVQ', taxe_2_taux: 0.09975 };
    case 'ON': return { taxe_1_nom: 'TVH', taxe_1_taux: 0.13, taxe_2_nom: '', taxe_2_taux: 0 };
    case 'BC': return { taxe_1_nom: 'TPS', taxe_1_taux: 0.05, taxe_2_nom: 'TVP', taxe_2_taux: 0.07 };
    case 'MB': return { taxe_1_nom: 'TPS', taxe_1_taux: 0.05, taxe_2_nom: 'TVP', taxe_2_taux: 0.07 };
    case 'SK': return { taxe_1_nom: 'TPS', taxe_1_taux: 0.05, taxe_2_nom: 'TVP', taxe_2_taux: 0.06 };
    case 'NB':
    case 'NL':
    case 'NS':
    case 'PE': return { taxe_1_nom: 'TVH', taxe_1_taux: 0.15, taxe_2_nom: '', taxe_2_taux: 0 };
    case 'AB':
    case 'NT':
    case 'NU':
    case 'YT': return { taxe_1_nom: 'TPS', taxe_1_taux: 0.05, taxe_2_nom: '', taxe_2_taux: 0 };
    default: return { taxe_1_nom: '', taxe_1_taux: 0, taxe_2_nom: '', taxe_2_taux: 0 };
  }
}

/**
 * Expressions SQL partagées.
 *
 * Les montants d'une facture sont lus tels qu'ils ont été arrêtés à l'émission,
 * et non recalculés depuis les lignes : une pièce comptable remise à un client
 * ne doit jamais changer de montant, quelles que soient les évolutions
 * ultérieures des taux de taxe ou de la règle d'arrondi. Seuls les paiements,
 * qui s'ajoutent dans le temps, restent agrégés à la lecture.
 */
const SOUS_TOTAL = 'COALESCE(f.sous_total, 0)';
const TAXE_1 = 'COALESCE(f.montant_taxe_1, 0)';
const TAXE_2 = 'COALESCE(f.montant_taxe_2, 0)';
const TOTAL = 'COALESCE(f.montant_total, 0)';
const PAYE = 'ROUND(COALESCE(tp.total_paye, 0), 2)';
const CREDITE = 'ROUND(COALESCE(tc.total_credite, 0), 2)';
/** Montant réellement dû par le client, une fois les notes de crédit déduites. */
const NET = `ROUND(${TOTAL} - ${CREDITE}, 2)`;
const SOLDE = `ROUND(${NET} - ${PAYE}, 2)`;
/** Trop-perçu à restituer, lorsqu'un crédit intervient après encaissement. */
const A_REMBOURSER = `ROUND(MAX(0, ${PAYE} - ${NET}), 2)`;
const TAUX = 'COALESCE(f.taux_change, 1.0)';

/**
 * Un paiement annulé reste en base pour l'historique, mais ne compte plus dans
 * aucun solde : ce filtre doit accompagner toute lecture de la table.
 */
const PAIEMENT_ACTIF = 'annule_le IS NULL';

const CTE_TOTAUX = `
  WITH total_paiements AS (
    SELECT facture_id, SUM(montant) AS total_paye
    FROM paiements
    WHERE ${PAIEMENT_ACTIF}
    GROUP BY facture_id
  ),
  total_credits AS (
    SELECT facture_id, SUM(montant_total) AS total_credite
    FROM notes_credit
    GROUP BY facture_id
  )
`;

/** Jointures que toute requête utilisant COLONNES_FINANCIERES doit inclure. */
const JOINTURES_FINANCIERES = `
  LEFT JOIN total_paiements tp ON tp.facture_id = f.id
  LEFT JOIN total_credits tc ON tc.facture_id = f.id
`;

/** Colonnes financières communes aux listes et aux détails de facture. */
const COLONNES_FINANCIERES = `
  ${SOUS_TOTAL} AS sous_total,
  ${TAXE_1} AS montant_taxe_1,
  ${TAXE_2} AS montant_taxe_2,
  ${TOTAL} AS montant_total,
  ${CREDITE} AS montant_credite,
  ${NET} AS montant_net,
  ${PAYE} AS montant_paye,
  ${SOLDE} AS solde_restant,
  ${A_REMBOURSER} AS montant_a_rembourser,
  ROUND(${NET} * ${TAUX}, 2) AS montant_total_cad,
  ROUND(${PAYE} * ${TAUX}, 2) AS montant_paye_cad,
  ROUND(${SOLDE} * ${TAUX}, 2) AS solde_restant_cad
`;

/**
 * Récupère toutes les factures avec leur total, le montant payé et le solde.
 *
 * L'agrégation des paiements passe par une CTE plutôt que par une jointure
 * directe : sans cela, une facture réglée en plusieurs versements verrait ses
 * lignes multipliées.
 *
 * @param {import('sqlite').Database} db
 * @returns {Promise<Array>}
 */
async function getFacturesAvecSoldes(db) {
  return db.all(`
    ${CTE_TOTAUX}
    SELECT
      f.id,
      f.numero_facture,
      c.nom_entreprise AS client,
      f.client_id,
      f.date_emission,
      f.date_echeance,
      f.statut,
      f.relances_envoyees,
      f.date_derniere_relance,
      f.devise,
      f.taux_change,
      f.taux_taxe_1,
      f.taux_taxe_2,
      f.taxe_1_nom,
      f.taxe_2_nom,
      ${COLONNES_FINANCIERES}
    FROM factures f
    JOIN clients c ON f.client_id = c.id
    ${JOINTURES_FINANCIERES}
    ORDER BY f.date_emission DESC, f.id DESC
  `);
}

/**
 * Détail financier d'une facture (sous-total, taxes, payé, solde).
 *
 * @param {import('sqlite').Database} db
 * @param {number} factureId
 * @returns {Promise<Object|undefined>}
 */
async function getSoldeFacture(db, factureId) {
  return db.get(`
    ${CTE_TOTAUX}
    SELECT
      f.id,
      f.numero_facture,
      f.statut,
      f.devise,
      f.taux_change,
      f.taux_taxe_1,
      f.taux_taxe_2,
      f.taxe_1_nom,
      f.taxe_2_nom,
      ${COLONNES_FINANCIERES}
    FROM factures f
    ${JOINTURES_FINANCIERES}
    WHERE f.id = ?
  `, [factureId]);
}

/**
 * Statut qu'une facture devrait porter au vu de ses montants.
 *
 * Une facture annulée le reste. Sinon le statut découle uniquement du solde :
 * l'ancienne implémentation attendait un statut « Envoyée » que le code ne
 * produisait jamais, si bien qu'un acompte ne faisait jamais passer la facture
 * en « Partiellement payée » — et son encaissement disparaissait du chiffre
 * d'affaires du tableau de bord.
 *
 * @param {string} statutActuel
 * @param {number} soldeRestant
 * @param {number} montantPaye
 * @param {number} [montantCredite] cumul des notes de crédit
 * @param {number} [montantTotal] montant facturé à l'origine
 * @returns {string}
 */
function resolveStatut(statutActuel, soldeRestant, montantPaye, montantCredite = 0, montantTotal = 0) {
  if (statutActuel === STATUTS.ANNULEE) return STATUTS.ANNULEE;

  // Une facture entièrement créditée et jamais encaissée n'est pas « Payée » :
  // aucun argent n'est entré, elle a simplement été annulée par une note.
  if (montantCredite > EPSILON && montantCredite >= montantTotal - EPSILON && montantPaye <= EPSILON) {
    return STATUTS.CREDITEE;
  }

  if (soldeRestant <= EPSILON) return STATUTS.PAYEE;
  if (montantPaye > EPSILON) return STATUTS.PARTIELLE;
  return STATUTS.EN_ATTENTE;
}

/** Recalcule et enregistre le statut d'une facture d'après ses montants. */
async function syncStatut(db, factureId) {
  const info = await getSoldeFacture(db, factureId);
  if (!info) return null;

  const attendu = resolveStatut(
    info.statut, info.solde_restant, info.montant_paye, info.montant_credite, info.montant_total
  );
  if (attendu !== info.statut) {
    await db.run('UPDATE factures SET statut = ? WHERE id = ?', [attendu, factureId]);
    info.statut = attendu;
  }
  return info;
}

/**
 * Enregistre un paiement et met le statut de la facture à jour.
 *
 * Le montant est plafonné au solde restant : encaisser plus que dû produisait
 * un solde négatif qui se propageait ensuite dans tous les rapports.
 *
 * @param {import('sqlite').Database} db
 * @param {number} factureId
 * @param {number} montant montant dans la devise de la facture
 * @param {string} note
 * @param {string} datePaiement format YYYY-MM-DD
 * @param {number} [transactionId] transaction bancaire d'origine, le cas échéant
 * @returns {Promise<Object>} facture mise à jour
 */
async function addPaiement(db, factureId, montant, note = '', datePaiement = null, transactionId = null) {
  const date = datePaiement || new Date().toISOString().split('T')[0];
  const valeur = roundCents(montant);

  if (!(valeur > 0)) {
    throw Object.assign(new Error('Le montant du paiement doit être strictement positif.'), { status: 400 });
  }

  return withTransaction(db, async () => {
    const facture = await getSoldeFacture(db, factureId);
    if (!facture) {
      throw Object.assign(new Error('Facture non trouvée.'), { status: 404 });
    }
    if (facture.statut === STATUTS.ANNULEE) {
      throw Object.assign(new Error('Une facture annulée ne peut pas recevoir de paiement.'), { status: 400 });
    }
    if (facture.solde_restant <= EPSILON) {
      throw Object.assign(new Error('Cette facture est déjà soldée.'), { status: 400 });
    }
    if (valeur > facture.solde_restant + EPSILON) {
      throw Object.assign(
        new Error(`Le paiement (${formatMontant(valeur, facture.devise)}) dépasse le solde restant`
          + ` (${formatMontant(facture.solde_restant, facture.devise)}).`),
        { status: 400 }
      );
    }

    await db.run(
      'INSERT INTO paiements (facture_id, date_paiement, montant, note, transaction_id) VALUES (?, ?, ?, ?, ?)',
      [factureId, date, valeur, note, transactionId]
    );

    return syncStatut(db, factureId);
  });
}

/**
 * Annule un encaissement saisi à tort.
 *
 * La ligne n'est pas effacée : elle est marquée annulée, avec son motif et son
 * auteur. Un mouvement d'argent qui disparaîtrait sans laisser de trace serait
 * injustifiable lors d'une vérification — et c'est précisément l'absence de
 * toute correction possible qui laissait une facture de 113 $ porter 3 000 $
 * d'encaissements, sans recours.
 *
 * @param {import('sqlite').Database} db
 * @param {number} paiementId
 * @param {{motif?: string, utilisateur?: string}} [contexte]
 * @returns {Promise<Object>} facture mise à jour
 */
async function annulerPaiement(db, paiementId, { motif = '', utilisateur = '' } = {}) {
  return withTransaction(db, async () => {
    const paiement = await db.get('SELECT * FROM paiements WHERE id = ?', [paiementId]);
    if (!paiement) {
      throw Object.assign(new Error('Paiement non trouvé.'), { status: 404 });
    }
    if (paiement.annule_le) {
      throw Object.assign(new Error('Ce paiement est déjà annulé.'), { status: 400 });
    }

    await db.run(
      'UPDATE paiements SET annule_le = ?, annule_par = ?, motif_annulation = ? WHERE id = ?',
      [new Date().toISOString().split('T')[0], utilisateur || null, motif || null, paiementId]
    );

    // Un paiement issu du rapprochement bancaire laisserait sinon sa transaction
    // marquée « Rapproché » sur une facture qu'elle ne règle plus. On la remet
    // dans la file, où elle pourra être affectée correctement.
    const transaction = await trouverTransactionLiee(db, paiement);
    if (transaction) {
      await db.run(
        "UPDATE transactions_bancaires SET statut = 'En attente', facture_id = NULL WHERE id = ?",
        [transaction.id]
      );
    }

    return syncStatut(db, paiement.facture_id);
  });
}

/**
 * Retrouve la transaction bancaire d'où provient un paiement.
 *
 * Les paiements créés depuis l'ajout de `transaction_id` la désignent
 * directement. Les plus anciens ne portent que la note « Rapprochement
 * bancaire : … » : on retombe alors sur la transaction rapprochée de cette
 * facture pour ce montant.
 */
async function trouverTransactionLiee(db, paiement) {
  if (paiement.transaction_id) {
    return db.get('SELECT id FROM transactions_bancaires WHERE id = ?', [paiement.transaction_id]);
  }
  if (!/^Rapprochement bancaire/i.test(paiement.note || '')) return null;

  return db.get(
    `SELECT id FROM transactions_bancaires
     WHERE facture_id = ? AND statut = 'Rapproché' AND ABS(montant - ?) < 0.005
     ORDER BY id ASC LIMIT 1`,
    [paiement.facture_id, paiement.montant]
  );
}

/**
 * Statistiques consolidées pour la page Rapports.
 *
 * Tous les montants sont ramenés en CAD au taux figé sur chaque facture — y
 * compris les paiements, qui échappaient auparavant à la conversion et
 * produisaient un « encaissé » supérieur au « facturé » sur les factures en USD.
 *
 * @param {import('sqlite').Database} db
 * @returns {Promise<Object>}
 */
async function getReportStats(db) {
  const stats = await db.get(`
    ${CTE_TOTAUX}
    SELECT
      COALESCE(SUM(ROUND(${NET} * ${TAUX}, 2)), 0) AS revenu_total,
      COALESCE(SUM(ROUND(${CREDITE} * ${TAUX}, 2)), 0) AS total_credite,
      COALESCE(SUM(ROUND(${PAYE} * ${TAUX}, 2)), 0) AS total_encaisse,
      COALESCE(SUM(ROUND(${SOLDE} * ${TAUX}, 2)), 0) AS solde_a_percevoir
    FROM factures f
    ${JOINTURES_FINANCIERES}
    WHERE f.statut != '${STATUTS.ANNULEE}'
  `);

  const depenses = await db.get(`
    SELECT
      COALESCE(SUM(montant_ht), 0) AS total_depenses_ht,
      COALESCE(SUM(tps + tvq), 0) AS total_taxes_recuperables,
      COALESCE(SUM(montant_ht + tps + tvq), 0) AS total_depenses_ttc
    FROM depenses
  `);

  const statusDistribution = await db.all(`
    SELECT statut AS name, COUNT(*) AS value
    FROM factures
    GROUP BY statut
    ORDER BY value DESC
  `);

  const topClients = await db.all(`
    ${CTE_TOTAUX}
    SELECT
      c.nom_entreprise AS name,
      COALESCE(SUM(ROUND(${NET} * ${TAUX}, 2)), 0) AS revenu
    FROM factures f
    JOIN clients c ON f.client_id = c.id
    ${JOINTURES_FINANCIERES}
    WHERE f.statut != '${STATUTS.ANNULEE}'
    GROUP BY c.id
    HAVING revenu > 0
    ORDER BY revenu DESC
    LIMIT 5
  `);

  const lateInvoices = await db.all(`
    ${CTE_TOTAUX}
    SELECT
      f.id,
      f.numero_facture,
      c.nom_entreprise AS client,
      f.date_echeance,
      f.devise,
      f.taux_change,
      ROUND(${SOLDE} * ${TAUX}, 2) AS solde_restant
    FROM factures f
    JOIN clients c ON f.client_id = c.id
    ${JOINTURES_FINANCIERES}
    WHERE f.date_echeance < date('now')
      AND f.statut != '${STATUTS.ANNULEE}'
      AND ${SOLDE} > 0
    ORDER BY f.date_echeance ASC
  `);

  return {
    ...stats,
    // `total_depenses` reste le montant TTC pour compatibilité d'affichage ;
    // le bénéfice net doit s'appuyer sur le HT, les taxes étant récupérables.
    total_depenses: depenses.total_depenses_ttc,
    total_depenses_ht: depenses.total_depenses_ht,
    total_taxes_recuperables: depenses.total_taxes_recuperables,
    statusDistribution,
    topClients,
    lateInvoices
  };
}

/** Source de numérotation des factures (voir sequences.js). */
const SOURCE_NUMERO = { table: 'factures', column: 'numero_facture' };

/**
 * Génère le prochain numéro de facture au format SHT-AAAAMM-NNNN.
 * À appeler à l'intérieur d'une transaction.
 */
async function generateInvoiceNumber(db, dateStr) {
  return nextDocumentNumber(db, 'SHT', dateStr, SOURCE_NUMERO);
}

/**
 * Crée une facture et ses lignes.
 *
 * Les taux de taxe sont figés à la création d'après la province du client : une
 * facture émise reste cohérente même si le client déménage ou si les taux changent.
 *
 * @param {import('sqlite').Database} db
 * Appelable depuis une transaction existante : `withTransaction` est réentrant
 * et ouvre alors un point de sauvegarde plutôt qu'une nouvelle transaction.
 *
 * @param {Object} factureData
 * @param {Array} lignes
 * @returns {Promise<Object>} facture créée, avec ses montants
 */
async function createFacture(db, factureData, lignes) {
  const { client_id, date_emission, date_echeance, devise = 'CAD', taux_change = 1.0 } = factureData;

  return withTransaction(db, async () => {
    const client = await db.get('SELECT id, province FROM clients WHERE id = ?', [client_id]);
    if (!client) {
      throw Object.assign(new Error('Client introuvable.'), { status: 400 });
    }

    const taxes = getTaxRatesForProvince(client.province);
    const numero_facture = await generateInvoiceNumber(db, date_emission);

    // Les montants sont arrêtés ici, une fois pour toutes.
    const montants = computeTotals(lignes, taxes.taxe_1_taux, taxes.taxe_2_taux);

    const result = await db.run(
      `INSERT INTO factures (numero_facture, client_id, date_emission, date_echeance, statut,
                             taux_taxe_1, taux_taxe_2, taxe_1_nom, taxe_2_nom, devise, taux_change,
                             sous_total, montant_taxe_1, montant_taxe_2, montant_total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [numero_facture, client_id, date_emission, date_echeance, STATUTS.EN_ATTENTE,
        taxes.taxe_1_taux, taxes.taxe_2_taux, taxes.taxe_1_nom, taxes.taxe_2_nom, devise, taux_change,
        montants.sous_total, montants.taxe_1, montants.taxe_2, montants.montant_total]
    );
    const factureId = result.lastID;

    await insertLignes(db, factureId, lignes);
    return getSoldeFacture(db, factureId);
  });
}

/** Insère les lignes d'une facture. */
async function insertLignes(db, factureId, lignes) {
  for (const ligne of lignes) {
    await db.run(
      'INSERT INTO lignes_facture (facture_id, description, quantite, prix_unitaire) VALUES (?, ?, ?, ?)',
      [factureId, ligne.description, ligne.quantite, ligne.prix_unitaire]
    );
  }
}

/**
 * Détails complets d'une facture : client, lignes, paramètres d'entreprise.
 * Utilisé pour l'impression et l'envoi par courriel.
 */
async function getFactureDetails(db, factureId) {
  const factureInfo = await getSoldeFacture(db, factureId);
  if (!factureInfo) return null;

  const factureRow = await db.get('SELECT * FROM factures WHERE id = ?', [factureId]);
  const [client, lignes, settings] = await Promise.all([
    db.get('SELECT * FROM clients WHERE id = ?', [factureRow.client_id]),
    db.all('SELECT * FROM lignes_facture WHERE facture_id = ? ORDER BY id ASC', [factureId]),
    db.get('SELECT * FROM settings LIMIT 1')
  ]);
  // Les paiements annulés sont remontés eux aussi : l'écran doit montrer qu'un
  // encaissement a été retiré, et pourquoi. Ils portent `annule_le`.
  const paiements = await db.all(
    `SELECT id, date_paiement, montant, note, annule_le, annule_par, motif_annulation
     FROM paiements WHERE facture_id = ? ORDER BY date_paiement ASC, id ASC`,
    [factureId]
  );

  // Import tardif : noteCreditService dépend lui-même de ce module (il appelle
  // syncStatut). Le charger ici évite un cycle de require au démarrage.
  const { getNotesCreditPourFacture } = require('./noteCreditService.js');
  const notes_credit = await getNotesCreditPourFacture(db, factureId);

  return {
    ...factureInfo,
    notes_credit,
    date_emission: factureRow.date_emission,
    date_echeance: factureRow.date_echeance,
    client_details: client,
    lignes,
    paiements,
    settings
  };
}

/** Annule une facture. Seule une facture sans paiement encaissé peut l'être. */
async function cancelFacture(db, factureId) {
  const facture = await getSoldeFacture(db, factureId);
  if (!facture) {
    throw Object.assign(new Error('Facture non trouvée.'), { status: 404 });
  }
  if (facture.statut === STATUTS.ANNULEE) {
    throw Object.assign(new Error('Cette facture est déjà annulée.'), { status: 400 });
  }
  if (facture.montant_paye > EPSILON) {
    throw Object.assign(
      new Error('Une facture comportant un paiement ne peut pas être annulée. Émettez une note de crédit.'),
      { status: 400 }
    );
  }
  if (facture.montant_credite > EPSILON) {
    throw Object.assign(
      new Error('Cette facture porte déjà une note de crédit : elle ne peut plus être annulée.'),
      { status: 400 }
    );
  }

  await db.run('UPDATE factures SET statut = ? WHERE id = ?', [STATUTS.ANNULEE, factureId]);
  return { message: 'Facture annulée avec succès.' };
}

/** Modifie une facture. Interdit dès qu'un paiement a été encaissé. */
async function updateFacture(db, factureId, factureData, lignes) {
  const { client_id, date_echeance, devise = 'CAD', taux_change = 1.0 } = factureData;

  return withTransaction(db, async () => {
    const facture = await getSoldeFacture(db, factureId);
    if (!facture) {
      throw Object.assign(new Error('Facture non trouvée.'), { status: 404 });
    }
    if (facture.statut !== STATUTS.EN_ATTENTE) {
      throw Object.assign(
        new Error(`Seules les factures « ${STATUTS.EN_ATTENTE} » peuvent être modifiées.`),
        { status: 400 }
      );
    }
    if (facture.montant_paye > EPSILON) {
      throw Object.assign(new Error('Une facture comportant un paiement ne peut pas être modifiée.'), { status: 400 });
    }
    if (facture.montant_credite > EPSILON) {
      throw Object.assign(
        new Error('Cette facture porte une note de crédit : modifier ses montants rendrait ce crédit incohérent.'),
        { status: 400 }
      );
    }

    const client = await db.get('SELECT id, province FROM clients WHERE id = ?', [client_id]);
    if (!client) {
      throw Object.assign(new Error('Client introuvable.'), { status: 400 });
    }
    const taxes = getTaxRatesForProvince(client.province);

    // La facture n'a pas encore été encaissée : ses montants sont réarrêtés.
    const montants = computeTotals(lignes, taxes.taxe_1_taux, taxes.taxe_2_taux);

    await db.run(
      `UPDATE factures SET client_id = ?, date_echeance = ?, taux_taxe_1 = ?, taux_taxe_2 = ?,
                           taxe_1_nom = ?, taxe_2_nom = ?, devise = ?, taux_change = ?,
                           sous_total = ?, montant_taxe_1 = ?, montant_taxe_2 = ?, montant_total = ?
       WHERE id = ?`,
      [client_id, date_echeance, taxes.taxe_1_taux, taxes.taxe_2_taux,
        taxes.taxe_1_nom, taxes.taxe_2_nom, devise, taux_change,
        montants.sous_total, montants.taxe_1, montants.taxe_2, montants.montant_total, factureId]
    );
    await db.run('DELETE FROM lignes_facture WHERE facture_id = ?', [factureId]);
    await insertLignes(db, factureId, lignes);

    return getSoldeFacture(db, factureId);
  });
}

/**
 * Supprime définitivement une facture.
 *
 * Réservé à l'administration et interdit dès qu'un paiement est rattaché : une
 * pièce comptable encaissée doit être conservée (six ans au Canada), et sa
 * suppression emportait jusqu'ici les paiements en cascade, faussant
 * silencieusement tout l'historique d'encaissement.
 */
async function deleteFacture(db, factureId) {
  const facture = await getSoldeFacture(db, factureId);
  if (!facture) {
    throw Object.assign(new Error('Facture non trouvée.'), { status: 404 });
  }
  if (facture.montant_paye > EPSILON) {
    throw Object.assign(
      new Error('Cette facture comporte un paiement encaissé et ne peut pas être supprimée. Annulez-la ou émettez une note de crédit.'),
      { status: 400 }
    );
  }

  if (facture.montant_credite > EPSILON) {
    throw Object.assign(
      new Error('Cette facture porte une note de crédit, qui est elle-même une pièce comptable : elle ne peut pas être supprimée.'),
      { status: 400 }
    );
  }

  const lien = await db.get('SELECT id FROM devis WHERE facture_id = ?', [factureId]);
  if (lien) {
    throw Object.assign(
      new Error('Cette facture provient d\'un devis converti et ne peut pas être supprimée.'),
      { status: 400 }
    );
  }

  await db.run('DELETE FROM factures WHERE id = ?', [factureId]);
  return { message: 'Facture supprimée avec succès.' };
}

/**
 * Indicateurs du tableau de bord, calculés en SQL.
 *
 * Le chiffre d'affaires correspond à tout ce qui a été réellement encaissé,
 * quel que soit le statut de la facture : l'ancienne version filtrait sur les
 * statuts « Payée » et « Partiellement payée », et un acompte sur facture en
 * attente n'apparaissait donc nulle part.
 */
async function getDashboardStats(db) {
  const totaux = await db.get(`
    ${CTE_TOTAUX}
    SELECT
      COALESCE(SUM(ROUND(${PAYE} * ${TAUX}, 2)), 0) AS chiffreAffaires,
      COALESCE(SUM(CASE WHEN ${SOLDE} > 0 AND f.date_echeance >= date('now')
                        THEN ROUND(${SOLDE} * ${TAUX}, 2) ELSE 0 END), 0) AS facturesEnAttente,
      COALESCE(SUM(CASE WHEN ${SOLDE} > 0 AND f.date_echeance < date('now')
                        THEN ROUND(${SOLDE} * ${TAUX}, 2) ELSE 0 END), 0) AS facturesEnRetard
    FROM factures f
    ${JOINTURES_FINANCIERES}
    WHERE f.statut != '${STATUTS.ANNULEE}'
  `);

  // Revenus par mois d'encaissement (et non d'émission) : c'est la trésorerie
  // réellement entrée sur la période.
  const chartData = await db.all(`
    SELECT
      substr(p.date_paiement, 1, 7) AS name,
      COALESCE(SUM(ROUND(p.montant * COALESCE(f.taux_change, 1.0), 2)), 0) AS revenu
    FROM paiements p
    JOIN factures f ON f.id = p.facture_id
    WHERE f.statut != '${STATUTS.ANNULEE}'
      AND p.${PAIEMENT_ACTIF}
    GROUP BY name
    ORDER BY name ASC
  `);

  return { ...totaux, chartData };
}

/**
 * Rapport de taxes pour une déclaration ARC / Revenu Québec.
 *
 * Les taxes sont ventilées par régime (TPS, TVH, TVQ, TVP) et non additionnées
 * en un chiffre unique : une entreprise facturant au Québec et en Ontario doit
 * déclarer sa TPS, sa TVH et sa TVQ séparément.
 *
 * @param {import('sqlite').Database} db
 * @param {string} [annee] filtre AAAA
 * @param {string} [mois]  filtre MM
 */
async function getTaxReport(db, annee, mois) {
  let where = `WHERE f.statut != '${STATUTS.ANNULEE}'`;
  const params = [];
  if (annee) {
    where += " AND strftime('%Y', f.date_emission) = ?";
    params.push(String(annee));
  }
  if (mois) {
    where += " AND strftime('%m', f.date_emission) = ?";
    params.push(String(mois).padStart(2, '0'));
  }

  // Les notes de crédit annulent de la taxe déjà déclarée : elles entrent dans
  // le rapport en négatif, sur la période de leur propre émission. Sans cela,
  // l'entreprise remettrait à l'État une taxe qu'elle a remboursée au client.
  const NOTE_TAUX = 'COALESCE(n.taux_change, 1.0)';
  let whereNotes = 'WHERE 1 = 1';
  const paramsNotes = [];
  if (annee) {
    whereNotes += " AND strftime('%Y', n.date_emission) = ?";
    paramsNotes.push(String(annee));
  }
  if (mois) {
    whereNotes += " AND strftime('%m', n.date_emission) = ?";
    paramsNotes.push(String(mois).padStart(2, '0'));
  }

  const summary = await db.get(`
    SELECT
      COALESCE((SELECT SUM(ROUND(${SOUS_TOTAL} * ${TAUX}, 2)) FROM factures f ${where}), 0)
        - COALESCE((SELECT SUM(ROUND(COALESCE(n.sous_total, 0) * ${NOTE_TAUX}, 2)) FROM notes_credit n ${whereNotes}), 0)
        AS total_revenus_taxables,
      COALESCE((SELECT SUM(ROUND(${TAXE_1} * ${TAUX}, 2)) FROM factures f ${where}), 0)
        - COALESCE((SELECT SUM(ROUND(COALESCE(n.montant_taxe_1, 0) * ${NOTE_TAUX}, 2)) FROM notes_credit n ${whereNotes}), 0)
        AS total_taxe_1,
      COALESCE((SELECT SUM(ROUND(${TAXE_2} * ${TAUX}, 2)) FROM factures f ${where}), 0)
        - COALESCE((SELECT SUM(ROUND(COALESCE(n.montant_taxe_2, 0) * ${NOTE_TAUX}, 2)) FROM notes_credit n ${whereNotes}), 0)
        AS total_taxe_2
  `, [...params, ...paramsNotes, ...params, ...paramsNotes, ...params, ...paramsNotes]);

  // Une même taxe peut occuper le premier ou le second emplacement selon la
  // province : on réunit les deux colonnes avant de regrouper par nom de taxe.
  const parRegime = await db.all(`
    SELECT nom, ROUND(SUM(montant), 2) AS montant FROM (
      SELECT f.taxe_1_nom AS nom, ROUND(${TAXE_1} * ${TAUX}, 2) AS montant
      FROM factures f
      ${where}
      UNION ALL
      SELECT f.taxe_2_nom AS nom, ROUND(${TAXE_2} * ${TAUX}, 2) AS montant
      FROM factures f
      ${where}
      UNION ALL
      SELECT n.taxe_1_nom AS nom, -ROUND(COALESCE(n.montant_taxe_1, 0) * ${NOTE_TAUX}, 2) AS montant
      FROM notes_credit n
      ${whereNotes}
      UNION ALL
      SELECT n.taxe_2_nom AS nom, -ROUND(COALESCE(n.montant_taxe_2, 0) * ${NOTE_TAUX}, 2) AS montant
      FROM notes_credit n
      ${whereNotes}
    )
    WHERE nom IS NOT NULL AND nom != ''
    GROUP BY nom
    HAVING SUM(montant) != 0
    ORDER BY nom ASC
  `, [...params, ...params, ...paramsNotes, ...paramsNotes]);

  let depensesWhere = 'WHERE 1 = 1';
  const depensesParams = [];
  if (annee) {
    depensesWhere += " AND strftime('%Y', date_depense) = ?";
    depensesParams.push(String(annee));
  }
  if (mois) {
    depensesWhere += " AND strftime('%m', date_depense) = ?";
    depensesParams.push(String(mois).padStart(2, '0'));
  }

  const depenses = await db.get(`
    SELECT
      COALESCE(SUM(montant_ht), 0) AS total_depenses_ht,
      COALESCE(SUM(tps), 0) AS total_tps_payee,
      COALESCE(SUM(tvq), 0) AS total_tvq_payee
    FROM depenses
    ${depensesWhere}
  `, depensesParams);

  const taxesFacturees = roundCents(summary.total_taxe_1 + summary.total_taxe_2);
  const taxesPayees = roundCents(depenses.total_tps_payee + depenses.total_tvq_payee);

  return {
    summary,
    parRegime,
    depenses,
    taxes_facturees: taxesFacturees,
    taxes_payees: taxesPayees,
    taxes_nettes: roundCents(taxesFacturees - taxesPayees)
  };
}

module.exports = {
  getFacturesAvecSoldes,
  getSoldeFacture,
  getFactureDetails,
  addPaiement,
  annulerPaiement,
  createFacture,
  updateFacture,
  cancelFacture,
  deleteFacture,
  getReportStats,
  getDashboardStats,
  getTaxReport,
  getTaxRatesForProvince,
  resolveStatut,
  syncStatut,
  computeTotals,
  STATUTS
};
