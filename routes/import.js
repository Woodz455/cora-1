/**
 * Import de clients et d'articles depuis un tableur.
 *
 * Deux points d'entrée pour un seul geste : `apercu` lit et valide sans rien
 * écrire, `executer` applique. Séparer les deux est ce qui permet de montrer à
 * l'utilisateur ce qui va entrer dans sa comptabilité avant que ce soit fait.
 */

const express = require('express');

const { adminOrAccountant } = require('../authMiddleware.js');
const { journaliser, ACTIONS } = require('../auditService.js');
const { asyncRoute, httpError } = require('../httpUtils.js');
const { analyser, deviner, preparer, MODELES } = require('../importService.js');

/** Taille maximale du fichier transmis, une fois décodé. */
const MAX_OCTETS = 10 * 1024 * 1024;

/** Extrait le contenu du fichier, transmis encodé en base64. */
function decoder(corps) {
  const brut = typeof corps.contenu === 'string' ? corps.contenu : '';
  const donnees = brut.includes('base64,') ? brut.slice(brut.indexOf('base64,') + 7) : brut;
  const nettoye = donnees.replace(/\s/g, '');

  if (!nettoye) throw httpError(400, 'Aucun fichier reçu.');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(nettoye)) throw httpError(400, 'Le fichier est mal formé.');
  // 4 caractères base64 encodent 3 octets.
  if ((nettoye.length * 3) / 4 > MAX_OCTETS) throw httpError(400, 'Le fichier dépasse 10 Mo.');

  return Buffer.from(nettoye, 'base64');
}

/** Vérifie le modèle demandé et rend ses champs. */
function exigerModele(valeur) {
  const modele = String(valeur || '');
  if (!MODELES[modele]) throw httpError(400, `Type d'import inconnu : ${modele}.`);
  return modele;
}

/**
 * Normalise la correspondance reçue du formulaire.
 *
 * Une colonne non associée arrive comme chaîne vide : la laisser passer ferait
 * lire la colonne 0 — le nom de l'entreprise atterrirait dans l'adresse.
 */
function normaliserCorrespondance(brute) {
  const correspondance = {};
  for (const [cle, valeur] of Object.entries(brute || {})) {
    if (valeur === '' || valeur === null || valeur === undefined) continue;
    const index = Number(valeur);
    if (Number.isInteger(index) && index >= 0) correspondance[cle] = index;
  }
  return correspondance;
}

module.exports = function importRoutes(getDb) {
  const router = express.Router();
  // Un employé n'a pas à verser deux cents fiches d'un coup dans la base.
  router.use(adminOrAccountant());

  /**
   * Lit le fichier, propose une correspondance et montre le résultat.
   *
   * Aucune écriture : c'est l'écran qui décide ensuite. Renvoyer les premières
   * lignes telles quelles permet à l'utilisateur de vérifier que ses colonnes
   * sont bien celles qu'il croit — un aperçu qui ne montre que des compteurs
   * n'apprend rien.
   */
  router.post('/apercu', asyncRoute(async (req, res) => {
    const modele = exigerModele(req.body.modele);
    const tampon = decoder(req.body);

    const { entetes, lignes } = analyser(req.body.nom_fichier, tampon);

    // Le formulaire peut déjà porter une correspondance corrigée à la main ;
    // sinon on propose la nôtre.
    const correspondance = req.body.correspondance
      ? normaliserCorrespondance(req.body.correspondance)
      : deviner(entetes, modele);

    const { valides, rejets } = preparer(modele, lignes, correspondance);

    res.json({
      entetes,
      correspondance,
      champs: MODELES[modele],
      total: lignes.length,
      apercu: lignes.slice(0, 5),
      valides: valides.length,
      // Toutes les lignes refusées, pas seulement les premières : un import où
      // trente fiches disparaissent sans qu'on sache lesquelles est inutilisable.
      rejets
    });
  }));

  /**
   * Applique l'import, dans une transaction.
   *
   * Tout ou rien : une reprise interrompue à mi-parcours laisserait une liste
   * de clients à moitié constituée, sans moyen simple de savoir où elle s'est
   * arrêtée. Mieux vaut ne rien écrire et laisser recommencer.
   */
  router.post('/executer', asyncRoute(async (req, res) => {
    const db = getDb();
    const modele = exigerModele(req.body.modele);
    const tampon = decoder(req.body);

    const { lignes } = analyser(req.body.nom_fichier, tampon);
    const correspondance = normaliserCorrespondance(req.body.correspondance);
    const { valides, rejets } = preparer(modele, lignes, correspondance);

    if (valides.length === 0) {
      throw httpError(400, "Aucune ligne de ce fichier n'est importable en l'état.");
    }

    let inseres = 0;
    let ignores = 0;

    await db.exec('BEGIN');
    try {
      for (const entree of valides) {
        if (modele === 'clients') {
          // Un client déjà présent n'est pas réécrit : un import est un ajout,
          // pas une synchronisation. Écraser une fiche enrichie à la main par
          // une ligne de tableur ferait perdre du travail.
          const existant = await db.get('SELECT id FROM clients WHERE lower(email) = lower(?)', [entree.client.email]);
          if (existant) { ignores += 1; continue; }

          const c = entree.client;
          await db.run(
            `INSERT INTO clients (nom_entreprise, nom_contact, email, adresse, langue, province, conditions_paiement)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [c.nom_entreprise, c.nom_contact, c.email, c.adresse, c.langue, c.province, c.conditions_paiement]
          );
        } else {
          const existant = await db.get('SELECT id FROM catalogue WHERE lower(nom) = lower(?)', [entree.article.nom]);
          if (existant) { ignores += 1; continue; }

          const a = entree.article;
          await db.run(
            'INSERT INTO catalogue (nom, description, prix_unitaire) VALUES (?, ?, ?)',
            [a.nom, a.description, a.prix_unitaire]
          );
        }
        inseres += 1;
      }
      await db.exec('COMMIT');
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }

    // L'import verse d'un coup des dizaines de fiches : savoir qui l'a lancé,
    // quand, et combien de lignes sont entrées vaut d'être conservé.
    await journaliser(db, req, {
      action: ACTIONS.IMPORT,
      entite: modele,
      entite_id: null,
      details: { fichier: String(req.body.nom_fichier || '').slice(0, 200), inseres, ignores, rejetes: rejets.length }
    });

    res.json({
      message: `${inseres} ${modele === 'clients' ? 'client(s)' : 'article(s)'} importé(s).`,
      inseres,
      ignores,
      rejets
    });
  }));

  return router;
};
