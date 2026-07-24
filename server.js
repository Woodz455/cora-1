const express = require('express');
const cors = require('cors');
const { initDb } = require('./database.js');
const { getFacturesAvecSoldes, getSoldeFacture, addPaiement, getReportStats, createFacture, getFactureDetails, cancelFacture, updateFacture, deleteFacture, getDashboardStats } = require('./invoiceService.js');
const { getClients, createClient, updateClient } = require('./clientService.js');
const { getDevis, getDevisDetails, createDevis, updateDevis, cancelDevis, convertDevisToFacture } = require('./devisService.js');
const { getCatalogue, createCatalogueItem, updateCatalogueItem, deleteCatalogueItem } = require('./catalogueService.js');
const { sendEmailWithAttachment } = require('./emailService.js');
const { authMiddleware, requireRole } = require('./authMiddleware.js');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Augmenté pour accepter les PDF en base64
app.use(cookieParser());

// Variable globale pour stocker l'instance de la base de données
let db;

// Protection des routes de l'API (sauf auth)
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth')) return next();
  authMiddleware(req, res, next);
});

// ==========================================
// ROUTES API
// ==========================================

app.get('/api/stats', async (req, res) => {
  try {
    const stats = await getDashboardStats(db);
    res.json(stats);
  } catch (error) {
    console.error('Erreur SQL:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des statistiques' });
  }
});

/**
 * GET /api/factures
 * Retourne la liste de toutes les factures avec leur client, leur total, et leur solde restant.
 */
app.get('/api/factures', async (req, res) => {
  try {
    const factures = await getFacturesAvecSoldes(db);
    res.json(factures);
  } catch (error) {
    console.error('Erreur SQL:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des factures' });
  }
});

/**
 * GET /api/factures/:id/solde
 * Retourne les détails financiers d'une facture spécifique (total, payé, solde).
 */
app.get('/api/factures/:id/solde', async (req, res) => {
  try {
    const factureId = parseInt(req.params.id, 10);
    const facture = await getSoldeFacture(db, factureId);

    if (!facture) {
      return res.status(404).json({ error: 'Facture non trouvée' });
    }

    res.json(facture);
  } catch (error) {
    console.error('Erreur SQL:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération du solde de la facture' });
  }
});

/**
 * GET /api/factures/:id/details
 * Retourne tous les détails d'une facture (lignes, client) pour l'impression.
 */
app.get('/api/factures/:id/details', async (req, res) => {
  try {
    const factureId = parseInt(req.params.id, 10);
    const details = await getFactureDetails(db, factureId);
    if (!details) {
      return res.status(404).json({ error: 'Facture non trouvée' });
    }
    res.json(details);
  } catch (error) {
    console.error('Erreur SQL:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des détails de la facture' });
  }
});

/**
 * POST /api/factures/:id/paiements
 * Ajoute un nouveau paiement pour une facture.
 * Body attendu : { "montant": 500, "note": "Virement", "date_paiement": "2026-06-08" }
 */
app.post('/api/factures/:id/paiements', async (req, res) => {
  try {
    const factureId = parseInt(req.params.id, 10);
    const { montant, note, date_paiement } = req.body;

    if (!montant || isNaN(montant) || montant <= 0) {
      return res.status(400).json({ error: 'Montant invalide.' });
    }

    // Ajoute le paiement et récupère le nouveau solde mis à jour
    const updatedFacture = await addPaiement(db, factureId, parseFloat(montant), note || '', date_paiement);

    res.json({
      message: 'Paiement ajouté avec succès',
      facture: updatedFacture
    });
  } catch (error) {
    console.error('Erreur SQL:', error);
    res.status(500).json({ error: "Erreur lors de l'ajout du paiement" });
  }
});

/**
 * POST /api/factures
 * Crée une nouvelle facture avec ses lignes
 */
/**
 * GET /api/settings
 * Retourne la configuration de l'entreprise.
 */
app.get('/api/settings', requireRole(['admin']), async (req, res) => {
  try {
    const settings = await db.get('SELECT * FROM settings LIMIT 1');
    res.json(settings || {});
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la récupération des paramètres' });
  }
});

/**
 * PUT /api/settings
 * Met à jour la configuration de l'entreprise.
 */
app.put('/api/settings', requireRole(['admin']), async (req, res) => {
  try {
    const { entreprise_nom, entreprise_adresse, entreprise_email, taxe_1_nom, taxe_1_taux, taxe_1_numero, taxe_2_nom, taxe_2_taux, taxe_2_numero, payment_instructions, entreprise_logo } = req.body;
    await db.run(
      `UPDATE settings SET 
        entreprise_nom = ?, 
        entreprise_adresse = ?, 
        entreprise_email = ?,
        taxe_1_nom = ?,
        taxe_1_taux = ?,
        taxe_1_numero = ?,
        taxe_2_nom = ?,
        taxe_2_taux = ?,
        taxe_2_numero = ?,
        payment_instructions = ?,
        entreprise_logo = ?
       WHERE id = (SELECT id FROM settings LIMIT 1)`,
      [entreprise_nom, entreprise_adresse, entreprise_email, taxe_1_nom, taxe_1_taux, taxe_1_numero, taxe_2_nom, taxe_2_taux, taxe_2_numero, payment_instructions, entreprise_logo]
    );
    res.json({ message: 'Paramètres mis à jour' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la mise à jour des paramètres' });
  }
});

app.post('/api/factures', async (req, res) => {
  try {
    const { client_id, date_emission, date_echeance, lignes, devise, taux_change } = req.body;

    if (!client_id || !date_emission || !date_echeance || !lignes || lignes.length === 0) {
      return res.status(400).json({ error: 'Données incomplètes pour créer la facture.' });
    }

    const newFacture = await createFacture(db, { client_id, date_emission, date_echeance, devise, taux_change }, lignes);
    res.status(201).json({ message: 'Facture créée avec succès', facture: newFacture });
  } catch (error) {
    console.error('Erreur SQL:', error);
    res.status(500).json({ error: 'Erreur lors de la création de la facture' });
  }
});

/**
 * PUT /api/factures/:id/cancel
 * Annule une facture (uniquement si En attente)
 */
app.put('/api/factures/:id/cancel', async (req, res) => {
  try {
    const result = await cancelFacture(db, req.params.id);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * PUT /api/factures/:id
 * Modifie une facture (uniquement si En attente)
 */
app.put('/api/factures/:id', async (req, res) => {
  try {
    const { client_id, date_echeance, lignes, devise, taux_change } = req.body;
    const facture = await updateFacture(db, req.params.id, { client_id, date_echeance, devise, taux_change }, lignes);
    res.json(facture);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * Supprime une facture
 */
app.delete('/api/factures/:id', async (req, res) => {
  try {
    const result = await deleteFacture(db, req.params.id);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ==========================================
// ROUTES AUTHENTIFICATION
// ==========================================
const bcrypt = require('bcryptjs');

const getJwtSecret = () => process.env.JWT_SECRET || 'safequick_local_secret_key_2026';

app.get('/api/auth/setup-status', async (req, res) => {
  try {
    const adminUser = await db.get('SELECT id FROM users WHERE role = "admin" LIMIT 1');
    const setupRequired = !adminUser;
    res.json({ setupRequired });
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/auth/setup', async (req, res) => {
  try {
    const { username, password } = req.body;
    const adminUser = await db.get('SELECT id FROM users WHERE role = "admin" LIMIT 1');

    if (adminUser) {
      return res.status(400).json({ error: 'Un compte administrateur a déjà été configuré.' });
    }

    if (!username || !password || password.length < 4) {
      return res.status(400).json({ error: 'Nom d\'utilisateur et mot de passe (min 4 caractères) requis.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await db.run(
      'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
      [username, hashedPassword, 'admin']
    );

    const token = jwt.sign({ username, role: 'admin' }, getJwtSecret(), { expiresIn: '12h' });
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 12 * 60 * 60 * 1000
    });
    res.json({ success: true, message: 'Compte configuré avec succès' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la configuration' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);

    if (!user) {
      return res.status(401).json({ success: false, error: 'Identifiants invalides' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Identifiants invalides' });
    }

    const token = jwt.sign({ username: user.username, role: user.role }, getJwtSecret(), { expiresIn: '12h' });
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 12 * 60 * 60 * 1000
    });
    res.json({ success: true, message: 'Connexion réussie' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Erreur de connexion' });
  }
});

app.put('/api/auth/credentials', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newUsername, newPassword } = req.body;
    const user = await db.get('SELECT password FROM users WHERE username = ?', [req.user.username]);

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
    }

    if (!newUsername || !newPassword || newPassword.length < 4) {
      return res.status(400).json({ error: 'Nouveau nom d\'utilisateur et mot de passe (min 4 caractères) requis' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await db.run(
      'UPDATE users SET username = ?, password = ? WHERE username = ?',
      [newUsername, hashedPassword, req.user.username]
    );

    // Clear cookie to force re-login
    res.clearCookie('token');

    res.json({ success: true, message: 'Identifiants mis à jour avec succès' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la mise à jour des identifiants' });
  }
});

app.get('/api/auth/check', authMiddleware, (req, res) => {
  res.json({ authenticated: true, role: req.user.role, username: req.user.username });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true, message: 'Déconnecté' });
});

// ==========================================
// ROUTES UTILISATEURS
// ==========================================

app.get('/api/users', requireRole(['admin']), async (req, res) => {
  try {
    const users = await db.all('SELECT id, username, role FROM users');
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la récupération des utilisateurs' });
  }
});

app.post('/api/users', requireRole(['admin']), async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password || password.length < 4) {
      return res.status(400).json({ error: 'Nom d\'utilisateur et mot de passe (min 4 caractères) requis.' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await db.run(
      'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
      [username, hashedPassword, role || 'employe']
    );
    res.status(201).json({ id: result.lastID, username, role: role || 'employe' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la création de l\'utilisateur (le nom existe peut-être déjà)' });
  }
});

app.put('/api/users/:id', requireRole(['admin']), async (req, res) => {
  try {
    const { username, role, password } = req.body;
    let query = 'UPDATE users SET username = ?, role = ? WHERE id = ?';
    let params = [username, role, req.params.id];

    if (password) {
      if (password.length < 4) return res.status(400).json({ error: 'Mot de passe trop court.' });
      const hashedPassword = await bcrypt.hash(password, 10);
      query = 'UPDATE users SET username = ?, role = ?, password = ? WHERE id = ?';
      params = [username, role, hashedPassword, req.params.id];
    }

    await db.run(query, params);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la modification de l\'utilisateur' });
  }
});

app.delete('/api/users/:id', requireRole(['admin']), async (req, res) => {
  try {
    const userToDelete = await db.get('SELECT role FROM users WHERE id = ?', [req.params.id]);
    if (userToDelete && userToDelete.role === 'admin') {
      const adminCount = await db.get('SELECT COUNT(*) as count FROM users WHERE role = "admin"');
      if (adminCount.count <= 1) {
        return res.status(400).json({ error: 'Impossible de supprimer le dernier administrateur.' });
      }
    }
    await db.run('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la suppression de l\'utilisateur' });
  }
});

// ==========================================
// ROUTES CATALOGUE
// ==========================================

app.get('/api/catalogue', async (req, res) => {
  try {
    const items = await getCatalogue(db);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/catalogue', async (req, res) => {
  try {
    const newItem = await createCatalogueItem(db, req.body);
    res.json(newItem);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/catalogue/:id', async (req, res) => {
  try {
    const updatedItem = await updateCatalogueItem(db, req.params.id, req.body);
    res.json(updatedItem);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/catalogue/:id', async (req, res) => {
  try {
    await deleteCatalogueItem(db, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// ROUTES PARAMÈTRES
// ==========================================

// ==========================================
// ROUTES DEPENSES
// ==========================================

const { getExpenses, createExpense, updateExpense, deleteExpense } = require('./expenseService.js');

app.get('/api/depenses', requireRole(['admin', 'comptable']), async (req, res) => {
  try {
    const depenses = await getExpenses(db);
    res.json(depenses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/depenses', requireRole(['admin', 'comptable']), async (req, res) => {
  try {
    const newDepense = await createExpense(db, req.body);
    res.json(newDepense);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/depenses/:id', requireRole(['admin', 'comptable']), async (req, res) => {
  try {
    const updatedDepense = await updateExpense(db, req.params.id, req.body);
    res.json(updatedDepense);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/depenses/:id', requireRole(['admin', 'comptable']), async (req, res) => {
  try {
    await deleteExpense(db, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// ROUTES ABONNEMENTS (FACTURATION RÉCURRENTE)
// ==========================================
const { getSubscriptions, createSubscription, updateSubscription, deleteSubscription } = require('./subscriptionService.js');

app.get('/api/abonnements', requireRole(['admin', 'comptable', 'employe']), async (req, res) => {
  try {
    const subs = await getSubscriptions(db);
    res.json(subs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/abonnements', requireRole(['admin', 'comptable']), async (req, res) => {
  try {
    const sub = await createSubscription(db, req.body);
    res.status(201).json(sub);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/abonnements/:id', requireRole(['admin', 'comptable']), async (req, res) => {
  try {
    const sub = await updateSubscription(db, req.params.id, req.body);
    res.json(sub);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/abonnements/:id', requireRole(['admin', 'comptable']), async (req, res) => {
  try {
    await deleteSubscription(db, req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// ROUTES BANQUE (RAPPROCHEMENT)
// ==========================================

app.post('/api/banque/import', requireRole(['admin', 'comptable']), async (req, res) => {
  try {
    const transactions = req.body;
    if (!Array.isArray(transactions)) {
      return res.status(400).json({ error: 'Le corps de la requête doit être un tableau.' });
    }

    let insertedCount = 0;
    // On peut utiliser une transaction SQLite pour optimiser
    await db.run('BEGIN TRANSACTION');
    for (const t of transactions) {
      if (parseFloat(t.montant) > 0) { // Uniquement les dépôts
        await db.run(
          'INSERT INTO transactions_bancaires (date_transaction, description, montant, statut) VALUES (?, ?, ?, ?)',
          [t.date_transaction, t.description, parseFloat(t.montant), 'En attente']
        );
        insertedCount++;
      }
    }
    await db.run('COMMIT');
    res.json({ success: true, inserted: insertedCount });
  } catch (error) {
    await db.run('ROLLBACK');
    console.error('Erreur SQL (import banque):', error);
    res.status(500).json({ error: 'Erreur lors de l\'importation des transactions' });
  }
});

app.get('/api/banque/transactions', requireRole(['admin', 'comptable']), async (req, res) => {
  try {
    const status = req.query.status || 'En attente';
    const transactions = await db.all('SELECT * FROM transactions_bancaires WHERE statut = ? ORDER BY date_transaction DESC', [status]);
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la récupération des transactions' });
  }
});

app.post('/api/banque/rapprocher/:id', requireRole(['admin', 'comptable']), async (req, res) => {
  try {
    const transactionId = parseInt(req.params.id, 10);
    const { facture_id } = req.body;

    if (!facture_id) return res.status(400).json({ error: 'facture_id est requis.' });

    const transaction = await db.get('SELECT * FROM transactions_bancaires WHERE id = ?', [transactionId]);
    if (!transaction) return res.status(404).json({ error: 'Transaction non trouvée.' });
    if (transaction.statut !== 'En attente') return res.status(400).json({ error: 'Cette transaction est déjà traitée.' });

    // Mettre à jour la transaction
    await db.run('UPDATE transactions_bancaires SET statut = ?, facture_id = ? WHERE id = ?', ['Rapproché', facture_id, transactionId]);

    // Insérer le paiement
    const { addPaiement } = require('./invoiceService.js');
    await addPaiement(db, facture_id, transaction.montant, 'Rapprochement bancaire: ' + transaction.description, transaction.date_transaction);

    res.json({ success: true, message: 'Transaction rapprochée avec succès' });
  } catch (error) {
    console.error('Erreur SQL (rapprochement):', error);
    res.status(500).json({ error: 'Erreur lors du rapprochement' });
  }
});

app.post('/api/banque/ignorer/:id', requireRole(['admin', 'comptable']), async (req, res) => {
  try {
    await db.run('UPDATE transactions_bancaires SET statut = ? WHERE id = ?', ['Ignoré', req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors du masquage de la transaction' });
  }
});

// ==========================================
// ROUTES EMAILS
// ==========================================

app.post('/api/emails/send', async (req, res) => {
  try {
    const { to, cc, subject, text, attachmentBase64, filename } = req.body;

    if (!to || !attachmentBase64) {
      return res.status(400).json({ error: 'Destinataire et fichier requis' });
    }

    await sendEmailWithAttachment({ to, cc, subject, text, attachmentBase64, filename });
    res.json({ message: 'Courriel envoyé avec succès' });
  } catch (error) {
    console.error('Erreur lors de l\'envoi du courriel:', error);
    res.status(500).json({ error: error.message || 'Erreur lors de l\'envoi du courriel' });
  }
});

app.post('/api/factures/:id/relance/marquer', async (req, res) => {
  try {
    const id = req.params.id;
    const dateRelance = new Date().toISOString().split('T')[0]; // Format YYYY-MM-DD
    await db.run(
      `UPDATE factures SET relances_envoyees = relances_envoyees + 1, date_derniere_relance = ? WHERE id = ?`,
      [dateRelance, id]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors du marquage de la relance' });
  }
});

// ==========================================
// ROUTES DEVIS
// ==========================================

app.get('/api/devis', async (req, res) => {
  try {
    const devis = await getDevis(db);
    res.json(devis);
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la récupération des devis' });
  }
});

app.get('/api/devis/:id/details', async (req, res) => {
  try {
    const devis = await getDevisDetails(db, req.params.id);
    if (!devis) return res.status(404).json({ error: 'Devis non trouvé' });
    res.json(devis);
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la récupération des détails' });
  }
});

app.post('/api/devis', async (req, res) => {
  try {
    const { client_id, date_emission, date_validite, lignes, devise, taux_change } = req.body;
    const devis = await createDevis(db, { client_id, date_emission, date_validite, devise, taux_change }, lignes);
    res.status(201).json(devis);
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la création du devis' });
  }
});

app.put('/api/devis/:id', async (req, res) => {
  try {
    const { client_id, date_validite, lignes, devise, taux_change } = req.body;
    const result = await updateDevis(db, req.params.id, { client_id, date_validite, devise, taux_change }, lignes);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/devis/:id/cancel', async (req, res) => {
  try {
    const result = await cancelDevis(db, req.params.id);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/devis/:id/convert', async (req, res) => {
  try {
    const facture = await convertDevisToFacture(db, req.params.id);
    res.status(201).json(facture);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ==========================================
// ROUTES CLIENTS & RAPPORTS
// ==========================================

/**
 * GET /api/clients
 * Retourne la liste de tous les clients.
 */
app.get('/api/clients', async (req, res) => {
  try {
    const clients = await getClients(db);
    res.json(clients);
  } catch (error) {
    console.error('Erreur SQL:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des clients' });
  }
});

/**
 * POST /api/clients
 * Ajoute un nouveau client.
 */
app.post('/api/clients', async (req, res) => {
  try {
    const { nom_entreprise, nom_contact, email, adresse, langue, province } = req.body;
    if (!nom_entreprise || !email) {
      return res.status(400).json({ error: "Le nom de l'entreprise et l'email sont requis." });
    }
    const newClient = await createClient(db, nom_entreprise, nom_contact, email, adresse, langue, province || 'QC');
    res.status(201).json({ message: 'Client créé avec succès', client: newClient });
  } catch (error) {
    console.error('Erreur SQL:', error);
    res.status(500).json({ error: 'Erreur lors de la création du client' });
  }
});

/**
 * PUT /api/clients/:id
 * Modifie un client existant.
 */
app.put('/api/clients/:id', async (req, res) => {
  try {
    const clientId = parseInt(req.params.id, 10);
    const { nom_entreprise, nom_contact, email, adresse, langue, province } = req.body;
    if (!nom_entreprise || !email) {
      return res.status(400).json({ error: "Le nom de l'entreprise et l'email sont requis." });
    }
    const updatedClient = await updateClient(db, clientId, nom_entreprise, nom_contact, email, adresse, langue, province || 'QC');
    res.json({ message: 'Client modifié avec succès', client: updatedClient });
  } catch (error) {
    console.error('Erreur SQL:', error);
    res.status(500).json({ error: 'Erreur lors de la modification du client' });
  }
});

/**
 * GET /api/rapports
 * Retourne les statistiques globales (revenu, encaissé, reste).
 */
app.get('/api/rapports', requireRole(['admin', 'comptable']), async (req, res) => {
  try {
    const stats = await getReportStats(db);
    res.json(stats);
  } catch (error) {
    console.error('Erreur SQL:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des rapports' });
  }
});

/**
 * GET /api/rapports/taxes
 * Retourne le rapport des taxes collectées.
 */
app.get('/api/rapports/taxes', requireRole(['admin', 'comptable']), async (req, res) => {
  try {
    // Requires getTaxReport from invoiceService.js, which we will implement next
    const { getTaxReport } = require('./invoiceService.js');
    const { annee, mois } = req.query; // optional filters
    const stats = await getTaxReport(db, annee, mois);
    res.json(stats);
  } catch (error) {
    console.error('Erreur SQL (rapport taxes):', error);
    res.status(500).json({ error: 'Erreur lors de la récupération du rapport de taxes' });
  }
});

// ==========================================
// DÉMARRAGE DU SERVEUR
// ==========================================

// Servir les fichiers statiques de React (si buildés)
app.use(express.static(path.join(__dirname, 'client/dist')));

// Rediriger toutes les autres requêtes (sauf /api) vers le frontend React
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(__dirname, 'client/dist/index.html'));
});

function startServer(port = PORT) {
  return new Promise((resolve, reject) => {
    initDb().then((databaseInstance) => {
      db = databaseInstance; // On stocke l'instance pour nos routes

      // Vérification des factures récurrentes au démarrage
      const { checkAndGenerateRecurringInvoices } = require('./subscriptionService.js');
      checkAndGenerateRecurringInvoices(db).catch(console.error);

      const server = app.listen(port, () => {
        const actualPort = server.address().port;
        console.log(`\n🚀 Serveur API démarré sur http://localhost:${actualPort}`);
        console.log('Vous pouvez tester les routes de calcul de soldes :');
        console.log(`- Liste de toutes les factures et soldes : http://localhost:${actualPort}/api/factures`);
        resolve({ app, server, port: actualPort });
      });

      server.on('error', reject);
    }).catch((error) => {
      console.error('Impossible de démarrer le serveur sans base de données :', error);
      reject(error);
    });
  });
}

// Si le fichier est exécuté directement
if (require.main === module) {
  startServer().catch(() => process.exit(1));
}

module.exports = { app, startServer };
