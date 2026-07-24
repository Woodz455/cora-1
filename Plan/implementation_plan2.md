# Plan d'Implémentation : Paiements et Finances (Étape 3)

Nous entamons maintenant la section **B. Paiements et Finances**. Cette section comprend trois fonctionnalités majeures qui transformeront la façon dont les transactions sont gérées. 

Étant donné l'ampleur de ces fonctionnalités, il est recommandé de les implémenter une à la fois. Voici un aperçu de l'approche technique pour chacune d'elles.

## User Review Required

Veuillez lire les propositions ci-dessous et répondre à la question dans la section **Open Questions** pour nous indiquer par quelle fonctionnalité vous souhaitez commencer.

---

### Option 1 : Multidevises (CAD / USD)
**L'objectif :** Facturer des clients étrangers (notamment aux États-Unis) tout en conservant une comptabilité juste en dollars canadiens (CAD) pour les impôts.
* **Base de données :** Ajout des colonnes `devise` (ex: 'CAD', 'USD') et `taux_change` dans les tables `factures` et `devis`.
* **Interface :** Ajout d'un sélecteur de devise lors de la création d'une facture. Si 'USD' est sélectionné, un champ pour entrer le taux de change actuel apparaîtra (avec possibilité de le récupérer automatiquement via une API gratuite).
* **Rapports :** Les rapports financiers et de taxes (Étape 1 et 2) convertiront automatiquement les montants USD en CAD en utilisant le `taux_change` enregistré lors de la facturation, garantissant une déclaration de revenus exacte pour l'ARC.

### Option 2 : Rapprochement bancaire (Import CSV/OFX)
**L'objectif :** Automatiser la saisie des paiements en important les relevés bancaires.
* **Base de données :** Création d'une table `transactions_bancaires` pour garder une trace des imports.
* **Interface :** Nouvelle vue "Banque" permettant de télécharger un fichier CSV (format standard des banques canadiennes : RBC, Desjardins, TD, etc.).
* **Logique :** L'application analysera le CSV, affichera les dépôts, et tentera de suggérer automatiquement un rapprochement avec une facture en attente (basé sur le montant ou le nom du client). Un clic suffira pour marquer la facture comme payée.

### Option 3 : Intégration de passerelles de paiement (Stripe)
**L'objectif :** Permettre aux clients de payer par carte de crédit via un lien cliquable dans la facture PDF ou le courriel.
* **Logique :** Puisque SafeQuick est une application de bureau locale (et non un site web public), nous utiliserons l'API **Stripe Payment Links**.
* **Fonctionnement :** Lors de l'envoi d'une facture, l'application générera un lien de paiement Stripe unique pour le montant exact. Ce lien sera inséré dans le PDF et le courriel.
* **Paramètres :** Un nouvel onglet dans les paramètres permettra d'entrer la clé API secrète de Stripe.

---

## Open Questions

> [!IMPORTANT]
> **Par quelle fonctionnalité souhaitez-vous commencer ?**
> 1. Multidevises (CAD / USD)
> 2. Rapprochement bancaire (Importation CSV)
> 3. Passerelle de paiement (Liens Stripe)

Veuillez m'indiquer votre choix pour que nous puissions planifier les détails techniques de cette intégration spécifique !
