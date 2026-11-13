/**
 * Routes des dépenses et achats.
 */

const express = require('express');

const {
  getExpenses, getVehicules, createExpense, updateExpense, deleteExpense
} = require('../expenseService.js');
const { adminOrAccountant } = require('../authMiddleware.js');
const { asyncRoute, httpError } = require('../httpUtils.js');
const { parseId } = require('../validators.js');
const { journaliser, ecart, ACTIONS } = require('../auditService.js');
const {
  listerPieces, joindrePiece, retirerPiece, lirePiece, ouvrirPiece, effacerOrphelins, TAILLE_MAX
} = require('../piecesService.js');

/**
 * Le fichier arrive tel quel, sans encodage : une photo de 10 Mo en base64
 * dans du JSON en pèserait 13, et devrait passer la limite ordinaire des corps.
 * Un fichier trop gros est refusé avec un message lisible, plutôt qu'avec
 * celui, en anglais, de la bibliothèque.
 */
const lireBrut = express.raw({ type: () => true, limit: TAILLE_MAX });
const corpsBrut = (req, res, next) => lireBrut(req, res, (erreur) => (
  erreur && erreur.type === 'entity.too.large' ? next(httpError(413, 'Le fichier dépasse 15 Mo.')) : next(erreur)
));

/** Nom d'origine du fichier, transmis encodé dans un en-tête. */
function nomTransmis(req) {
  try {
    return decodeURIComponent(String(req.get('x-nom-fichier') || ''));
  } catch (e) {
    return '';
  }
}

/** Ce qui identifie une pièce dans le journal. */
const resumePiece = (p) => ({ depense_id: p.depense_id, nom: p.nom, taille: p.taille, empreinte_fichier: p.empreinte });

/** Champs d'une dépense dont un changement est consigné au journal. */
const CHAMPS_SUIVIS = [
  'fournisseur', 'description', 'date_depense', 'montant_ht', 'tps', 'tvq',
  'montant_ttc', 'categorie', 'kilometres', 'vehicule'
];

/** Ce qui identifie une dépense dans le journal, sans la recopier entière. */
const resume = (d) => ({
  fournisseur: d.fournisseur, date_depense: d.date_depense, montant_ttc: d.montant_ttc, categorie: d.categorie
});

function requireId(req) {
  const id = parseId(req.params.id);
  if (!id) throw httpError(400, 'Identifiant de dépense invalide.');
  return id;
}

module.exports = function depenseRoutes(getDb) {
  const router = express.Router();
  router.use(adminOrAccountant());

  router.get('/', asyncRoute(async (req, res) => {
    res.json(await getExpenses(getDb()));
  }));

  // Véhicules déjà employés, proposés en complétion : un acteur qui n'a qu'une
  // voiture ne doit pas la retaper à chaque trajet.
  router.get('/vehicules', asyncRoute(async (req, res) => {
    res.json(await getVehicules(getDb()));
  }));

  /**
   * Pièces justificatives. Déclarées avant `/:id`, pour que « pieces » ne soit
   * jamais pris pour un identifiant de dépense.
   */
  router.get('/pieces/:pieceId', asyncRoute(async (req, res) => {
    const id = parseId(req.params.pieceId);
    if (!id) throw httpError(400, 'Identifiant de pièce invalide.');
    const { piece, contenu } = await lirePiece(getDb(), id);
    const disposition = req.query.telecharger ? 'attachment' : 'inline';
    res.set('Content-Type', piece.type);
    res.set('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(piece.nom)}`);
    // La pièce s'affiche seule : aucun script ne doit pouvoir s'y exécuter,
    // même dans un PDF piégé reçu d'un fournisseur.
    res.set('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
    res.set('Cache-Control', 'private, no-store');
    res.send(contenu);
  }));

  router.post('/pieces/:pieceId/ouvrir', asyncRoute(async (req, res) => {
    const id = parseId(req.params.pieceId);
    if (!id) throw httpError(400, 'Identifiant de pièce invalide.');
    if (!await ouvrirPiece(getDb(), id)) {
      throw httpError(501, "Ouvrir une pièce n'est possible que dans l'application de bureau. Téléchargez-la plutôt.");
    }
    res.json({ ouverte: true });
  }));

  router.delete('/pieces/:pieceId', asyncRoute(async (req, res) => {
    const id = parseId(req.params.pieceId);
    if (!id) throw httpError(400, 'Identifiant de pièce invalide.');
    const piece = await retirerPiece(getDb(), id);
    await journaliser(getDb(), req, {
      action: ACTIONS.PIECE_RETRAIT,
      entite: 'depense',
      entite_id: piece.depense_id,
      details: { fournisseur: piece.fournisseur, ...resumePiece(piece) }
    });
    res.json({ message: 'Pièce retirée.' });
  }));

  router.get('/:id/pieces', asyncRoute(async (req, res) => {
    res.json(await listerPieces(getDb(), requireId(req)));
  }));

  router.post('/:id/pieces', corpsBrut, asyncRoute(async (req, res) => {
    const id = requireId(req);
    const piece = await joindrePiece(getDb(), id, {
      nom: nomTransmis(req),
      contenu: Buffer.isBuffer(req.body) ? req.body : null,
      utilisateur: req.user && req.user.username
    });
    await journaliser(getDb(), req, {
      action: ACTIONS.PIECE_AJOUT, entite: 'depense', entite_id: id, details: resumePiece(piece)
    });
    res.status(201).json(piece);
  }));

  router.post('/', asyncRoute(async (req, res) => {
    const creee = await createExpense(getDb(), req.body);
    await journaliser(getDb(), req, {
      action: ACTIONS.DEPENSE_CREATION, entite: 'depense', entite_id: creee.id, details: resume(creee)
    });
    res.status(201).json(creee);
  }));

  router.put('/:id', asyncRoute(async (req, res) => {
    const id = requireId(req);
    const avant = await getDb().get('SELECT * FROM depenses WHERE id = ?', [id]);
    const modifiee = await updateExpense(getDb(), id, req.body);

    const changements = ecart(avant, modifiee, CHAMPS_SUIVIS);
    if (changements) {
      await journaliser(getDb(), req, {
        action: ACTIONS.DEPENSE_MODIFICATION,
        entite: 'depense',
        entite_id: id,
        details: { fournisseur: modifiee.fournisseur, changements }
      });
    }
    res.json(modifiee);
  }));

  router.delete('/:id', asyncRoute(async (req, res) => {
    const id = requireId(req);
    // Lue avant d'être effacée : le journal est tout ce qu'il en restera.
    const avant = await getDb().get('SELECT * FROM depenses WHERE id = ?', [id]);
    const pieces = avant ? await listerPieces(getDb(), id) : [];
    const resultat = await deleteExpense(getDb(), id);
    // Ses pièces partent avec elle ; leurs fichiers aussi, s'ils ne servent
    // plus ailleurs. Le dossier de sauvegarde garde ses exemplaires.
    await effacerOrphelins(getDb(), pieces.map((p) => p.empreinte));
    await journaliser(getDb(), req, {
      action: ACTIONS.DEPENSE_SUPPRESSION,
      entite: 'depense',
      entite_id: id,
      details: {
        ...resume(avant), description: avant.description, montant_ht: avant.montant_ht, tps: avant.tps, tvq: avant.tvq,
        ...(pieces.length ? { pieces: pieces.map((p) => p.nom) } : {})
      }
    });
    res.json(resultat);
  }));

  return router;
};
