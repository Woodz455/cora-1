# Clora : état du projet

*Ce qui a été fait, ce qui reste à faire. Arrêté au 5 septembre 2026,
version 1.5.1.*

---

## 1. Où en est le projet

| | |
| --- | --- |
| **Version publiée** | 1.5.1, le 5 septembre 2026 |
| **Publications** | 6 versions livrées depuis le 24 juillet 2026 |
| **Développement** | 40 commits, 12 demandes de fusion, toutes fusionnées |
| **Tests** | 314, tous au vert, exécutés à chaque fusion |
| **Durée** | 6 semaines, du 24 juillet au 5 septembre 2026 |
| **Site web** | Page Clora en ligne sur safehilltechnologies.ca |
| **Ventes** | Aucune : la phase de tests utilisateurs commence |

**L'application est complète et livrable.** Ce qui manque avant de vendre n'est
pas du code : c'est un certificat, une clé, et le retour des testeurs.

---

## 2. Ce qui a été fait

### Phase 1 : fiabiliser les fondations
*24 au 30 juillet · publié en 1.1 · demande de fusion #1*

Le point de départ était une application fonctionnelle mais fragile. Cette phase
a corrigé ce qui, autrement, aurait fini par produire de faux chiffres.

- **Sécurisation générale** : suppression du CORS ouvert, en-têtes de sécurité,
  limitation des tentatives de connexion, secret de session tiré au hasard au
  lieu d'une valeur en dur.
- **Montants figés à l'émission**, la décision structurante du projet. Une
  facture remise à un client ne change plus de montant, quelles que soient les
  évolutions ultérieures des taux ou des prix.
- **Arithmétique monétaire alignée** entre JavaScript et SQL, avec des tests qui
  comparent les deux sur plusieurs milliers de montants.
- **Notes de crédit** et **relances automatiques**.
- **Correction d'un encaissement saisi à tort**, sans jamais effacer la ligne.
- **Rapprochement partiel** : un dépôt bancaire peut régler plusieurs factures.
- **Intégration continue** : plus aucune fusion au rouge.

### Phase 2 : rendre l'application utilisable au quotidien
*30 au 31 juillet · publié en 1.2.0 · demande de fusion #2*

- Fenêtres modales utilisables au clavier.
- Chiffres du tableau de bord rendus cliquables : le montant en retard mène aux
  factures en retard.
- Écrans de liste alignés : recherche, tri, pagination partout.
- Retour d'information unifié, fenêtres natives supprimées.
- Note de crédit dotée de son propre document numéroté.
- **Premier installateur Windows** : un fichier, un double-clic, une icône sur le
  bureau.

### Phase 3 : mettre la comptabilité à l'abri et outiller le comptable
*1er au 4 août · publié en 1.3.0 et 1.3.1 · demandes de fusion #3 et #4*

- **Sauvegardes automatiques** et restauration contrôlée.
- **Journal d'audit inaltérable**, garanti par la base de données elle-même.
- **Registres de ventes et d'encaissements** exportés au format qu'attend
  l'Excel francophone.
- **Balance âgée** : les créances ventilées par ancienneté du retard.
- **Conditions de paiement** attachées au client, figées sur la facture.
- **Préparation de la remise de taxes** par trimestre.
- **Vérification des mises à jour**, sans rien installer à l'insu de
  l'utilisateur.
- Nouveau logo, décliné sous les deux formes que l'application exige.
- Passage sous licence propriétaire, et lien de téléchargement permanent pour le
  site web.

### Phase 4 : ouvrir l'application à ses vrais utilisateurs
*22 au 23 août · publié en 1.2.1 et 1.4 · demandes de fusion #5, #6, #7*

- **Envoi de courriels configurable depuis l'application.** Auparavant, la
  configuration passait par un fichier enfermé dans l'archive du paquet :
  aucune installation réelle ne pouvait envoyer de courriel.
- **Multi-entreprise** : un fichier de base par dossier, pour qu'un comptable
  puisse suivre vingt clients sans risque de mélange.
- **Import de clients et d'articles depuis un tableur**, avec choix des colonnes
  à l'écran et aperçu avant écriture.

### Phase 5 : vendre
*23 au 30 août · publié en 1.5.0 · demandes de fusion #8, #9, #10*

- **Licence perpétuelle et maintenance annuelle**, vérifiées hors ligne par
  signature Ed25519.
- **Paiement des factures en ligne** par carte et par débit préautorisé, sans que
  l'argent transite jamais par Clora.
- **Page de tarification** sur le site web.

### Phase 6 : préparer les tests utilisateurs
*5 septembre · publié en 1.5.1 · demandes de fusion #11, #12*

- **Expiration des liens de paiement dormants** après quatre-vingt-dix jours,
  pour que des factures d'essai jamais réglées cessent d'être sondées chaque
  heure.
- **Consignation des idées écartées**, avec la raison du refus, pour pouvoir les
  rouvrir sans refaire l'analyse.

### En parallèle : le site web
*Dépôt `safehill-web1`*

- Page de présentation de Clora, annonçant le produit à venir.
- Images rangées, allégées et converties.
- Lisibilité corrigée : 92 défauts de contraste relevés puis repris.
- Référencement complété : `robots.txt`, plan de site, images de partage.
- Politique de confidentialité réécrite selon la Loi 25 québécoise.

---

## 3. Ce qui reste à faire avant de vendre

Ces trois points bloquent la première vente. Aucun n'est du développement.

### 3.1 Terminer les tests utilisateurs
**En cours. C'est l'étape actuelle.**

Faire installer Clora par des clients potentiels et recueillir leurs retours.
Rien d'autre ne devrait être décidé avant.

### 3.2 Poser la clé publique de licence
**À faire à la fin des tests, pas avant.**

Tant que `CLE_PUBLIQUE` est vide, le contrôle de licence est inerte : ni essai,
ni expiration. **Le jour où la clé entre dans une version publiée, l'essai de
trente jours se met à courir chez tous ceux qui l'installent**, et vos testeurs se
retrouveraient bloqués au milieu de leur évaluation.

La marche à suivre :

1. `node scripts/generer-licence.js --nouvelle-paire` **sur votre machine**.
2. Sauvegarder `clef-privee-licence.pem` ailleurs que sur le disque de travail.
   La perdre, c'est ne plus pouvoir émettre ni renouveler aucune licence.
3. Publier une version portant la clé publique.

### 3.3 Acheter un certificat de signature de code
**Facultatif, mais l'avertissement Windows coûte des ventes.**

Sans certificat, Windows affiche « Windows a protégé votre ordinateur » à chaque
installation. Rien n'est cassé, mais un prospect qui découvre le produit peut
s'arrêter là.

**Un piège à régler avant l'achat :** depuis juin 2023, la clé privée d'un
certificat de signature de code doit résider sur du matériel certifié : une clé
USB, ou un service infonuagique. **Un exécuteur GitHub n'a pas de port USB.**
Acheter un certificat livré sur jeton matériel sans avoir prévu ce point rendrait
la signature impossible depuis le workflow de publication actuel.

Deux issues : un service de signature infonuagique (eSigner chez SSL.com, par
exemple), ou un exécuteur auto-hébergé sur une machine Windows qui porte le
jeton.

À noter : un certificat de validation d'organisation ne fait pas disparaître
l'avertissement du jour au lendemain : la réputation se construit avec les
téléchargements. Seul un certificat EV, plus cher, tend à l'écarter d'emblée.

> **Un certificat de signature ne crée aucun numéro de licence par client.** Il
> signe le fichier `.exe`, une fois, pour tout le monde. Les numéros de licence
> par client relèvent du mécanisme décrit au §3.2, qui est déjà écrit et testé.

---

## 4. Ce qui reste à faire, sans bloquer

### Dans l'application

| Sujet | Effort estimé | Pourquoi |
| --- | --- | --- |
| **Frais Stripe repris en dépenses** | Petit | Les frais sont prélevés sur le versement, pas sur la facture. La dépense reste à saisir à la main |
| **Rapprochement bancaire : fenêtre de dates** | Environ une journée pour les trois | ± 3 jours entre l'échéance et le dépôt, au lieu d'aucune considération temporelle |
| **Rapprochement : tolérance de montant** | | Pour absorber des frais retenus ou une conversion, là où seul le montant exact est reconnu |
| **Rapprochement : classement des candidats** | | Plusieurs propositions ordonnées, au lieu d'une correspondance binaire |

> **Réserve sur une quatrième idée** souvent proposée : la détection des
> inversions de chiffres n'a presque aucune valeur ici. Elle attrape les
> coquilles humaines, or les deux côtés du rapprochement sont produits par des
> machines : le montant vient de la facture calculée par le logiciel, le relevé
> vient de la banque. Personne ne retape rien.

### Sur le site web

| Sujet | Pourquoi |
| --- | --- |
| **La version anglaise est invisible pour Google** | Les traductions vivent dans un objet JavaScript et ne s'affichent qu'au clic : les moteurs n'indexent que le français. Correction : de vraies pages `/en/`. À revoir au lancement, quand le référencement anglophone commencera à coûter quelque chose |
| **Tailwind chargé par CDN** | Environ 400 Ko de JavaScript qui compilent le CSS dans le navigateur du visiteur, à chaque visite. Corriger impose une étape de compilation, écartée pour garder le site modifiable à la main |
| **Code dupliqué dans dix pages** | Nav, pied de page et logique thème/langue recopiés : ajouter une entrée de menu touche sept fichiers |

### Administratif

- **Faire relire la politique de confidentialité** par quelqu'un de compétent en
  Loi 25. Deux éléments restent à compléter dans le fichier : le nom de la
  personne responsable de la protection des renseignements, et les durées de
  conservation.
- **Mettre le site à jour** après chaque publication, si le lien de
  téléchargement doit apparaître. Le nom de fichier fixe rend cette étape
  indolore : `/releases/latest/download/Clora-Installateur.exe` sert toujours la
  dernière version.

---

## 5. Ce qui n'a jamais été vérifié sur un vrai Windows

Par honnêteté, ces points sont éprouvés par des tests automatisés mais n'ont
jamais été observés sur une machine réelle :

- **Le bandeau de mise à jour, cas positif.** Jusqu'à la publication de la 1.5.1,
  aucune version plus récente n'existait à annoncer. Les installations en 1.5.0
  devraient maintenant l'afficher dans les vingt-quatre heures, et **c'est la
  première occasion de le vérifier.**
- **Le redémarrage après restauration d'une sauvegarde.**

Ce sont deux choses à regarder pendant les tests utilisateurs.

---

## 6. Ce qui a été volontairement écarté

Ces décisions ont été prises après analyse. Elles sont consignées pour ne pas
être rediscutées sans raison nouvelle, et rouvertes si une raison nouvelle
apparaît.

### Le réconciliateur financier hors-ligne
*Proposé par des collègues, écarté.*

Un utilitaire qui rapproche **deux fichiers quelconques** avec des tolérances
paramétrables. L'idée est bonne, mais **ce n'est pas le même acheteur** : le
client de Clora est une PME qui émet ses factures ; le client du réconciliateur
est un comptable qui arbitre entre des données qu'il n'a pas produites. Cette
personne n'achètera pas une licence de facturation pour obtenir un écran.

S'y ajoute l'échelle (100 000 lignes contre 5 000 aujourd'hui) et le calendrier :
ouvrir un second produit avant d'avoir vendu le premier serait prématuré.

Ce qui reste juste dans l'intuition : le refus du nuage par les départements
financiers est réel. C'est exactement l'argument qui porte déjà Clora.

*Analyse complète dans [`Plan/idees-en-attente.md`](../Plan/idees-en-attente.md).*

### La mise à jour automatique
Écartée tant que l'application n'est pas signée. `electron-updater` exécuterait
un binaire dont l'origine n'est vérifiée par rien. Sur un logiciel qui détient la
comptabilité d'une entreprise, ce n'est pas acceptable. Redeviendra envisageable
le jour où un certificat existe.

### Le verrouillage strict des licences
Une clé peut être partagée, l'essai se réinitialise en supprimant un fichier, le
paquet est ouvrable. **C'est le bon compromis** : la fraude marginale coûte moins
cher que l'infrastructure et la friction qu'un vrai verrou imposerait aux clients
honnêtes, et un verrou en ligne trahirait l'argument « rien ne sort de votre
poste ».

### Le multi-entreprise par colonne
Une colonne `entreprise_id` aurait imposé de filtrer 81 requêtes. Un seul `WHERE`
oublié aurait montré les factures d'un client à un autre. Un fichier par dossier
rend le cloisonnement physique.

---

## 7. Les décisions structurantes, en résumé

Pour qui reprendrait le projet, voici ce qui ne doit pas être défait sans mesurer
ce qu'on perd :

1. **Les montants sont figés à l'émission.** Ne jamais recalculer une pièce
   comptable à la lecture.
2. **Les montants dérivés ne sont pas stockés.** Un solde conservé finit par
   diverger sans que rien ne le signale.
3. **Le journal d'audit est en ajout seul, garanti par la base**, pas par
   l'absence d'une route.
4. **Un fichier de base par dossier d'entreprise.**
5. **Aucun appel sortant, sauf la vérification de version**, et elle se coupe.
6. **La clé privée de licence n'existe que sur la machine de l'éditeur**, et deux
   tests vérifient son absence du paquet livré.
7. **L'argent ne transite jamais par Clora.** Être intermédiaire de paiement
   relèverait d'un tout autre régime réglementaire.
8. **La compilation a lieu sous Windows**, parce que `sqlite3` est natif.

---

## 8. Prochaine étape

**Faire installer la 1.5.1 par des testeurs et écouter ce qu'ils disent.**

Tout le reste (la clé de licence, le certificat, les améliorations du
rapprochement bancaire) attend ce retour, et devrait être priorisé par lui.

---

*Document maintenu par Safehill Technologies. Dernière mise à jour :
5 septembre 2026.*
