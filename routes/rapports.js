/**
 * Routes des rapports et du tableau de bord.
 */

const express = require('express');

const {
  getReportStats, getDashboardStats, getTaxReport,
  getRegistreVentes, getRegistreEncaissements, getBalanceAgee
} = require('../invoiceService.js');
const { anyRole, adminOrAccountant } = require('../authMiddleware.js');
const { versCSV, nomFichier } = require('../exportService.js');
const { asyncRoute, httpError } = require('../httpUtils.js');

/** Colonnes du registre des ventes, dans l'ordre attendu par un comptable. */
const COLONNES_VENTES = [
  { cle: 'numero_facture', titre: 'Numéro' },
  { cle: 'date_emission', titre: 'Date d\'émission' },
  { cle: 'date_echeance', titre: 'Échéance' },
  { cle: 'client', titre: 'Client' },
  { cle: 'statut', titre: 'Statut' },
  { cle: 'sous_total', titre: 'Sous-total', type: 'montant' },
  { cle: 'taxe_1_nom', titre: 'Taxe 1' },
  { cle: 'montant_taxe_1', titre: 'Montant taxe 1', type: 'montant' },
  { cle: 'taxe_2_nom', titre: 'Taxe 2' },
  { cle: 'montant_taxe_2', titre: 'Montant taxe 2', type: 'montant' },
  { cle: 'montant_total', titre: 'Total', type: 'montant' },
  { cle: 'montant_credite', titre: 'Crédité', type: 'montant' },
  { cle: 'montant_paye', titre: 'Encaissé', type: 'montant' },
  { cle: 'solde_restant', titre: 'Solde', type: 'montant' },
  { cle: 'devise', titre: 'Devise' },
  { cle: 'taux_change', titre: 'Taux de change' },
  { cle: 'montant_total_cad', titre: 'Total en CAD', type: 'montant' }
];

const COLONNES_ENCAISSEMENTS = [
  { cle: 'date_paiement', titre: 'Date' },
  { cle: 'montant', titre: 'Montant', type: 'montant' },
  { cle: 'devise', titre: 'Devise' },
  { cle: 'taux_change', titre: 'Taux de change' },
  { cle: 'montant_cad', titre: 'Montant en CAD', type: 'montant' },
  { cle: 'numero_facture', titre: 'Facture' },
  { cle: 'client', titre: 'Client' },
  { cle: 'origine', titre: 'Origine' },
  { cle: 'note', titre: 'Note' }
];

const COLONNES_BALANCE = [
  { cle: 'client', titre: 'Client' },
  { cle: 'non_echu', titre: 'Non échu', type: 'montant' },
  { cle: 'jours_1_30', titre: '1 à 30 jours', type: 'montant' },
  { cle: 'jours_31_60', titre: '31 à 60 jours', type: 'montant' },
  { cle: 'jours_61_90', titre: '61 à 90 jours', type: 'montant' },
  { cle: 'jours_91_plus', titre: '91 jours et plus', type: 'montant' },
  { cle: 'total', titre: 'Total dû', type: 'montant' }
];

/** Valide et normalise une période de filtre. */
function validerPeriode(query) {
  const { annee, mois } = query;

  if (annee !== undefined && !/^\d{4}$/.test(String(annee))) {
    throw httpError(400, "L'année doit être au format AAAA.");
  }
  if (mois !== undefined && mois !== '' && !/^(0?[1-9]|1[0-2])$/.test(String(mois))) {
    throw httpError(400, 'Le mois doit être un nombre entre 1 et 12.');
  }

  return { annee: annee || null, mois: mois || null };
}

module.exports = function rapportRoutes(getDb) {
  const router = express.Router();

  /** Indicateurs du tableau de bord d'accueil : visibles par tous les rôles. */
  router.get('/stats', anyRole(), asyncRoute(async (req, res) => {
    res.json(await getDashboardStats(getDb()));
  }));

  router.get('/rapports', adminOrAccountant(), asyncRoute(async (req, res) => {
    res.json(await getReportStats(getDb()));
  }));

  router.get('/rapports/taxes', adminOrAccountant(), asyncRoute(async (req, res) => {
    const { annee, mois } = req.query;

    if (annee !== undefined && !/^\d{4}$/.test(String(annee))) {
      throw httpError(400, "L'année doit être au format AAAA.");
    }
    if (mois !== undefined && !/^(0?[1-9]|1[0-2])$/.test(String(mois))) {
      throw httpError(400, 'Le mois doit être un nombre entre 1 et 12.');
    }

    res.json(await getTaxReport(getDb(), annee, mois));
  }));

  /**
   * Balance âgée des comptes clients : qui doit de l'argent, et depuis quand.
   */
  router.get('/rapports/balance-agee', adminOrAccountant(), asyncRoute(async (req, res) => {
    res.json(await getBalanceAgee(getDb()));
  }));

  /**
   * Registres exportables vers le logiciel du comptable.
   *
   * La réponse est un téléchargement et non du JSON : `Content-Disposition`
   * porte le nom du fichier, daté de la période demandée.
   */
  const registre = (chemin, base, colonnes, lecture) => {
    router.get(chemin, adminOrAccountant(), asyncRoute(async (req, res) => {
      const periode = validerPeriode(req.query);
      const lignes = await lecture(getDb(), periode);

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${nomFichier(base, periode)}"`);
      res.send(versCSV(colonnes, lignes));
    }));
  };

  /** La balance âgée s'exporte comme les registres, sans filtre de période. */
  router.get('/rapports/export/balance-agee', adminOrAccountant(), asyncRoute(async (req, res) => {
    const balance = await getBalanceAgee(getDb());
    const lignes = [
      ...balance.clients,
      // Ligne de totaux, attendue en bas d'un tel tableau.
      { client: 'TOTAL', ...balance.totaux }
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nomFichier('balance-agee')}"`);
    res.send(versCSV(COLONNES_BALANCE, lignes));
  }));

  registre('/rapports/export/ventes', 'registre-ventes', COLONNES_VENTES, getRegistreVentes);
  registre(
    '/rapports/export/encaissements', 'registre-encaissements',
    COLONNES_ENCAISSEMENTS, getRegistreEncaissements
  );

  return router;
};
