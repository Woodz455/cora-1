const { createFacture } = require('./invoiceService.js');

async function getDevis(db) {
  const devis = await db.all(`
    SELECT d.*, c.nom_entreprise as client
    FROM devis d
    JOIN clients c ON d.client_id = c.id
    ORDER BY d.date_emission DESC
  `);

  for (let d of devis) {
    const lignes = await db.all('SELECT * FROM lignes_devis WHERE devis_id = ?', [d.id]);
    const sous_total = lignes.reduce((acc, l) => acc + (l.quantite * l.prix_unitaire), 0);
    const taxes = sous_total * ((d.taux_taxe_1 || 0) + (d.taux_taxe_2 || 0));
    d.montant_total = sous_total + taxes;
    d.lignes = lignes;
  }

  return devis;
}

async function getDevisDetails(db, devisId) {
  const devisRow = await db.get('SELECT * FROM devis WHERE id = ?', [devisId]);
  if (!devisRow) return null;

  const client = await db.get('SELECT * FROM clients WHERE id = ?', [devisRow.client_id]);
  const lignes = await db.all('SELECT * FROM lignes_devis WHERE devis_id = ?', [devisId]);
  const settings = await db.get('SELECT * FROM settings LIMIT 1');

  const sous_total = lignes.reduce((acc, l) => acc + (l.quantite * l.prix_unitaire), 0);
  const montant_total = sous_total * (1 + (devisRow.taux_taxe_1 || 0) + (devisRow.taux_taxe_2 || 0));

  return {
    ...devisRow,
    client_details: client,
    lignes: lignes,
    settings: settings,
    sous_total,
    montant_total,
    solde_restant: montant_total // Un devis n'a pas de paiements
  };
}

async function createDevis(db, devisData, lignes) {
  const { client_id, date_emission, date_validite, devise = 'CAD', taux_change = 1.0 } = devisData;
  
  await db.exec('BEGIN TRANSACTION;');
  try {
    // Générer le numéro DEV-YYYYMM-XXXX
    const dateObj = new Date(date_emission);
    const yearMonth = `${dateObj.getFullYear()}${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
    const countRow = await db.get('SELECT COUNT(*) as count FROM devis WHERE numero_devis LIKE ?', [`DEV-${yearMonth}-%`]);
    const nextNum = (countRow.count + 1).toString().padStart(4, '0');
    const numero_devis = `DEV-${yearMonth}-${nextNum}`;

    const settings = await db.get('SELECT taxe_1_taux, taxe_2_taux, taxe_1_nom, taxe_2_nom FROM settings LIMIT 1');
    const taux_taxe_1 = settings ? settings.taxe_1_taux : 0;
    const taux_taxe_2 = settings ? settings.taxe_2_taux : 0;
    const taxe_1_nom = settings ? settings.taxe_1_nom : '';
    const taxe_2_nom = settings ? settings.taxe_2_nom : '';

    const insertResult = await db.run(
      'INSERT INTO devis (numero_devis, client_id, date_emission, date_validite, statut, taux_taxe_1, taux_taxe_2, taxe_1_nom, taxe_2_nom, devise, taux_change) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [numero_devis, client_id, date_emission, date_validite, 'En attente', taux_taxe_1, taux_taxe_2, taxe_1_nom, taxe_2_nom, devise, taux_change]
    );
    const devisId = insertResult.lastID;

    for (const ligne of lignes) {
      await db.run(
        'INSERT INTO lignes_devis (devis_id, description, quantite, prix_unitaire) VALUES (?, ?, ?, ?)',
        [devisId, ligne.description, ligne.quantite, ligne.prix_unitaire]
      );
    }

    await db.exec('COMMIT;');
    return { id: devisId, numero_devis };
  } catch (err) {
    await db.exec('ROLLBACK;');
    throw err;
  }
}

async function updateDevis(db, devisId, devisData, lignes) {
  const { client_id, date_validite, devise = 'CAD', taux_change = 1.0 } = devisData;
  const devisRow = await db.get('SELECT * FROM devis WHERE id = ?', [devisId]);
  if (!devisRow) throw new Error('Devis non trouvé');
  if (devisRow.statut !== 'En attente') throw new Error('Seul un devis en attente peut être modifié');

  await db.exec('BEGIN TRANSACTION;');
  try {
    await db.run(
      'UPDATE devis SET client_id = ?, date_validite = ?, devise = ?, taux_change = ? WHERE id = ?',
      [client_id, date_validite, devise, taux_change, devisId]
    );
    await db.run('DELETE FROM lignes_devis WHERE devis_id = ?', [devisId]);
    for (const ligne of lignes) {
      await db.run(
        'INSERT INTO lignes_devis (devis_id, description, quantite, prix_unitaire) VALUES (?, ?, ?, ?)',
        [devisId, ligne.description, ligne.quantite, ligne.prix_unitaire]
      );
    }
    await db.exec('COMMIT;');
    return { message: 'Devis mis à jour' };
  } catch (err) {
    await db.exec('ROLLBACK;');
    throw err;
  }
}

async function cancelDevis(db, devisId) {
  const devisRow = await db.get('SELECT * FROM devis WHERE id = ?', [devisId]);
  if (!devisRow) throw new Error('Devis non trouvé');
  if (devisRow.statut === 'Converti') throw new Error('Un devis converti ne peut pas être annulé');

  await db.run('UPDATE devis SET statut = ? WHERE id = ?', ['Refusé', devisId]);
  return { message: 'Devis refusé/annulé' };
}

async function convertDevisToFacture(db, devisId) {
  const devisRow = await db.get('SELECT * FROM devis WHERE id = ?', [devisId]);
  if (!devisRow) throw new Error('Devis non trouvé');
  if (devisRow.statut === 'Converti') throw new Error('Devis déjà converti');

  const lignes = await db.all('SELECT * FROM lignes_devis WHERE devis_id = ?', [devisId]);
  
  // Create the facture
  const date_emission = new Date().toISOString().split('T')[0];
  const factureData = {
    client_id: devisRow.client_id,
    date_emission,
    date_echeance: date_emission, // Default to same day or inherit
    devise: devisRow.devise,
    taux_change: devisRow.taux_change
  };

  const facture = await createFacture(db, factureData, lignes);

  // Link devis to facture and mark converted
  await db.run('UPDATE devis SET statut = ?, facture_id = ? WHERE id = ?', ['Converti', facture.facture.id, devisId]);

  return facture;
}

module.exports = {
  getDevis,
  getDevisDetails,
  createDevis,
  updateDevis,
  cancelDevis,
  convertDevisToFacture
};
