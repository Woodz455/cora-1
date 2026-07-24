const { createFacture } = require('./invoiceService');

async function getSubscriptions(db) {
  return await db.all(`
    SELECT a.*, c.nom_entreprise as client_nom 
    FROM abonnements a 
    JOIN clients c ON a.client_id = c.id
    ORDER BY a.statut ASC, a.date_prochaine_generation ASC
  `);
}

async function createSubscription(db, data) {
  const { client_id, titre, lignes_json, cycle, date_prochaine_generation, devise } = data;
  const result = await db.run(
    `INSERT INTO abonnements (client_id, titre, lignes_json, cycle, date_prochaine_generation, devise) 
     VALUES (?, ?, ?, ?, ?, ?)`,
    [client_id, titre, lignes_json, cycle || 'Mensuel', date_prochaine_generation, devise || 'CAD']
  );
  return { id: result.lastID, ...data };
}

async function updateSubscription(db, id, data) {
  const { titre, lignes_json, cycle, date_prochaine_generation, statut, devise } = data;
  await db.run(
    `UPDATE abonnements SET titre = ?, lignes_json = ?, cycle = ?, date_prochaine_generation = ?, statut = ?, devise = ? WHERE id = ?`,
    [titre, lignes_json, cycle, date_prochaine_generation, statut, devise, id]
  );
  return { id, ...data };
}

async function deleteSubscription(db, id) {
  await db.run(`DELETE FROM abonnements WHERE id = ?`, [id]);
  return { success: true };
}

async function checkAndGenerateRecurringInvoices(db) {
  const today = new Date().toISOString().split('T')[0];
  const dueSubs = await db.all(`SELECT * FROM abonnements WHERE statut = 'Actif' AND date_prochaine_generation <= ?`, [today]);
  
  for (const sub of dueSubs) {
    try {
      const lignes = JSON.parse(sub.lignes_json);
      
      const dateEmission = today; // On émet à la date du jour de la génération
      const dEmission = new Date(dateEmission);
      const dEcheance = new Date(dEmission);
      dEcheance.setDate(dEcheance.getDate() + 30); // 30 jours par défaut
      const dateEcheance = dEcheance.toISOString().split('T')[0];
      
      await createFacture(db, {
        client_id: sub.client_id,
        date_emission: dateEmission,
        date_echeance: dateEcheance,
        devise: sub.devise || 'CAD',
        taux_change: 1.0
      }, lignes);
      
      // Update next generation date
      let nextDate = new Date(sub.date_prochaine_generation);
      if (sub.cycle === 'Annuel') {
        nextDate.setFullYear(nextDate.getFullYear() + 1);
      } else {
        nextDate.setMonth(nextDate.getMonth() + 1);
      }
      
      // Si la nouvelle date est toujours dans le passé, on la force à aujourd'hui + cycle
      if (nextDate < new Date()) {
          const forceNext = new Date();
          if (sub.cycle === 'Annuel') forceNext.setFullYear(forceNext.getFullYear() + 1);
          else forceNext.setMonth(forceNext.getMonth() + 1);
          nextDate = forceNext;
      }
      
      const nextDateStr = nextDate.toISOString().split('T')[0];
      await db.run(`UPDATE abonnements SET date_prochaine_generation = ? WHERE id = ?`, [nextDateStr, sub.id]);
      console.log(`Facture récurrente générée pour l'abonnement ID ${sub.id}. Prochaine le ${nextDateStr}`);
    } catch (e) {
      console.error(`Erreur génération facture récurrente (Abo ID ${sub.id}):`, e);
    }
  }
}

module.exports = {
  getSubscriptions,
  createSubscription,
  updateSubscription,
  deleteSubscription,
  checkAndGenerateRecurringInvoices
};
