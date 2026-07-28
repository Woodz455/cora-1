/**
 * Diagnostic des données comptables.
 *
 * Les défauts corrigés dans cette version ont pu laisser des traces dans les
 * bases existantes : paiements supérieurs au solde (le contrôle n'existait pas),
 * statuts jamais mis à jour, transactions bancaires liées à une facture
 * disparue. Ce script signale ces anomalies sans rien modifier.
 *
 *   npm run doctor
 */

const { initDb, reprendreMontants } = require('./database.js');
const { getFacturesAvecSoldes, resolveStatut, STATUTS } = require('./invoiceService.js');
const { roundCents, formatMontant } = require('./money.js');

const argent = (n) => formatMontant(n);

/**
 * Compare les montants figés d'un document à ce que donneraient ses lignes.
 *
 * Les totaux étant arrêtés à l'émission, ils ne peuvent plus diverger par le
 * fonctionnement normal de l'application. Un écart signale donc une écriture
 * directe en base, une restauration partielle ou une corruption — précisément
 * ce qu'un diagnostic doit savoir repérer.
 */
async function detecterDerives(db, table) {
  const tableLignes = table === 'devis' ? 'lignes_devis' : 'lignes_facture';
  const cle = table === 'devis' ? 'devis_id' : 'facture_id';
  const numero = table === 'devis' ? 'numero_devis' : 'numero_facture';

  const documents = await db.all(`
    SELECT d.id, d.${numero} AS numero, d.sous_total, d.montant_total,
           d.taux_taxe_1, d.taux_taxe_2,
           (SELECT COALESCE(SUM(l.quantite * l.prix_unitaire), 0)
            FROM ${tableLignes} l WHERE l.${cle} = d.id) AS brut
    FROM ${table} d
  `);

  const anomalies = [];
  for (const doc of documents) {
    const attenduSousTotal = roundCents(doc.brut);
    const t1 = roundCents(attenduSousTotal * (doc.taux_taxe_1 || 0));
    const t2 = roundCents(attenduSousTotal * (doc.taux_taxe_2 || 0));
    const attenduTotal = roundCents(attenduSousTotal + t1 + t2);

    if (doc.montant_total === null) {
      anomalies.push({
        gravite: 'ÉLEVÉE',
        objet: doc.numero || `${table} #${doc.id}`,
        probleme: 'Aucun montant enregistré.',
        action: 'Lancez « npm run doctor -- --refiger-montants » pour les calculer depuis les lignes.'
      });
      continue;
    }

    if (Math.abs(doc.montant_total - attenduTotal) > 0.005) {
      anomalies.push({
        gravite: 'ÉLEVÉE',
        objet: doc.numero || `${table} #${doc.id}`,
        probleme: `Montant figé à ${argent(doc.montant_total)} alors que les lignes donnent ${argent(attenduTotal)}.`,
        action: "Les lignes ont probablement été modifiées hors de l'application. Vérifiez le document, puis « npm run doctor -- --refiger-montants »."
      });
    }
  }
  return anomalies;
}

async function diagnostiquer(db) {
  const anomalies = [];
  const factures = await getFacturesAvecSoldes(db);

  for (const f of factures) {
    if (f.solde_restant < -0.005) {
      anomalies.push({
        gravite: 'ÉLEVÉE',
        objet: f.numero_facture,
        probleme: `Encaissé ${argent(f.montant_paye)} pour un total de ${argent(f.montant_total)} ; excédent de ${argent(-f.solde_restant)}.`,
        action: "Vérifiez les paiements de cette facture : un montant a probablement été saisi en trop avant l'ajout du contrôle de sur-paiement."
      });
    }

    const attendu = resolveStatut(f.statut, f.solde_restant, f.montant_paye);
    if (attendu !== f.statut) {
      anomalies.push({
        gravite: 'MOYENNE',
        objet: f.numero_facture,
        probleme: `Statut « ${f.statut} » alors que les montants correspondent à « ${attendu} ».`,
        action: "Le statut sera corrigé au prochain paiement enregistré, ou par « npm run doctor -- --corriger-statuts »."
      });
    }

    if (!f.client) {
      anomalies.push({
        gravite: 'ÉLEVÉE',
        objet: f.numero_facture,
        probleme: 'Facture rattachée à aucun client.',
        action: 'Rattachez-la à un client existant.'
      });
    }
  }

  const transactionsOrphelines = await db.all(`
    SELECT t.id, t.date_transaction, t.description, t.montant
    FROM transactions_bancaires t
    WHERE t.statut = 'Rapproché' AND (t.facture_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM factures f WHERE f.id = t.facture_id))
  `);
  for (const t of transactionsOrphelines) {
    anomalies.push({
      gravite: 'MOYENNE',
      objet: `Transaction du ${t.date_transaction}`,
      probleme: `Marquée « Rapproché » (${argent(t.montant)}) mais la facture liée n'existe plus.`,
      action: 'Repassez-la en attente pour la rapprocher d\'une autre facture.'
    });
  }

  const devisIncoherents = await db.all(`
    SELECT d.numero_devis FROM devis d
    WHERE d.statut = 'Converti' AND (d.facture_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM factures f WHERE f.id = d.facture_id))
  `);
  for (const d of devisIncoherents) {
    anomalies.push({
      gravite: 'MOYENNE',
      objet: d.numero_devis,
      probleme: 'Devis marqué « Converti » sans facture correspondante.',
      action: 'Vérifiez si la facture a été supprimée, puis reconvertissez le devis si nécessaire.'
    });
  }

  anomalies.push(...await detecterDerives(db, 'factures'));
  anomalies.push(...await detecterDerives(db, 'devis'));

  const sansLigne = await db.all(`
    SELECT numero_facture FROM factures f
    WHERE statut != '${STATUTS.ANNULEE}'
      AND NOT EXISTS (SELECT 1 FROM lignes_facture l WHERE l.facture_id = f.id)
  `);
  for (const f of sansLigne) {
    anomalies.push({
      gravite: 'FAIBLE',
      objet: f.numero_facture,
      probleme: 'Facture sans aucune ligne : son total est nul.',
      action: 'Ajoutez les lignes manquantes ou annulez la facture.'
    });
  }

  return anomalies;
}

/** Réaligne le statut des factures sur leurs montants. */
async function corrigerStatuts(db) {
  const factures = await getFacturesAvecSoldes(db);
  let corrigees = 0;

  for (const f of factures) {
    const attendu = resolveStatut(f.statut, f.solde_restant, f.montant_paye);
    if (attendu !== f.statut) {
      await db.run('UPDATE factures SET statut = ? WHERE id = ?', [attendu, f.id]);
      console.log(`  ${f.numero_facture} : « ${f.statut} » -> « ${attendu} »`);
      corrigees += 1;
    }
  }
  return corrigees;
}

async function main() {
  const db = await initDb();
  try {
    const anomalies = await diagnostiquer(db);

    if (anomalies.length === 0) {
      console.log('\nAucune anomalie détectée dans les données comptables.\n');
    } else {
      console.log(`\n${anomalies.length} anomalie(s) détectée(s) :\n`);
      for (const a of anomalies) {
        console.log(`  [${a.gravite}] ${a.objet}`);
        console.log(`     ${a.probleme}`);
        console.log(`     -> ${a.action}\n`);
      }
    }

    if (process.argv.includes('--corriger-statuts')) {
      console.log('Correction des statuts :');
      const n = await corrigerStatuts(db);
      console.log(n === 0 ? '  Aucun statut à corriger.' : `  ${n} facture(s) mise(s) à jour.`);
    }

    if (process.argv.includes('--refiger-montants')) {
      console.log('\nRecalcul des montants depuis les lignes :');
      const factures = await reprendreMontants(db, 'factures', { toutes: true });
      const devis = await reprendreMontants(db, 'devis', { toutes: true });
      console.log(`  ${factures} facture(s) et ${devis} devis mis à jour.`);
    }
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { diagnostiquer, corrigerStatuts, detecterDerives };
