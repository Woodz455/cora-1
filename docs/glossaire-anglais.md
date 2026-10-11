# Glossaire anglais de Clora

*Le vocabulaire de l'interface anglaise. Anglais canadien des affaires.*

Ce glossaire fixe la traduction des termes qui reviennent d'un écran à l'autre.
Sans lui, « devis » deviendrait *quote* sur un écran et *estimate* sur le
suivant, et l'utilisateur se demanderait s'il s'agit de deux choses.

Les traductions de l'interface vivent dans `client/src/traductions/en.js`, et
celles des messages du serveur dans `traductionServeur.js`. Ce fichier n'est
pas lu par le programme : il sert à les écrire.

## Les choix

**L'orthographe canadienne.** *Catalogue*, *cheque*, *licence* (le nom),
*cancelled*. C'est l'orthographe de l'Agence du revenu du Canada, et celle
qu'attend un client canadien.

**Le vocabulaire des PME, pas celui des comptables.** *Payment received* plutôt
que *receipt*, *Bank reconciliation* parce que le terme est le même partout.

**Les noms des taxes sont ceux de l'ARC.** GST, QST, HST, PST, jamais traduits
mot à mot.

## Les termes

| Français | Anglais | Remarque |
| --- | --- | --- |
| Tableau de bord | Dashboard | |
| Facture | Invoice | |
| Devis, soumission | Quote | Les deux mots désignent la même pièce en français ; un seul en anglais. |
| Note de crédit | Credit note | *Credit memo* est américain. |
| Client | Client | *Customer* évoque le commerce de détail, que Clora ne sert pas. |
| Catalogue | Catalogue | Orthographe canadienne. |
| Abonnement | Subscription | |
| Facturation récurrente | Recurring billing | |
| Encaissement | Payment received | |
| Acompte | Partial payment | *Deposit* se confondrait avec un dépôt bancaire. |
| Solde dû | Balance due | |
| Échéance | Due date | |
| Échue | Overdue | |
| Relance | Reminder | |
| Dépense | Expense | |
| Déplacement, kilométrage | Trip, mileage | Kilomètres dans l'interface, jamais *miles*. |
| Indemnité kilométrique | Mileage allowance | |
| Rapprochement bancaire | Bank reconciliation | |
| Relevé bancaire | Bank statement | |
| Balance âgée | Aged receivables | |
| Compte rendu de gestion | Management report | |
| Journal d'audit | Audit log | |
| Paramètres | Settings | |
| Dossier (d'entreprise) | Company file | Le terme de QuickBooks Desktop, connu des comptables. |
| Profil du dossier | Business profile | |
| Premiers pas | Getting started | |
| Administrateur, comptable, employé | Admin, accountant, employee | |
| Sauvegarde | Backup | |
| Restauration | Restore | |
| Licence, maintenance annuelle | Licence, annual maintenance | *Licence* est le nom en anglais canadien ; *license*, le verbe. |
| Période d'essai | Trial period | |
| TPS, TVQ, TVH, TVP | GST, QST, HST, PST | |
| Numéro d'inscription (taxes) | Registration number | |
| Hors taxes | Before tax | |
| Paiement en ligne | Online payment | |
| Lien de paiement | Payment link | |
| Mode test | Test mode | |
| Se connecter, se déconnecter | Sign in, sign out | Plutôt que *log in*, comme Microsoft et l'ARC. |

## Ce qui ne se traduit pas

- **Les données de l'utilisateur** : noms de clients, descriptions de lignes,
  catégories qu'il a créées.
- **Les noms propres** : Clora, Safehill, Stripe, Interac.
- **Les numéros de documents** : `SHT-202609-0001` reste tel quel.
