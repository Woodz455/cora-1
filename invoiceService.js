/**
 * Service gérant les opérations liées aux factures et au calcul financier.
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
 * Récupère toutes les factures avec leur total, le montant payé et le solde restant.
 * L'utilisation des requêtes "WITH" (Common Table Expressions - CTE) permet 
 * d'éviter les produits cartésiens (lignes multipliées) si une facture a 
 * plusieurs lignes ET plusieurs paiements.
 * 
 * @param {import('sqlite').Database} db Instance de la base de données
 * @returns {Promise<Array>} Liste des factures enrichies
 */
async function getFacturesAvecSoldes(db) {
  const query = `
    WITH total_lignes AS (
      SELECT facture_id, SUM(quantite * prix_unitaire) as sous_total
      FROM lignes_facture
      GROUP BY facture_id
    ),
    total_paiements AS (
      SELECT facture_id, SUM(montant) as total_paye
      FROM paiements
      GROUP BY facture_id
    )
    SELECT 
      f.id,
      f.numero_facture,
      c.nom_entreprise as client,
      f.date_emission,
      f.date_echeance,
      f.statut,
      f.relances_envoyees,
      f.date_derniere_relance,
      f.devise,
      f.taux_change,
      (COALESCE(tl.sous_total, 0) * (1 + COALESCE(f.taux_taxe_1, 0) + COALESCE(f.taux_taxe_2, 0))) as montant_total,
      COALESCE(tp.total_paye, 0) as montant_paye,
      ((COALESCE(tl.sous_total, 0) * (1 + COALESCE(f.taux_taxe_1, 0) + COALESCE(f.taux_taxe_2, 0))) - COALESCE(tp.total_paye, 0)) as solde_restant,
      (COALESCE(tl.sous_total, 0) * (1 + COALESCE(f.taux_taxe_1, 0) + COALESCE(f.taux_taxe_2, 0))) * COALESCE(f.taux_change, 1.0) as montant_total_cad,
      COALESCE(tp.total_paye, 0) * COALESCE(f.taux_change, 1.0) as montant_paye_cad,
      ((COALESCE(tl.sous_total, 0) * (1 + COALESCE(f.taux_taxe_1, 0) + COALESCE(f.taux_taxe_2, 0))) - COALESCE(tp.total_paye, 0)) * COALESCE(f.taux_change, 1.0) as solde_restant_cad
    FROM factures f
    JOIN clients c ON f.client_id = c.id
    LEFT JOIN total_lignes tl ON tl.facture_id = f.id
    LEFT JOIN total_paiements tp ON tp.facture_id = f.id
    ORDER BY f.date_emission DESC
  `;

  return await db.all(query);
}

/**
 * Récupère le détail financier d'une facture spécifique (calcul du solde).
 * 
 * @param {import('sqlite').Database} db Instance de la base de données
 * @param {number} factureId L'identifiant de la facture
 * @returns {Promise<Object>} Détails de la facture et de son solde
 */
async function getSoldeFacture(db, factureId) {
  const query = `
    WITH total_lignes AS (
      SELECT facture_id, SUM(quantite * prix_unitaire) as sous_total
      FROM lignes_facture
      WHERE facture_id = ?
      GROUP BY facture_id
    ),
    total_paiements AS (
      SELECT facture_id, SUM(montant) as total_paye
      FROM paiements
      WHERE facture_id = ?
      GROUP BY facture_id
    )
    SELECT 
      f.id,
      f.numero_facture,
      f.statut,
      f.devise,
      f.taux_change,
      COALESCE(tl.sous_total, 0) as sous_total,
      (COALESCE(tl.sous_total, 0) * (1 + COALESCE(f.taux_taxe_1, 0) + COALESCE(f.taux_taxe_2, 0))) as montant_total,
      COALESCE(tp.total_paye, 0) as montant_paye,
      ((COALESCE(tl.sous_total, 0) * (1 + COALESCE(f.taux_taxe_1, 0) + COALESCE(f.taux_taxe_2, 0))) - COALESCE(tp.total_paye, 0)) as solde_restant,
      (COALESCE(tl.sous_total, 0) * (1 + COALESCE(f.taux_taxe_1, 0) + COALESCE(f.taux_taxe_2, 0))) * COALESCE(f.taux_change, 1.0) as montant_total_cad,
      COALESCE(tp.total_paye, 0) * COALESCE(f.taux_change, 1.0) as montant_paye_cad,
      ((COALESCE(tl.sous_total, 0) * (1 + COALESCE(f.taux_taxe_1, 0) + COALESCE(f.taux_taxe_2, 0))) - COALESCE(tp.total_paye, 0)) * COALESCE(f.taux_change, 1.0) as solde_restant_cad
    FROM factures f
    LEFT JOIN total_lignes tl ON tl.facture_id = f.id
    LEFT JOIN total_paiements tp ON tp.facture_id = f.id
    WHERE f.id = ?
  `;

  // On passe 'factureId' trois fois car il est utilisé dans les 3 clauses WHERE
  return await db.get(query, [factureId, factureId, factureId]);
}

/**
 * Ajoute un paiement à une facture et met à jour son statut si elle est totalement payée.
 * 
 * @param {import('sqlite').Database} db Instance de la base de données
 * @param {number} factureId ID de la facture
 * @param {number} montant Montant du paiement
 * @param {string} note Note optionnelle
 * @param {string} datePaiement Date du paiement (YYYY-MM-DD)
 * @returns {Promise<Object>} Les détails mis à jour de la facture
 */
async function addPaiement(db, factureId, montant, note = '', datePaiement = new Date().toISOString().split('T')[0]) {
  // 1. Ajouter le paiement
  await db.run(
    'INSERT INTO paiements (facture_id, date_paiement, montant, note) VALUES (?, ?, ?, ?)',
    [factureId, datePaiement, montant, note]
  );

  // 2. Vérifier le nouveau solde
  const soldeInfo = await getSoldeFacture(db, factureId);
  
  // 3. Mettre à jour le statut si le solde est <= 0
  if (soldeInfo && soldeInfo.solde_restant <= 0 && soldeInfo.statut !== 'Payée') {
    await db.run('UPDATE factures SET statut = ? WHERE id = ?', ['Payée', factureId]);
    soldeInfo.statut = 'Payée';
  } else if (soldeInfo && soldeInfo.solde_restant > 0 && soldeInfo.statut === 'Envoyée') {
    await db.run('UPDATE factures SET statut = ? WHERE id = ?', ['Partiellement payée', factureId]);
    soldeInfo.statut = 'Partiellement payée';
  }

  return soldeInfo;
}

/**
 * Calcule les statistiques globales pour le tableau de bord des rapports
 * 
 * @param {import('sqlite').Database} db Instance de la base de données
 * @returns {Promise<Object>} Les statistiques globales
 */
async function getReportStats(db) {
  const stats = await db.get(`
    WITH FacturesTotals AS (
      SELECT 
        f.id,
        (COALESCE(SUM(l.quantite * l.prix_unitaire), 0) * (1 + COALESCE(f.taux_taxe_1, 0) + COALESCE(f.taux_taxe_2, 0))) * COALESCE(f.taux_change, 1.0) AS total_facture
      FROM factures f
      LEFT JOIN lignes_facture l ON f.id = l.facture_id
      WHERE f.statut != 'Annulée'
      GROUP BY f.id
    ),
    PaiementsTotals AS (
      SELECT 
        facture_id, 
        COALESCE(SUM(montant), 0) AS total_paye
      FROM paiements
      GROUP BY facture_id
    )
    SELECT 
      COALESCE(SUM(ft.total_facture), 0) AS revenu_total,
      COALESCE(SUM(pt.total_paye), 0) AS total_encaisse,
      COALESCE(SUM(ft.total_facture) - SUM(COALESCE(pt.total_paye, 0)), 0) AS solde_a_percevoir
    FROM FacturesTotals ft
    LEFT JOIN PaiementsTotals pt ON ft.id = pt.facture_id
  `);

  const depensesStats = await db.get(`
    SELECT COALESCE(SUM(montant_ht + tps + tvq), 0) as total_depenses
    FROM depenses
  `);
  stats.total_depenses = depensesStats.total_depenses;

  const statusDistribution = await db.all(`
    SELECT statut as name, COUNT(*) as value 
    FROM factures 
    GROUP BY statut
  `);

  const topClients = await db.all(`
    SELECT c.nom_entreprise as name, SUM(l.quantite * l.prix_unitaire * (1 + COALESCE(f.taux_taxe_1, 0) + COALESCE(f.taux_taxe_2, 0))) as revenu
    FROM factures f
    JOIN clients c ON f.client_id = c.id
    JOIN lignes_facture l ON f.id = l.facture_id
    WHERE f.statut != 'Annulée'
    GROUP BY c.id
    ORDER BY revenu DESC
    LIMIT 5
  `);

  const lateInvoicesQuery = `
    WITH total_lignes AS (
      SELECT facture_id, SUM(quantite * prix_unitaire) as sous_total
      FROM lignes_facture
      GROUP BY facture_id
    ),
    total_paiements AS (
      SELECT facture_id, SUM(montant) as total_paye
      FROM paiements
      GROUP BY facture_id
    )
    SELECT 
      f.id,
      f.numero_facture,
      c.nom_entreprise as client,
      f.date_echeance,
      f.devise,
      f.taux_change,
      ((COALESCE(tl.sous_total, 0) * (1 + COALESCE(f.taux_taxe_1, 0) + COALESCE(f.taux_taxe_2, 0))) - COALESCE(tp.total_paye, 0)) * COALESCE(f.taux_change, 1.0) as solde_restant
    FROM factures f
    JOIN clients c ON f.client_id = c.id
    LEFT JOIN total_lignes tl ON tl.facture_id = f.id
    LEFT JOIN total_paiements tp ON tp.facture_id = f.id
    WHERE f.date_echeance < date('now') 
      AND f.statut != 'Annulée'
      AND ((COALESCE(tl.sous_total, 0) * (1 + COALESCE(f.taux_taxe_1, 0) + COALESCE(f.taux_taxe_2, 0))) - COALESCE(tp.total_paye, 0)) > 0
    ORDER BY f.date_echeance ASC
  `;
  const lateInvoices = await db.all(lateInvoicesQuery);

  return { ...stats, statusDistribution, topClients, lateInvoices };
}

/**
 * Génère le prochain numéro de facture (SHT-YYYYMM-XXXX)
 */
async function generateInvoiceNumber(db, dateStr) {
  const dateObj = new Date(dateStr);
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const prefix = `SHT-${year}${month}-`;
  
  const lastInvoice = await db.get(
    `SELECT numero_facture FROM factures WHERE numero_facture LIKE ? ORDER BY id DESC LIMIT 1`,
    [`${prefix}%`]
  );
  
  let sequence = 1;
  if (lastInvoice && lastInvoice.numero_facture) {
    const parts = lastInvoice.numero_facture.split('-');
    if (parts.length === 3) {
      sequence = parseInt(parts[2], 10) + 1;
    }
  }
  
  const paddedSequence = String(sequence).padStart(4, '0');
  return `${prefix}${paddedSequence}`;
}

/**
 * Crée une facture et ses lignes dans une transaction
 */
async function createFacture(db, factureData, lignes) {
  const { client_id, date_emission, date_echeance, devise = 'CAD', taux_change = 1.0 } = factureData;
  const statut = 'En attente';
  
  await db.exec('BEGIN TRANSACTION;');
  
  try {
    const numero_facture = await generateInvoiceNumber(db, date_emission);
    
    const client = await db.get('SELECT province FROM clients WHERE id = ?', [client_id]);
    const taxes = getTaxRatesForProvince(client ? client.province : '');
    const { taxe_1_nom, taxe_1_taux, taxe_2_nom, taxe_2_taux } = taxes;

    const result = await db.run(
      'INSERT INTO factures (numero_facture, client_id, date_emission, date_echeance, statut, taux_taxe_1, taux_taxe_2, taxe_1_nom, taxe_2_nom, devise, taux_change) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [numero_facture, client_id, date_emission, date_echeance, statut, taxe_1_taux, taxe_2_taux, taxe_1_nom, taxe_2_nom, devise, taux_change]
    );
    const factureId = result.lastID;
    
    for (const ligne of lignes) {
      await db.run(
        'INSERT INTO lignes_facture (facture_id, description, quantite, prix_unitaire) VALUES (?, ?, ?, ?)',
        [factureId, ligne.description, ligne.quantite, ligne.prix_unitaire]
      );
    }
    
    await db.exec('COMMIT;');
    return await getSoldeFacture(db, factureId);
  } catch (err) {
    await db.exec('ROLLBACK;');
    throw err;
  }
}

/**
 * Récupère tous les détails d'une facture, incluant le client et les lignes.
 */
async function getFactureDetails(db, factureId) {
  const factureInfo = await getSoldeFacture(db, factureId);
  if (!factureInfo) return null;

  const factureRow = await db.get('SELECT * FROM factures WHERE id = ?', [factureId]);
  const client = await db.get('SELECT * FROM clients WHERE id = ?', [factureRow.client_id]);
  const lignes = await db.all('SELECT * FROM lignes_facture WHERE facture_id = ?', [factureId]);

  const settings = await db.get('SELECT * FROM settings LIMIT 1');

  return {
    ...factureInfo,
    date_emission: factureRow.date_emission,
    date_echeance: factureRow.date_echeance,
    taux_taxe_1: factureRow.taux_taxe_1,
    taux_taxe_2: factureRow.taux_taxe_2,
    taxe_1_nom: factureRow.taxe_1_nom,
    taxe_2_nom: factureRow.taxe_2_nom,
    client_details: client,
    lignes: lignes,
    settings: settings
  };
}

async function cancelFacture(db, factureId) {
  const factureInfo = await getSoldeFacture(db, factureId);
  if (!factureInfo) throw new Error('Facture non trouvée');
  if (factureInfo.statut !== 'En attente') {
    throw new Error('Seules les factures "En attente" peuvent être annulées.');
  }
  await db.run('UPDATE factures SET statut = ? WHERE id = ?', ['Annulée', factureId]);
  return { message: 'Facture annulée avec succès' };
}

async function updateFacture(db, factureId, factureData, lignes) {
  const { client_id, date_echeance, devise = 'CAD', taux_change = 1.0 } = factureData;
  const factureInfo = await getSoldeFacture(db, factureId);
  
  if (!factureInfo) throw new Error('Facture non trouvée');
  if (factureInfo.statut !== 'En attente') {
    throw new Error('Seules les factures "En attente" peuvent être modifiées.');
  }

  await db.exec('BEGIN TRANSACTION;');
  try {
    const client = await db.get('SELECT province FROM clients WHERE id = ?', [client_id]);
    const taxes = getTaxRatesForProvince(client ? client.province : '');

    await db.run(
      'UPDATE factures SET client_id = ?, date_echeance = ?, taux_taxe_1 = ?, taux_taxe_2 = ?, taxe_1_nom = ?, taxe_2_nom = ?, devise = ?, taux_change = ? WHERE id = ?',
      [client_id, date_echeance, taxes.taxe_1_taux, taxes.taxe_2_taux, taxes.taxe_1_nom, taxes.taxe_2_nom, devise, taux_change, factureId]
    );
    await db.run('DELETE FROM lignes_facture WHERE facture_id = ?', [factureId]);
    for (const ligne of lignes) {
      await db.run(
        'INSERT INTO lignes_facture (facture_id, description, quantite, prix_unitaire) VALUES (?, ?, ?, ?)',
        [factureId, ligne.description, ligne.quantite, ligne.prix_unitaire]
      );
    }
    await db.exec('COMMIT;');
    return await getSoldeFacture(db, factureId);
  } catch (err) {
    await db.exec('ROLLBACK;');
    throw err;
  }
}

async function deleteFacture(db, factureId) {
  await db.run('DELETE FROM factures WHERE id = ?', [factureId]);
  return { message: 'Facture supprimée avec succès' };
}

async function getDashboardStats(db) {
  const factures = await getFacturesAvecSoldes(db);
  
  let chiffreAffaires = 0;
  let facturesEnAttente = 0;
  let facturesEnRetard = 0;

  const today = new Date().toISOString().split('T')[0];
  const monthlyData = {};

  factures.forEach(f => {
    if (f.statut === 'Payée' || f.statut === 'Partiellement payée') {
      chiffreAffaires += f.montant_paye_cad;
    }
    if (f.statut !== 'Annulée' && f.solde_restant_cad > 0) {
      if (f.date_echeance < today) {
        facturesEnRetard += f.solde_restant_cad;
      } else {
        facturesEnAttente += f.solde_restant_cad;
      }
    }

    // Chart data (Revenue by month based on date_emission)
    if (f.statut === 'Payée' || f.statut === 'Partiellement payée') {
      const month = f.date_emission.substring(0, 7); // YYYY-MM
      if (!monthlyData[month]) monthlyData[month] = 0;
      monthlyData[month] += f.montant_paye_cad;
    }
  });

  const chartData = Object.keys(monthlyData).sort().map(month => ({
    name: month,
    revenu: monthlyData[month]
  }));

  return {
    chiffreAffaires,
    facturesEnAttente,
    facturesEnRetard,
    chartData
  };
}

async function getTaxReport(db, annee, mois) {
  let whereClause = "WHERE f.statut != 'Annulée'";
  const params = [];
  
  if (annee) {
    whereClause += " AND strftime('%Y', f.date_emission) = ?";
    params.push(annee);
  }
  if (mois) {
    // mois in 'MM' format
    whereClause += " AND strftime('%m', f.date_emission) = ?";
    params.push(mois);
  }

  const query = `
    WITH total_lignes AS (
      SELECT facture_id, SUM(quantite * prix_unitaire) as sous_total
      FROM lignes_facture
      GROUP BY facture_id
    )
    SELECT 
      COALESCE(SUM(tl.sous_total * COALESCE(f.taux_change, 1.0)), 0) as total_revenus_taxables,
      COALESCE(SUM(tl.sous_total * COALESCE(f.taux_taxe_1, 0) * COALESCE(f.taux_change, 1.0)), 0) as total_taxe_1,
      COALESCE(SUM(tl.sous_total * COALESCE(f.taux_taxe_2, 0) * COALESCE(f.taux_change, 1.0)), 0) as total_taxe_2
    FROM factures f
    LEFT JOIN total_lignes tl ON tl.facture_id = f.id
    ${whereClause}
  `;
  
  const result = await db.get(query, params);
  
  const queryGrouped = `
    WITH total_lignes AS (
      SELECT facture_id, SUM(quantite * prix_unitaire) as sous_total
      FROM lignes_facture
      GROUP BY facture_id
    )
    SELECT 
      f.taxe_1_nom,
      COALESCE(SUM(tl.sous_total * COALESCE(f.taux_taxe_1, 0) * COALESCE(f.taux_change, 1.0)), 0) as montant_taxe_1,
      f.taxe_2_nom,
      COALESCE(SUM(tl.sous_total * COALESCE(f.taux_taxe_2, 0) * COALESCE(f.taux_change, 1.0)), 0) as montant_taxe_2
    FROM factures f
    LEFT JOIN total_lignes tl ON tl.facture_id = f.id
    ${whereClause}
    GROUP BY f.taxe_1_nom, f.taxe_2_nom
  `;
  const details = await db.all(queryGrouped, params);

  // Dépenses taxes (CTI / RTI)
  let depensesWhereClause = "WHERE 1=1";
  const depensesParams = [];
  if (annee) {
    depensesWhereClause += " AND strftime('%Y', date_depense) = ?";
    depensesParams.push(annee);
  }
  if (mois) {
    depensesWhereClause += " AND strftime('%m', date_depense) = ?";
    depensesParams.push(mois);
  }

  const queryDepenses = `
    SELECT 
      COALESCE(SUM(montant_ht), 0) as total_depenses_ht,
      COALESCE(SUM(tps), 0) as total_tps_payee,
      COALESCE(SUM(tvq), 0) as total_tvq_payee
    FROM depenses
    ${depensesWhereClause}
  `;
  const depensesResult = await db.get(queryDepenses, depensesParams);
  
  return { summary: result, details, depenses: depensesResult };
}

module.exports = {
  getFacturesAvecSoldes,
  getSoldeFacture,
  getFactureDetails,
  addPaiement,
  createFacture,
  updateFacture,
  cancelFacture,
  deleteFacture,
  getReportStats,
  getDashboardStats,
  getTaxReport
};
