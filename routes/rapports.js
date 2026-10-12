/**
 * Routes des rapports et du tableau de bord.
 */

const express = require('express');

const {
  getReportStats, getDashboardStats, getTaxReport,
  getRegistreVentes, getRegistreEncaissements, getBalanceAgee, getSommaire
} = require('../invoiceService.js');
const { anyRole, adminOrAccountant } = require('../authMiddleware.js');
const { verifierMiseAJour } = require('../updateService.js');
const { versCSV, nomFichier } = require('../exportService.js');
const { asyncRoute, httpError } = require('../httpUtils.js');
const { langueDeRequete, traduireStatut } = require('../traductionServeur.js');

/**
 * Colonnes du registre des ventes, dans l'ordre attendu par un comptable.
 * `titreEn` est le titre du fichier d'un utilisateur anglophone.
 */
const COLONNES_VENTES = [
  { cle: 'numero_facture', titre: 'Numéro', titreEn: 'Number' },
  { cle: 'date_emission', titre: 'Date d\'émission', titreEn: 'Issue date' },
  { cle: 'date_echeance', titre: 'Échéance', titreEn: 'Due date' },
  { cle: 'client', titre: 'Client', titreEn: 'Client' },
  { cle: 'statut', titre: 'Statut', titreEn: 'Status' },
  { cle: 'sous_total', titre: 'Sous-total', titreEn: 'Subtotal', type: 'montant' },
  { cle: 'taxe_1_nom', titre: 'Taxe 1', titreEn: 'Tax 1' },
  { cle: 'montant_taxe_1', titre: 'Montant taxe 1', titreEn: 'Tax 1 amount', type: 'montant' },
  { cle: 'taxe_2_nom', titre: 'Taxe 2', titreEn: 'Tax 2' },
  { cle: 'montant_taxe_2', titre: 'Montant taxe 2', titreEn: 'Tax 2 amount', type: 'montant' },
  { cle: 'montant_total', titre: 'Total', titreEn: 'Total', type: 'montant' },
  { cle: 'montant_credite', titre: 'Crédité', titreEn: 'Credited', type: 'montant' },
  { cle: 'montant_paye', titre: 'Encaissé', titreEn: 'Received', type: 'montant' },
  { cle: 'solde_restant', titre: 'Solde', titreEn: 'Balance', type: 'montant' },
  { cle: 'devise', titre: 'Devise', titreEn: 'Currency' },
  { cle: 'taux_change', titre: 'Taux de change', titreEn: 'Exchange rate' },
  { cle: 'montant_total_cad', titre: 'Total en CAD', titreEn: 'Total in CAD', type: 'montant' }
];

const COLONNES_ENCAISSEMENTS = [
  { cle: 'date_paiement', titre: 'Date', titreEn: 'Date' },
  { cle: 'montant', titre: 'Montant', titreEn: 'Amount', type: 'montant' },
  { cle: 'devise', titre: 'Devise', titreEn: 'Currency' },
  { cle: 'taux_change', titre: 'Taux de change', titreEn: 'Exchange rate' },
  { cle: 'montant_cad', titre: 'Montant en CAD', titreEn: 'Amount in CAD', type: 'montant' },
  { cle: 'numero_facture', titre: 'Facture', titreEn: 'Invoice' },
  { cle: 'client', titre: 'Client', titreEn: 'Client' },
  { cle: 'origine', titre: 'Origine', titreEn: 'Source' },
  { cle: 'note', titre: 'Note', titreEn: 'Note' }
];

const COLONNES_BALANCE = [
  { cle: 'client', titre: 'Client', titreEn: 'Client' },
  { cle: 'non_echu', titre: 'Non échu', titreEn: 'Not yet due', type: 'montant' },
  { cle: 'jours_1_30', titre: '1 à 30 jours', titreEn: '1 to 30 days', type: 'montant' },
  { cle: 'jours_31_60', titre: '31 à 60 jours', titreEn: '31 to 60 days', type: 'montant' },
  { cle: 'jours_61_90', titre: '61 à 90 jours', titreEn: '61 to 90 days', type: 'montant' },
  { cle: 'jours_91_plus', titre: '91 jours et plus', titreEn: '91 days and over', type: 'montant' },
  { cle: 'total', titre: 'Total dû', titreEn: 'Total due', type: 'montant' }
];

/** Nom des fichiers, dans chaque langue. */
const FICHIERS = {
  ventes: { fr: 'registre-ventes', en: 'sales-register' },
  encaissements: { fr: 'registre-encaissements', en: 'payments-received-register' },
  balance: { fr: 'balance-agee', en: 'aged-receivables' }
};

/**
 * Valeurs enregistrées en français, et leur équivalent dans le fichier d'un
 * utilisateur anglophone : statuts, origine d'un paiement et noms de taxes.
 */
const VALEURS_EN = {
  'Saisie manuelle': 'Manual entry',
  'Rapprochement bancaire': 'Bank reconciliation',
  TPS: 'GST',
  TVQ: 'QST',
  TVH: 'HST',
  TVP: 'PST'
};

/**
 * Langue du fichier. Un téléchargement part d'un lien, qui ne porte pas
 * l'en-tête des appels à l'API : l'interface la met dans l'adresse.
 */
function langueDuFichier(req) {
  return req.query.langue === 'en' ? 'en' : langueDeRequete(req);
}

function lignesDansLaLangue(lignes, langue) {
  if (langue !== 'en') return lignes;
  const traduire = (v) => (typeof v === 'string' ? (VALEURS_EN[v] || traduireStatut(v)) : v);
  return lignes.map((ligne) => ({
    ...ligne,
    ...(ligne.statut !== undefined && { statut: traduire(ligne.statut) }),
    ...(ligne.origine !== undefined && { origine: traduire(ligne.origine) }),
    ...(ligne.taxe_1_nom !== undefined && { taxe_1_nom: traduire(ligne.taxe_1_nom) }),
    ...(ligne.taxe_2_nom !== undefined && { taxe_2_nom: traduire(ligne.taxe_2_nom) })
  }));
}

/** Valide et normalise une période de filtre. */
function validerPeriode(query) {
  const { annee, mois, trimestre } = query;

  if (annee !== undefined && annee !== '' && !/^\d{4}$/.test(String(annee))) {
    throw httpError(400, "L'année doit être au format AAAA.");
  }
  if (mois !== undefined && mois !== '' && !/^(0?[1-9]|1[0-2])$/.test(String(mois))) {
    throw httpError(400, 'Le mois doit être un nombre entre 1 et 12.');
  }
  if (trimestre !== undefined && trimestre !== '' && !/^[1-4]$/.test(String(trimestre))) {
    throw httpError(400, 'Le trimestre doit être un nombre entre 1 et 4.');
  }
  // Les deux ensemble décriraient une période contradictoire : mieux vaut le
  // dire que de retenir silencieusement l'un des deux.
  if (mois && trimestre) {
    throw httpError(400, 'Indiquez un mois ou un trimestre, pas les deux.');
  }

  return { annee: annee || null, mois: mois || null, trimestre: trimestre || null };
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
    const { annee, mois, trimestre } = validerPeriode(req.query);
    res.json(await getTaxReport(getDb(), annee, mois, trimestre));
  }));

  /**
   * Compte rendu de gestion d'un mois, d'un trimestre ou d'une année : la
   * matière du document PDF que l'on remet à son comptable ou à son banquier.
   * L'année est obligatoire, un sommaire portant toujours sur une période.
   */
  router.get('/rapports/sommaire', adminOrAccountant(), asyncRoute(async (req, res) => {
    const periode = validerPeriode(req.query);
    if (!periode.annee) {
      throw httpError(400, 'Le compte rendu porte sur une année, un trimestre ou un mois : indiquez l\'année.');
    }
    res.json(await getSommaire(getDb(), periode));
  }));

  /**
   * Version installée, et version publiée s'il en existe une plus récente.
   * Ouverte à tous les rôles : le bandeau s'affiche pour quiconque utilise
   * l'application.
   */
  router.get('/version', anyRole(), asyncRoute(async (req, res) => {
    res.json(await verifierMiseAJour(getDb()));
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
  const registre = (chemin, noms, colonnes, lecture) => {
    router.get(chemin, adminOrAccountant(), asyncRoute(async (req, res) => {
      const periode = validerPeriode(req.query);
      const langue = langueDuFichier(req);
      const lignes = await lecture(getDb(), periode);

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${nomFichier(noms[langue], periode, langue)}"`);
      res.send(versCSV(colonnes, lignesDansLaLangue(lignes, langue), langue));
    }));
  };

  /** La balance âgée s'exporte comme les registres, sans filtre de période. */
  router.get('/rapports/export/balance-agee', adminOrAccountant(), asyncRoute(async (req, res) => {
    const langue = langueDuFichier(req);
    const balance = await getBalanceAgee(getDb());
    const lignes = [
      ...balance.clients,
      // Ligne de totaux, attendue en bas d'un tel tableau.
      { client: 'TOTAL', ...balance.totaux }
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nomFichier(FICHIERS.balance[langue])}"`);
    res.send(versCSV(COLONNES_BALANCE, lignes, langue));
  }));

  registre('/rapports/export/ventes', FICHIERS.ventes, COLONNES_VENTES, getRegistreVentes);
  registre(
    '/rapports/export/encaissements', FICHIERS.encaissements,
    COLONNES_ENCAISSEMENTS, getRegistreEncaissements
  );

  return router;
};
