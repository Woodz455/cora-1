# Analyse de l'application SafeQuick (Clora)

Ce document présente une analyse des fonctionnalités actuelles de l'application et une projection des besoins futurs pour positionner ce logiciel comme une solution professionnelle pour les petites et moyennes entreprises (PME) au Canada.

## 1. Besoins utilisateurs actuellement satisfaits

En analysant la structure de la base de données, l'interface (`App.jsx`) et l'API backend, voici les besoins auxquels l'application répond déjà :

* **Gestion Commerciale de base (CRM) :** 
  * Création et gestion d'un répertoire de clients avec leurs coordonnées (nom, adresse, courriel, langue).
* **Processus de Vente complet :**
  * **Devis :** Création d'estimations, définition de périodes de validité et conversion simple d'un devis en facture.
  * **Facturation :** Création de factures détaillées (lignes, quantités, prix unitaire), définition des dates d'émission et d'échéance.
  * **Catalogue :** Gestion d'une liste de produits ou services standardisés pour accélérer la création des devis et factures.
* **Gestion Financière et Trésorerie :**
  * **Suivi des paiements :** Enregistrement de paiements complets ou partiels, et calcul automatique des soldes restants.
  * **Rapports / Tableau de bord :** Vue d'ensemble sur les revenus, factures en attente et soldes impayés.
  * **Taxes :** Gestion de deux paliers de taxes modifiables (par défaut TPS à 5% et TVQ à 9.975%).
* **Communication et Branding :**
  * Envoi direct par courriel des documents au format PDF.
  * Personnalisation de l'image de marque (logo, coordonnées de l'entreprise, instructions de paiement).
* **Accessibilité :**
  * Application de bureau (Electron) offrant une expérience logicielle native, avec mode sombre intégré.

---

## 2. Besoins utilisateurs à développer pour une PME canadienne professionnelle

Pour concurrencer des outils établis (comme QuickBooks, FreshBooks ou Wave) sur le marché canadien, l'application devrait idéalement couvrir les besoins suivants :

### A. Conformité Fiscale et Comptabilité Canadienne
* **Gestion provinciale intelligente des taxes :** Au Canada, les taxes varient par province (TPS/TVQ au Québec, TVH en Ontario, TPS/TVP en C.-B., etc.). L'application devrait appliquer automatiquement le bon taux selon la province du client, plutôt que de dépendre de taux globaux fixés dans les paramètres.
* **Rapports de Remise de Taxes :** Un rapport clé en main permettant de calculer exactement combien de TPS/TVQ/TVH l'entreprise doit remettre à l'ARC (Agence du revenu du Canada) et à Revenu Québec sur une période donnée.
* **Suivi des Dépenses (CTI/RTI) :** Actuellement, l'application ne gère que les revenus. Une PME a besoin de consigner ses dépenses d'affaires pour calculer son bénéfice net et récupérer les taxes payées sur ses achats.

### B. Paiements et Finances
* **Intégration de passerelles de paiement :** Permettre au client de payer sa facture directement en ligne via un bouton dans le PDF ou l'email (intégration avec Stripe, Square ou PayPal).
* **Multidevises (CAD / USD) :** De nombreuses PME canadiennes facturent des clients américains en dollars US. Le système doit pouvoir gérer des taux de change et afficher le total dans la devise appropriée.
* **Rapprochement bancaire :** Possibilité d'importer ses transactions bancaires ou de se connecter à sa banque canadienne pour automatiser l'association des paiements aux factures.

### C. Gestion Opérationnelle
* **Facturation récurrente :** Pour les PME offrant des services continus, générer automatiquement des factures mensuelles ou annuelles.
* **Bilinguisme parfait (Français / Anglais) :** Bien qu'un champ `langue` existe pour le client, un logiciel canadien pro doit générer les PDF et les emails de manière fluide dans les deux langues officielles selon la préférence du client.
* **Multi-utilisateurs et Rôles :** Permettre l'accès à un comptable (lecture seule/rapports) ou à des employés (création de devis mais sans accès aux rapports financiers globaux).

---

> [!TIP]
> **Priorité d'implémentation suggérée :** Pour une évolution rapide vers le marché pro, l'ajout du **suivi des dépenses**, des **rapports de taxes (pour l'ARC/Revenu Québec)** et d'une gestion intelligente des **taxes par province** seraient les atouts les plus impactants.
