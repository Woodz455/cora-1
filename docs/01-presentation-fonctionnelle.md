# Clora : ce que fait l'application

*Document de présentation fonctionnelle. Version 1.6.0, septembre 2026.*

Ce document décrit ce que Clora fait, du point de vue de la personne qui s'en
sert. Il ne suppose aucune connaissance technique. Pour l'architecture, la
sécurité et le modèle de licence, voir
[02-architecture-technique.md](02-architecture-technique.md).

---

## 1. En une page

**Clora est un logiciel de facturation installé sur le poste de travail**,
destiné aux petites et moyennes entreprises canadiennes. Il émet des devis et
des factures conformes aux taxes de chaque province, suit les encaissements,
relance les retards, rapproche les dépôts bancaires et produit les registres que
réclame le comptable.

Trois caractéristiques le distinguent :

**Les données ne quittent pas la machine.** Il n'y a pas de serveur, pas de
compte à créer, pas d'abonnement mensuel. La comptabilité vit dans un fichier
sur le disque de l'entreprise. Le seul appel sortant de l'application est la
vérification quotidienne des mises à jour, et il se coupe dans les paramètres.

**Il s'achète une fois.** Licence perpétuelle, avec une maintenance annuelle
facultative qui donne droit aux versions publiées pendant qu'elle court. Le
client qui cesse de payer la maintenance garde son logiciel et ses données pour
toujours.

**Il est écrit pour le Canada.** TPS, TVQ, TVH, TVP selon la province du client ;
factures bilingues ; registres exportés au format qu'attend l'Excel
francophone ; conditions de paiement Net 15/30/60.

---

## 2. À qui il s'adresse

**Le critère n'est pas le secteur, c'est le modèle de facturation.** Clora
convient à toute entreprise qui **facture des clients nommés, à terme**, plutôt
que d'encaisser au comptoir.

### Les trois questions qui décident

**Facturez-vous des clients nommés, ou vendez-vous à un inconnu au comptoir ?**
C'est la question déterminante. Une fiche client exige un nom et une adresse
courriel : une vente sans client identifié n'existe pas dans Clora.

**Vendez-vous du temps et des services, ou de la marchandise dont il faut suivre
le stock ?** Le catalogue enregistre un libellé, une description et un prix.
Rien n'y compte ce qui reste en inventaire.

**Combien de documents par mois ?** Clora est bâti pour des dizaines à quelques
centaines de factures mensuelles, pas pour des milliers de transactions
quotidiennes.

### Là où Clora est à sa place

| Profil | Ce qu'il y trouve |
| --- | --- |
| **Métiers de service** (plomberie, électricité, entretien, installation) | Devis, factures, relances, suivi des encaissements |
| **Agences, cabinets-conseils, pigistes** | Facturation au projet ou à l'heure, devis convertibles, catalogue de prestations |
| **Services professionnels** (comptabilité, droit, traduction, design, formation) | Termes de paiement, relances, registres pour la fin d'année |
| **Startup B2B sous contrat** | Facturation récurrente mensuelle ou annuelle, paiement en ligne par carte ou débit préautorisé |
| **Gestion immobilière** | Un loyer est une facture récurrente |
| **Grossiste vendant à des entreprises** | Multidevises, termes Net 30/60, à condition de suivre le stock ailleurs |
| **PME avec un employé de bureau** | Trois niveaux d'accès : l'employé facture, le comptable encaisse, l'administrateur paramètre |
| **Comptable indépendant** | Plusieurs dossiers d'entreprise dans une même installation, chacun dans son fichier séparé |
| **Entreprise soucieuse de confidentialité** | Aucune donnée dans le nuage, aucun tiers hébergeur |

### Là où Clora n'est pas à sa place

**Le commerce de détail.** Un détaillant vend à un inconnu, au comptant, au
comptoir. Chaque vente exigerait ici de créer une fiche client puis une facture :
à deux cents ventes par jour, c'est inutilisable. Il n'y a par ailleurs ni
caisse, ni lecteur de codes-barres, ni terminal de paiement : les liens de
paiement sont conçus pour être envoyés par courriel, non présentés à un client
debout devant vous.

*L'exception :* un détaillant qui approvisionne aussi des entreprises sur compte
peut se servir de Clora **pour cette activité-là seulement**.

**Le commerce en ligne.** Ni panier, ni gestion de commandes, ni stock.

**L'abonnement grand public en libre-service.** Des milliers d'abonnés qui
s'inscrivent seuls par carte demandent une inscription autonome, un portail
client et une relance automatisée des paiements échoués. La facturation
récurrente de Clora génère des factures à partir d'une liste que vous tenez
vous-même.

### La limite qui vaut pour tous

Clora suppose **un poste de travail Windows**. Ce n'est pas une application web
ni mobile, et deux postes ne partagent pas la même comptabilité en simultané :
les trois rôles existent, mais on se relaie sur la même machine.

C'est ce point, plus que le secteur d'activité, qui décide si une entreprise en
croissance restera à l'aise dans Clora.

---

## 3. Les onze écrans

L'application se parcourt par un menu latéral. Ce que chacun voit dépend de son
rôle : un employé n'a pas les écrans financiers.

### Tableau de bord
*Accessible à tous*

Aperçu chiffré : chiffre d'affaires, montant encaissé, reste à percevoir,
montant en retard. Chaque chiffre est cliquable et ouvre la liste des factures
correspondantes : le montant en retard mène aux factures en retard, pas à la
liste complète.

Graphiques d'évolution mensuelle du revenu et répartition par client.

**Pour commencer.** Tant qu'il reste quelque chose à régler, l'administrateur
voit en tête du tableau une liste de premiers pas, dans l'ordre que le profil du
dossier suggère : coordonnées de l'entreprise, premier client, première
facture, puis ce qui tient au profil (le taux kilométrique pour un travailleur
autonome, les comptes de l'équipe et le relevé bancaire pour une PME, les
abonnements et le paiement en ligne pour une startup), et pour tous un dossier
de sauvegarde synchronisé. Chaque étape mène à l'écran où elle s'accomplit et
se coche d'elle-même d'après le contenu du dossier ; la liste disparaît quand
tout est fait, ou d'un clic.

### Factures
*Accessible à tous*

Le cœur de l'application. Création, modification, aperçu imprimable, envoi par
courriel avec le PDF en pièce jointe.

Une facture porte cinq états possibles :

| Statut | Signification |
| --- | --- |
| **En attente** | Émise, rien d'encaissé |
| **Partiellement payée** | Un ou plusieurs acomptes reçus |
| **Payée** | Soldée |
| **Annulée** | Retirée avant tout encaissement |
| **Créditée** | Entièrement neutralisée par des notes de crédit, sans qu'aucun argent ne soit entré |

La distinction entre *Payée* et *Créditée* n'est pas cosmétique : confondre les
deux ferait croire à une rentrée d'argent qui n'a jamais eu lieu.

Recherche, tri sur chaque colonne, pagination, filtres par statut et par période.

### Devis
*Accessible à tous*

Propositions commerciales, avec leur propre numérotation et une date de
validité. Un devis accepté se convertit en facture en un geste : les lignes sont
reprises, et l'échéance découle des conditions de paiement du client.

### Clients
*Accessible à tous*

Répertoire : entreprise, contact, courriel, adresse, **province**, qui décide
des taxes, **langue** (français ou anglais, qui décide de la langue des
documents et des relances) et **conditions de paiement**.

Import possible depuis un fichier Excel ou CSV : les colonnes se choisissent à
l'écran, un aperçu montre ce qui passera et ce qui sera refusé avec le motif,
et l'écriture est tout ou rien. Personne ne ressaisit deux cents clients à la
main.

### Catalogue
*Accessible à tous*

Les articles et services facturés couramment, avec leur prix unitaire, pour ne
pas les retaper à chaque facture. Importable depuis un tableur, comme les
clients.

> Ce n'est pas une gestion de stock : le catalogue enregistre un libellé, une
> description et un prix. Il ne compte pas les quantités disponibles.

### Abonnements : facturation récurrente
*Administrateur et comptable*

Pour un contrat d'entretien, un forfait logiciel, un loyer. Une facture est émise
automatiquement à chaque échéance, avec les lignes définies une fois pour toutes.

**Deux cycles : mensuel ou annuel.** Une échéance fixée au 31 tombe le 28 ou le
29 février, plutôt que de déborder sur mars.

La génération est vérifiée à chaque passage horaire de l'application.

### Banque : rapprochement bancaire
*Administrateur et comptable*

Le relevé bancaire s'importe au format CSV. Les colonnes de date, description et
montant sont détectées automatiquement ; seuls les dépôts sont retenus ; les
lignes déjà importées sont ignorées.

Chaque dépôt se pointe ensuite sur une ou plusieurs factures :

- **Un dépôt peut régler plusieurs factures.** Un virement global de 3 000 $
  solde d'abord une facture de 113 $, puis une autre, et reste dans la file tant
  qu'il lui demeure quelque chose à affecter.
- La colonne **Part** permet d'imputer un montant précis ; laissée vide, elle
  affecte le plus petit du reste du dépôt et du solde de la facture.
- Le statut du dépôt suit : *En attente*, *Partiellement rapproché*, *Rapproché*.
- Une facture en devise étrangère est refusée : imputer un dépôt en dollars
  canadiens sur un solde en dollars américains fausserait les deux.

L'écran propose une correspondance quand un dépôt égale exactement le solde
d'une facture, au cent près.

### Dépenses
*Administrateur et comptable*

Charges et achats : fournisseur, description, date, montant hors taxes, TPS,
TVQ, catégorie. Sert au calcul des taxes payées, à déduire de la remise.

**Les déplacements s'y inscrivent en kilomètres**, et non en dollars. On saisit
la date, le motif, le véhicule ou le mode de transport, et la distance ; le
montant en découle au taux de l'année, dégressif au-delà d'un seuil : les
premiers kilomètres à un taux, le reste à un taux moindre. Un trajet qui
enjambe le seuil est payé aux deux taux.

Les taux se règlent dans les paramètres, **une ligne par année**, et rien n'est
proposé par défaut : les autorités fiscales les révisent chaque année, et un
chiffre inscrit d'office par le logiciel finirait par être faux sans que
personne ne s'en aperçoive. Tant qu'une année n'est pas réglée, la saisie est
refusée plutôt que de produire un montant nul.

> **Deux réserves à connaître.** C'est la méthode de l'*indemnité* : elle
> convient à un employé indemnisé ou à un actionnaire qui se verse une
> allocation de sa société. Un travailleur autonome non incorporé doit
> proratiser ses coûts réels de véhicule selon son usage d'affaires, et le montant
> calculé ici n'est alors qu'une estimation. Et aucune taxe récupérable n'est
> portée sur une indemnité ; un inscrit à la TPS verra avec son comptable s'il
> peut en réclamer une.

### Rapports
*Administrateur et comptable*

Cinq productions :

1. **Compte rendu de la période**, en PDF : un sommaire de gestion d'un mois,
   d'un trimestre ou d'une année, à remettre à son comptable ou à son banquier.
   Facturé, encaissé, dépenses, bénéfice, évolution mensuelle, ce qui est dû,
   principaux clients, dépenses par catégorie et taxes, précédés de points
   d'attention : retards de paiement, dépenses supérieures aux encaissements,
   dépendance à un seul client, délai d'encaissement. Chaque chiffre est pris
   sur sa propre date : les factures à l'émission, l'argent au paiement, les
   dépenses à la leur. C'est un sommaire de gestion, pas des états financiers :
   Clora ne produit ni bilan ni état des résultats.
2. **Statistiques financières** : revenu, encaissé, crédité, solde à percevoir.
3. **Balance âgée** : ce qui vous est dû, ventilé par ancienneté du retard : non
   échu, 1 à 30 jours, 31 à 60, 61 à 90, 91 et plus. Par client, puis en total.
   Exportable en CSV.
4. **Préparation de la remise de taxes**, par trimestre : taxes facturées moins
   taxes payées sur les dépenses.
5. **Deux registres pour le comptable**, en CSV :
   - *Registre des ventes* : une ligne par facture, avec chaque taxe nommée et
     chiffrée, le total, le crédité, l'encaissé, le solde, la devise et
     l'équivalent en dollars canadiens.
   - *Registre des encaissements* : une ligne par paiement reçu, avec son origine
     (saisie manuelle ou rapprochement bancaire).

Une seule période, choisie en tête de l'écran, gouverne le compte rendu, les
registres et le rapport de taxes.

Les fichiers CSV sont produits pour être ouverts sans manipulation dans un Excel
francophone : marque d'encodage UTF-8, séparateur point-virgule, virgule
décimale. Un client nommé « Ateliers Bélanger; Cie » en ressort intact.

### Journal
*Administrateur et comptable*

Qui a fait quoi, et quand. Les actions sensibles y sont consignées :
annulation d'un encaissement, annulation ou suppression d'une facture,
suppression d'une note de crédit, modification d'un client, **changement des
taux de taxe**, création ou modification d'un compte, restauration d'une
sauvegarde.

Chaque entrée porte l'horodatage, l'auteur, son rôle et l'écart constaté, sous
la forme « avant → après ». **Le journal ne peut être ni modifié ni effacé**,
pas même par l'administrateur : la base de données elle-même refuse l'opération.

Filtres par action, par auteur, par période.

### Paramètres
*Administrateur seul*

Identité de l'entreprise, logo, numéros de taxe, taux par défaut, conditions de
paiement, serveur d'envoi de courriels, relances automatiques, paiement en
ligne, sauvegardes, restauration, gestion des comptes, activation de la licence.

---

## 4. Le cycle d'une facture

```
   Devis  ──accepté──►  Facture  ──encaissement──►  Payée
                            │
                            ├── acompte ──►  Partiellement payée
                            │
                            ├── note de crédit ──►  Créditée
                            │
                            └── annulation ──►  Annulée
```

Trois règles gouvernent ce cycle, et elles ne se contournent pas :

**Les montants sont arrêtés à l'émission.** Sous-total, taxes et total sont
calculés une fois, au moment où le document est créé, puis conservés tels quels.
Une facture remise à un client garde son montant, quelles que soient les
évolutions ultérieures des taux de taxe ou des prix du catalogue.

**Une facture encaissée ne se modifie plus.** Ni modification, ni annulation, ni
suppression. Il faut lui opposer une note de crédit.

**Une note de crédit est un document à part entière.** Elle porte son propre
numéro (`NC-AAAAMM-NNNN`), sa propre date, et applique **les taux de taxe de la
facture créditée**, pas ceux du jour. Créditer en janvier une facture de l'an
dernier applique bien les taux de l'an dernier.

### Note de crédit ou annulation de paiement ?

La confusion coûte cher, alors la distinction est nette :

| | Corrige | Touche aux taxes | Cas typique |
| --- | --- | --- | --- |
| **Note de crédit** | Ce que le client **doit** | Oui | Retour de marchandise, remise accordée après coup |
| **Annulation d'un encaissement** | Ce que l'entreprise a **reçu** | Non | Chèque sans provision, montant mal saisi, dépôt pointé sur la mauvaise facture |

Créditer une facture pour rattraper un paiement mal saisi récupérerait à tort de
la taxe sur un montant jamais facturé.

Une annulation d'encaissement **n'efface jamais la ligne** : elle reste visible,
barrée, avec la date de l'annulation, son auteur et son motif. Elle est réservée
à l'administrateur. Si le paiement venait du rapprochement bancaire, le dépôt
retourne dans la file, prêt à être réaffecté.

---

## 5. Les taxes canadiennes

Les taux découlent de la **province du client**, pas de celle de l'entreprise, et
sont figés sur la facture à l'émission.

| Province | Taxes appliquées |
| --- | --- |
| Québec | TPS 5 % + TVQ 9,975 % |
| Ontario | TVH 13 % |
| Nouveau-Brunswick, Terre-Neuve, Nouvelle-Écosse, Île-du-Prince-Édouard | TVH 15 % |
| Colombie-Britannique | TPS 5 % + TVP 7 % |
| Manitoba | TPS 5 % + TVP 7 % |
| Saskatchewan | TPS 5 % + TVP 6 % |
| Alberta, Territoires du Nord-Ouest, Nunavut, Yukon | TPS 5 % |

*Taux en vigueur en 2026, définis dans le code et modifiables dans les
paramètres.*

**L'arrondi.** Chaque taxe est calculée sur le sous-total hors taxes et arrondie
au cent séparément ; le total est la somme de ces valeurs arrondies. Le
sous-total, les taxes et le total s'additionnent donc toujours : il n'arrive
jamais qu'une facture affiche des chiffres qui ne tombent pas juste.

**Les devises.** Une facture porte sa devise et le taux de change appliqué à
l'émission. Les rapports consolident tout en dollars canadiens.

---

## 6. Encaisser

Trois chemins mènent à un encaissement, et tous aboutissent au même endroit :

**À la main**, depuis la facture. Montant, date, note. Un paiement ne peut jamais
dépasser le solde restant.

**Par rapprochement bancaire**, en pointant un dépôt du relevé sur une facture.

**Par paiement en ligne**, si l'entreprise a raccordé son compte Stripe.

### Le paiement en ligne

Chaque facture peut porter un lien de paiement : le client règle **par carte ou
par débit préautorisé**, sans créer de compte. Le lien figure sur le PDF et dans
le corps du courriel. L'encaissement s'inscrit tout seul.

**L'argent ne transite jamais par Clora.** Il va directement au compte Stripe de
l'entreprise, puis à son compte bancaire. Clora fabrique le lien et relève les
règlements ; il n'est à aucun moment intermédiaire de paiement.

Quatre garanties encadrent la justesse des comptes :

- **Un lien actif au plus par facture**, portant le solde restant et non le
  total. Un acompte encaissé entre-temps retire l'ancien lien et en crée un
  juste : deux liens vivants, ce serait un client qui peut payer deux fois.
- **Un règlement inscrit une seule fois**, garanti par la base de données
  elle-même et non par la prudence du programme.
- **Seul l'argent réellement reçu est inscrit.** Un débit préautorisé met
  plusieurs jours ouvrables à se dénouer ; tant que Stripe ne le donne pas pour
  réglé, rien n'est porté aux comptes.
- **Le mode test se voit** : sur la facture, dans les paramètres, et dans la note
  de l'encaissement.

Le débit préautorisé coûte nettement moins cher que la carte sur les gros
montants. Il se demande séparément auprès de Stripe.

> Les frais de Stripe sont prélevés sur le versement, pas sur la facture :
> celle-ci est réglée en totalité. **La dépense correspondante reste à saisir à
> la main** : elle n'est pas encore reprise automatiquement.

---

## 7. Relancer

Activées dans les paramètres, les relances envoient un rappel dès qu'une facture
impayée franchit l'un des paliers de retard configurés : 7, 15 et 30 jours par
défaut.

- Un palier ne part **qu'une fois par facture**, et c'est le palier le plus élevé
  franchi qui est retenu ; jamais trois courriels d'un coup.
- Sont écartées : les factures annulées, soldées, entièrement créditées, non
  échues, et celles dont le client n'a pas d'adresse courriel.
- Le rappel reprend le solde **net des notes de crédit** et suit la **langue du
  client**.
- Chaque envoi, réussi ou en échec, est consigné. Un échec n'interrompt pas les
  suivants, et le palier reste à envoyer au prochain passage.

Le rappel automatique est un courriel texte. Pour l'envoyer avec le PDF en pièce
jointe, il faut passer par le bouton *Relancer* de la liste des factures.

L'envoi exige un serveur de courriel configuré dans les paramètres.

---

## 8. Ne pas perdre la comptabilité

L'application détient l'unique exemplaire des livres. Une copie datée est donc
produite **automatiquement, activée par défaut**.

- **Quand.** Une par jour, plus une à la fermeture de l'application : un poste
  éteint chaque soir n'atteindrait jamais l'échéance autrement.
- **Où.** Dans le dossier de données, ou tout dossier choisi dans les
  paramètres. **Viser un dossier synchronisé** (OneDrive, Dropbox, Google
  Drive) est ce qui fait sortir la copie de la machine, et donc ce qui protège
  réellement d'une panne de disque ou d'un vol.
- **Combien.** Les 30 plus récentes ; au-delà, les plus anciennes sont
  supprimées. Les fichiers étrangers au dossier ne sont jamais touchés.

**Restaurer** est réservé à l'administrateur. La sauvegarde est d'abord
contrôlée (intégrité et présence du schéma Clora) et un fichier douteux est
refusé sans que rien ne soit modifié. La base remplacée est conservée à côté :
une restauration sur le mauvais fichier reste réversible.

---

## 9. Qui peut faire quoi

| Rôle | Accès |
| --- | --- |
| **Employé** | Factures, devis, clients, catalogue |
| **Comptable** | En plus : encaissements, notes de crédit, dépenses, rapports, banque, abonnements, journal |
| **Administrateur** | Accès complet : paramètres, comptes, suppression de factures, annulation d'encaissements, restauration |

Les règles sont appliquées par le programme lui-même à chaque opération.
L'interface se contente de ne pas proposer ce qui serait de toute façon refusé :
masquer un bouton n'a jamais protégé quoi que ce soit.

Le rôle est relu à chaque action : retirer un accès à quelqu'un prend effet
immédiatement, et non à l'expiration de sa session.

---

## 10. Plusieurs entreprises dans une même installation

Un comptable qui suit vingt clients ouvre vingt dossiers. **Chaque dossier a son
propre fichier de base de données**. Ce n'est pas un filtre, c'est une
séparation physique. Il n'y a donc rien à oublier de filtrer, et aucun risque de
montrer les factures d'un client à un autre.

Les comptes d'utilisateurs, eux, sont communs : on ne se reconnecte pas en
changeant de dossier.

**Le profil du dossier.** À la création, on dit ce que l'entreprise est :
travailleur autonome, startup en démarrage ou PME établie. Ce choix règle des
valeurs de départ (les conditions de paiement proposées aux nouveaux clients :
payable sur réception pour un autonome, trente jours pour les autres) et l'ordre
des premiers pas sur le tableau de bord. **Il ne retire aucune fonction** : un
autonome qui embauche trouve les comptes d'utilisateurs là où ils sont, sans
rien débloquer. Le profil se change à tout moment dans Paramètres.

---

## 11. Mises à jour

Au premier écran suivant la connexion, et une fois par jour au plus, Clora
compare sa version à la dernière publiée. Si une version plus récente existe, un
bandeau discret le signale, avec un lien vers la page de téléchargement.

**Rien n'est téléchargé ni installé par l'application.** L'utilisateur décide,
télécharge et installe lui-même. C'est le seul appel sortant de l'application, et
il se coupe dans les paramètres.

---

## 12. Ce que Clora ne fait pas

Dire ce qu'un logiciel ne fait pas évite les mauvaises surprises après l'achat.

| | |
| --- | --- |
| **Paie et feuilles de temps** | Absent |
| **Point de vente** | Absent : ni caisse, ni lecteur de codes-barres, ni terminal de paiement |
| **Gestion de stock** | Absent : le catalogue enregistre des prix, pas des quantités |
| **Grand livre et plan comptable** | Absent : Clora produit les registres, le comptable tient les livres |
| **Production des déclarations fiscales** | Clora prépare les chiffres de la remise ; il ne remplit ni ne transmet aucun formulaire |
| **macOS et Linux** | L'installateur est produit pour Windows uniquement |
| **Application mobile ou web** | Absent |
| **Travail simultané à plusieurs postes** | Une installation, un poste |
| **Synchronisation dans le nuage** | Absent, par construction : c'est un choix, pas un manque |
| **Frais Stripe repris en dépenses** | Pas encore automatique |
| **Proration des coûts réels de véhicule** | Absente : le kilométrage applique un taux par kilomètre, méthode de l'indemnité. Un travailleur autonome non incorporé prorate ses coûts réels, calcul que Clora ne fait pas |

---

## 13. Installer

Un unique fichier `.exe`. Un double-clic installe Clora sans poser de question,
sans demande d'autorisation administrateur, et place une icône sur le bureau.
Compter deux minutes.

Au premier lancement, l'application demande de créer un compte administrateur.

> **Windows affichera « Windows a protégé votre ordinateur »** au premier
> lancement. Il faut passer par *Informations complémentaires → Exécuter quand
> même*. Cet avertissement apparaît parce que le fichier n'est pas signé par un
> certificat payant ; il ne signale aucun problème réel. Voir
> [INSTALLATION.md](../INSTALLATION.md).

---

*Clora est un logiciel de Safehill Technologies. Le code source est consultable
pour que les clients puissent vérifier ce que le logiciel fait de leurs données
comptables ; cette visibilité ne constitue pas une licence d'utilisation.*
