# Idées mises en attente

Ce document existe parce que ma mémoire ne survit pas d'une session à l'autre.
Ce qui n'est pas écrit ici est perdu.

Il rassemble les propositions examinées puis écartées, avec **la raison du
refus** et ce qu'il vaut la peine d'en garder. Le but n'est pas de les enterrer :
c'est qu'on puisse les rouvrir plus tard sans refaire l'analyse.

À relire **après la période de tests utilisateurs** en cours.

---

## 1. Réconciliateur financier hors-ligne — écarté

### La proposition, telle que reçue

Un utilitaire de bureau qui ingère **deux sources de données quelconques** — un
relevé bancaire et un grand livre, ou un export de caisse — et applique des
tolérances paramétrables :

* écarts de quelques centimes ;
* décalages de date de règlement (± 3 jours) ;
* détection des inversions de chiffres (coquilles humaines).

Cible : PME, comptables indépendants, agences gérant plusieurs passerelles de
paiement. Argument de vente : confidentialité absolue, rien ne monte au nuage.
Volume visé : 100 000 lignes.

### Ce que Clora fait déjà — relevé dans le code

Le rapprochement bancaire existe, il est hors-ligne, sur le poste, en SQLite
local. **L'argument de confidentialité est donc déjà tenu.** Mais le moteur est
plus modeste qu'il n'y paraît :

* **Aucun algorithme de correspondance dans `bankService.js`.** La seule
  suggestion vit dans `client/src/components/BankReconciliation.jsx` et tient en
  une ligne : `Math.abs(f.solde_restant - restant) < 0.01`. Un montant exact au
  cent près. Pas de fenêtre de dates, pas de score, pas de classement.
* **`MAX_LIGNES = 5000`** dans `bankService.js`.
* Le CSV est analysé **dans le navigateur** puis posté en JSON. `/api/banque`
  ne figure pas dans les exceptions de `server.js` : la limite de corps est de
  **1 Mo**.
* **Les retraits sont ignorés** (`t.montant <= 0`) : frais bancaires,
  remboursements et sorties sont hors périmètre.
* **Dollars canadiens seulement** (filtre `f.devise === 'CAD'`).
* Surtout : Clora rapproche un relevé **de ses propres factures**. Il est l'un
  des deux côtés de l'équation, pas un arbitre entre deux fichiers étrangers.

### Pourquoi c'est écarté

Ce dernier point est le nœud, et il décide de tout : **ce n'est pas le même
acheteur.**

Le client de Clora est une PME qui émet ses factures. Le client du
réconciliateur est un comptable qui rapproche des données **qu'il n'a pas
produites**, pour le compte d'un tiers. Cette personne n'achètera pas une
licence de facturation pour obtenir un écran.

S'y ajoute l'échelle : 100 000 lignes contre 5 000, avec un chemin technique
(analyse dans le navigateur → JSON → 1 Mo) qui ne tient pas à ce volume. Ce
n'est pas un réglage à changer, c'est une autre plomberie.

Enfin, le calendrier : aucune licence de Clora n'est encore vendue. Ouvrir un
second produit avant d'avoir validé le premier serait prématuré.

**Ce qui reste juste dans l'intuition des collègues :** le refus du nuage par
les départements financiers est réel — c'est exactement l'argument qui porte
déjà Clora. Ils ont raison sur l'angle, ils se trompent en croyant que c'est le
même produit.

---

## 2. Ce qu'il vaut la peine d'en tirer — à faire après les tests

Trois améliorations de la **suggestion existante**, sur un écran que les
utilisateurs voient déjà. Environ une journée de travail, sans nouveau produit :

1. **Fenêtre de dates** — ± 3 jours entre l'échéance de la facture et la date du
   dépôt, plutôt qu'aucune considération temporelle.
2. **Tolérance de montant paramétrable** — pour absorber les frais retenus par
   Stripe ou une conversion, là où seul le montant exact est aujourd'hui reconnu.
3. **Classement des candidats par proximité** — plusieurs propositions ordonnées,
   au lieu de l'unique correspondance binaire actuelle.

**Réserve mesurée :** la détection d'inversions de chiffres, brillante dans le
produit autonome, **n'a presque aucune valeur dans Clora**. Elle attrape les
coquilles humaines ; or les deux côtés du rapprochement sont ici produits par
des machines — le montant vient de la facture que le logiciel a calculée, le
relevé vient de la banque. Personne ne retape rien.

---

## 3. Autres chantiers écartés, pour qu'ils ne se perdent pas

### Site web (dépôt `safehill-web1`)

* **La version anglaise est invisible pour Google.** Les traductions vivent dans
  un objet JavaScript et ne s'affichent qu'au clic : les moteurs n'indexent que
  le français. Correction = de vraies pages `/en/`. À revoir au lancement de
  Clora, quand le référencement anglophone commencera à coûter quelque chose.
* **Tailwind est chargé par CDN** — environ 400 Ko de JavaScript qui compilent le
  CSS dans le navigateur du visiteur, à chaque visite. Corriger impose une étape
  de compilation, écartée pour garder le site modifiable à la main.
* **La nav, le pied de page et la logique thème/langue sont recopiés dans chaque
  page** — environ 2 000 lignes en dix exemplaires. C'est pourquoi ajouter une
  seule entrée de menu touche sept fichiers.

### Clora

* **Les frais de Stripe ne sont pas repris automatiquement en dépenses.** Ils
  sont prélevés sur le versement, pas sur la facture : celle-ci est réglée en
  totalité, et la dépense correspondante reste à saisir à la main.
* **Le certificat de signature de code n'est pas acheté** — l'avertissement
  SmartScreen de Windows subsiste à l'installation. Piège connu et documenté au
  §5 du document de monétisation : le problème du jeton matériel doit être réglé
  *avant* l'achat, `CSC_LINK` ne fonctionnant pas avec un certificat OV moderne
  sur un exécuteur GitHub.
* **La clé publique de licence n'est pas posée, et ne doit pas l'être avant la
  fin des tests.** Le jour où elle entre dans une version publiée, l'essai de
  trente jours se met à courir chez tous ceux qui l'installent — vos testeurs
  se retrouveraient bloqués au milieu de leur évaluation.
