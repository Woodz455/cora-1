# Plan d'Implémentation : Suite de l'application SafeQuick

Suite à l'analyse complète des documents fournis dans `safeQuick\Plan\`, voici l'état des lieux :

**Fonctionnalités déjà complétées avec succès :**
* ✅ Conformité Fiscale : Suivi des dépenses, Gestion des taxes par province, Rapports de taxes.
* ✅ Multi-utilisateurs et Rôles (Admin, Comptable, Employé).
* ✅ Multidevises (CAD / USD) avec taux de change (Option 1 du plan 2).

**Fonctionnalités restantes à implémenter :**
* 💳 Intégration de passerelles de paiement (Stripe)
* 🏦 Rapprochement bancaire (Import CSV/OFX)
* 🔄 Facturation récurrente
* 🌐 Bilinguisme parfait (Génération de PDF / Emails selon la langue du client)

Ce document propose une marche à suivre pour la prochaine étape logique, qui est souvent l'**Intégration Stripe** pour permettre à vos clients de payer en ligne rapidement. Cependant, vous avez le choix de la priorité.

## User Review Required

> [!WARNING]
> L'intégration de passerelles de paiement (Stripe) ou l'importation de relevés bancaires impliquent des données sensibles. L'intégration Stripe nécessitera la création d'un compte développeur Stripe gratuit pour obtenir des clés API de test.

## Open Questions

> [!IMPORTANT]
> Pour cette nouvelle marche à suivre, quelle fonctionnalité préférez-vous aborder en premier ?
> 1. **Intégration Stripe** (Permettre le paiement par carte de crédit avec des liens générés automatiquement)
> 2. **Rapprochement bancaire** (Importation de relevés bancaires CSV pour lier les paiements aux factures)
> 3. **Facturation récurrente** (Générer automatiquement des factures selon un cycle, ex: mensuel)
> 4. **Bilinguisme parfait** (Génération de PDFs et de courriels en Français ou Anglais selon le client)

Veuillez répondre à cette question pour valider le plan. Si vous choisissez Stripe (option 1), le plan d'action technique se trouve ci-dessous. Sinon, le plan sera adapté à votre choix.

---

## Proposed Changes (Exemple pour l'Option 1 : Intégration Stripe)

Si nous procédons avec l'intégration Stripe (Option 1), voici la marche à suivre technique :

### Composants Base de Données

#### [MODIFY] database.js
- Ajouter les colonnes `stripe_secret_key` et `stripe_public_key` dans la table `settings` pour enregistrer la configuration de l'utilisateur.
- Ajouter les colonnes `stripe_session_id` et `payment_url` dans la table `factures` pour stocker le lien unique de chaque facture.

### API & Serveur (Backend)

#### [NEW] stripeService.js
- Fichier dédié à l'intégration du SDK `stripe` pour Node.js.
- Fonction `createPaymentLink(facture, client)` : Crée une session de paiement Stripe (Payment Link/Checkout) avec les détails de la facture et retourne l'URL.

#### [MODIFY] server.js
- **Paramètres :** Routes pour lire et sauvegarder les clés API Stripe de l'entreprise.
- **Factures :** Nouvelle route `POST /api/factures/:id/payment-link` pour déclencher la création du lien Stripe.
- **Courriels :** Modifier la logique d'envoi de courriel pour inclure un bouton "Payer en ligne" avec l'URL Stripe si celle-ci a été générée.
- **Webhooks [Optionnel pour la v1] :** Ajouter un point de terminaison webhook pour que Stripe notifie le logiciel quand une facture est payée (afin de changer son statut localement).

### Interface Utilisateur (React)

#### [MODIFY] client/src/components/Settings.jsx
- Ajouter une nouvelle section ou un onglet "Paiements en ligne".
- Champs pour entrer la **Clé Publique** et la **Clé Secrète** Stripe, avec bouton de sauvegarde.

#### [MODIFY] client/src/components/InvoiceModal.jsx (ou composant de gestion de facture)
- Dans la vue détaillée d'une facture, ajouter un bouton "Activer le paiement en ligne".
- Une fois activé, afficher le lien Stripe généré pour que l'utilisateur puisse le copier manuellement ou l'envoyer automatiquement par courriel.

## Verification Plan

### Automated Tests
- N/A (Tests manuels via le mode Test de Stripe).

### Manual Verification
1. S'inscrire sur Stripe (mode Test).
2. Entrer les clés API dans les `Settings` de SafeQuick.
3. Créer une facture pour un client.
4. Cliquer sur "Activer le paiement en ligne".
5. Ouvrir le lien généré dans un navigateur privé, et simuler un paiement avec une carte de test Stripe.
6. (Si webhook implémenté) Vérifier que la facture est automatiquement marquée comme "Payée" dans SafeQuick.
