# Clora : architecture, sécurité et licence

*Document technique. Version 1.5.1, septembre 2026.*

Ce document décrit comment Clora est construit, ce qui protège les données, et
comment fonctionne le modèle de licence. Pour la description fonctionnelle, voir
[01-presentation-fonctionnelle.md](01-presentation-fonctionnelle.md).

---

## 1. Vue d'ensemble

Clora est une application de bureau Windows qui embarque un serveur web complet.

```
┌─────────────────────── Processus Electron ───────────────────────┐
│                                                                  │
│   Fenêtre (Chromium)              Processus principal (Node.js)  │
│   ┌──────────────────┐            ┌──────────────────────────┐   │
│   │  Interface React │◄──HTTP────►│  Serveur Express         │   │
│   │  (compilée)      │  127.0.0.1 │  ├── routes/             │   │
│   │                  │  port libre │  ├── *Service.js        │   │
│   │  sandbox: true   │            │  └── SQLite (fichier)    │   │
│   │  contextIsolation│            │                          │   │
│   └──────────────────┘            └──────────────────────────┘   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
                              %APPDATA%\Clora\
                              ├── comptes.sqlite
                              ├── database.sqlite
                              ├── entreprises/
                              ├── sauvegardes/
                              └── .jwt-secret
```

| Couche | Technologie | Version |
| --- | --- | --- |
| Enveloppe de bureau | Electron | 42 |
| Serveur | Express | 5 |
| Base de données | SQLite (`sqlite3` + `sqlite`) | 6 / 5 |
| Interface | React + Vite | 19 / 8 |
| Exécution | Node.js | ≥ 20 (compilé sous 22) |

**Huit dépendances de production seulement** côté serveur : `bcryptjs`,
`cookie-parser`, `dotenv`, `express`, `jsonwebtoken`, `nodemailer`, `sqlite`,
`sqlite3`. Six côté interface : `react`, `react-dom`, `recharts`,
`lucide-react`, `papaparse`, `html2pdf.js`.

Cette frugalité est délibérée : chaque dépendance est une surface d'attaque et
une dette de mise à jour. **Il n'y a notamment aucune bibliothèque Stripe** :
l'intégration parle directement à l'API REST par le module `https` de Node.

### Ce qui se passe au démarrage

1. Electron obtient un verrou d'instance unique : deux processus écrivant dans
   la même base SQLite se gêneraient.
2. La fenêtre est créée **cachée**, pour ne pas montrer un rectangle blanc.
3. Le serveur Express démarre. En production, sur **un port libre attribué par
   le système** ; en développement, sur 3000 pour que le proxy de Vite le trouve.
4. Le registre `comptes.sqlite` s'ouvre, migre si nécessaire, et désigne le
   dossier d'entreprise à charger.
5. Le planificateur horaire démarre.
6. La fenêtre charge `http://127.0.0.1:<port>` et s'affiche.

Un échec à l'étape 3 ouvre une boîte de dialogue d'erreur explicite, au lieu de
laisser l'utilisateur devant une fenêtre blanche.

---

## 2. Organisation du code

```
config.js          Emplacement des données, secret de session, port et hôte
database.js        Schéma, migrations et index
money.js           Arithmétique monétaire (JavaScript et SQL alignés)
sequences.js       Numérotation des documents, jamais réattribuée
dbUtils.js         Transactions sérialisées et réentrantes
dbContext.js       Dossier d'entreprise de la requête en cours
validators.js      Validation des données entrantes
rateLimit.js       Limitation des tentatives de connexion
authMiddleware.js  Vérification du jeton et contraintes de rôle
scheduler.js       Passage horaire : abonnements, relances, Stripe, sauvegardes
licenceService.js  Vérification Ed25519 des clés, essai, maintenance
kilometrageService.js  Indemnité kilométrique : paliers et recalcul de l'année
secretStorage.js   Chiffrement des secrets au repos
companyStore.js    Registre des dossiers d'entreprise et comptes partagés
*Service.js        Logique métier par domaine (15 services)
routes/            20 modules de points d'entrée HTTP
client/src/        Interface React (33 composants et crochets)
tests/             22 fichiers, 331 tests
```

Le découpage est strict : **`server.js` ne fait que câbler**. Il ne contient
aucune règle métier. Les routes valident, vérifient le rôle et appellent un
service ; les services portent la logique et parlent à la base.

### Le chaînage des middlewares

L'ordre est significatif et chaque position est justifiée :

```
1. securityHeaders          En-têtes de sécurité
2. express.json             1 Mo, ou 25 Mo pour courriel et import
3. cookieParser
4. /api/licence             AVANT le contrôle de licence : sinon, un essai
                            expiré empêcherait de saisir la clé qui le débloque
5. licenceMiddleware        402 si l'installation n'est plus utilisable
6. /api/auth                AVANT l'authentification, évidemment
7. authMiddleware           401 sans jeton valide
8. dossierMiddleware        Ouvre le dossier de la session, résout le rôle
9. Les 20 routeurs métier   Chacun avec ses contraintes de rôle
10. apiNotFound             Une route d'API inconnue répond en JSON
11. Fichiers statiques      L'interface React compilée
12. errorHandler
```

---

## 3. Le modèle de données

**Vingt tables** dans la base d'une entreprise : `clients`, `factures`,
`lignes_facture`, `paiements`, `catalogue`, `settings`, `devis`, `lignes_devis`,
`depenses`, `taux_kilometriques`, `users`, `transactions_bancaires`,
`notes_credit`, `lignes_note_credit`, `relances`, `document_sequences`,
`abonnements`, `liens_paiement`, `encaissements_stripe`, `logs_audit`.

Plus une base séparée, `comptes.sqlite` : le registre des dossiers d'entreprise
et les comptes d'utilisateurs.

### Trois décisions structurantes

**Les montants sont figés à l'émission.** Sous-total, taxes et total sont
colonnes de la table, calculés une fois puis lus tels quels. Ils ne sont jamais
recalculés depuis les lignes à la lecture. Une pièce comptable remise à un client
ne doit pas changer de montant parce qu'un taux a bougé ou qu'une règle d'arrondi
a été corrigée.

*Une seule exception, décrite au §3.1 : l'indemnité kilométrique.*

**Les montants dérivés ne sont pas stockés.** Le solde d'une facture, la part
déjà imputée d'un dépôt bancaire : ces valeurs se déduisent par requête, elles ne
sont pas conservées. Un total stocké aurait fini par diverger
(annulation d'un encaissement, suppression d'une facture) sans que rien ne le
signale.

**Les expressions SQL du calcul sont partagées.** Une seule définition de « net »,
« payé », « solde », réutilisée par la liste des factures, le tableau de bord, la
balance âgée et les exports. C'est ce qui garantit que le total de la balance âgée
égale toujours le « reste à percevoir » de la vue d'ensemble.

### 3.1 L'indemnité kilométrique, seule exception au figeage

Un déplacement est une dépense dont `kilometres` n'est pas nul : c'est le seul
discriminant, ce qui le fait entrer sans rien changer dans la liste des dépenses,
le bénéfice net et les rapports, qui somment déjà `montant_ht`.

Son montant est **recalculé, non figé**, et c'est délibéré. Il dépend du cumul de
l'année : c'est ce cumul qui décide de quel côté du seuil le trajet tombe. Le
figer à la saisie ferait dépendre le montant de l'ordre d'entrée, et antidater un
trajet oublié laisserait l'année fausse sans que rien ne le signale.

`kilometrageService.recalculerAnnee` relit donc les trajets de l'année triés par
date puis par identifiant, cumule les distances, scinde au seuil (un trajet peut
l'enjamber et se voir payé aux deux taux) et réécrit chaque `montant_ht`. Il est
appelé à la création, la modification et la suppression d'un déplacement, ainsi
qu'au changement d'un taux. Une modification de date qui traverse le 1er janvier
réajuste **les deux années**.

L'exception se tient parce qu'un déplacement n'est remis à personne : c'est une
ligne de journal interne, pas une pièce entre les mains d'un client.

Les taux vivent dans `taux_kilometriques`, **une ligne par année** plutôt qu'un
réglage unique : les autorités fiscales les révisent annuellement, et un réglage
unique ferait qu'inscrire le taux de l'an prochain réécrirait une année close au
premier recalcul. Aucun taux n'est semé par défaut, et la saisie d'un déplacement
est refusée tant que son année n'en a pas.

### La numérotation

`sequences.js` attribue les numéros de facture, de devis et de note de crédit.
Un numéro **n'est jamais réattribué**, même si le document est supprimé : une
séquence comptable à trous est acceptable, une séquence qui réutilise un numéro
ne l'est pas.

Format des notes de crédit : `NC-AAAAMM-NNNN`.

### L'arithmétique monétaire

`money.js` arrondit au cent en corrigeant les artefacts de représentation
binaire : `2.675` est stocké en flottant comme `2.67499999…`, et un arrondi naïf
donnerait 2,67.

**Le même calcul existe en JavaScript et en SQL**, et un test compare les deux
sur plusieurs milliers de montants. Une divergence entre les deux ferait qu'un
écran et un export affichent des chiffres différents pour la même facture.

---

## 4. Le cloisonnement multi-entreprise

**Chaque dossier d'entreprise a son propre fichier de base de données.** Ce n'est
pas une commodité d'implémentation.

L'alternative, une colonne `entreprise_id` sur les dix-sept tables, aurait
imposé de porter le filtre sur les 81 requêtes existantes. **Un seul `WHERE`
oublié aurait montré les factures d'un client à un autre.** Sur un logiciel vendu
à des comptables, c'est la faute dont on ne se relève pas.

Un fichier par dossier rend le cloisonnement physique : il n'y a rien à filtrer,
donc rien à oublier.

Les comptes d'utilisateurs, eux, sont communs et vivent dans `comptes.sqlite` :
sans quoi un comptable devrait se reconnecter à chaque changement de client.

La bascule d'un dossier à l'autre se fait en **un seul point** du code, par le
contexte de requête (`dbContext.js`). Les 81 appels des routeurs n'ont pas eu à
changer.

---

## 5. Sécurité

### 5.1 La surface d'attaque

| Mesure | Détail |
| --- | --- |
| **Écoute locale seulement** | `127.0.0.1`. L'API comptable n'est pas publiée sur le réseau local |
| **Port aléatoire** | Attribué par le système en production |
| **Aucun CORS** | Interface et API partagent l'origine. Un `cors()` ouvert répondait auparavant `Access-Control-Allow-Origin: *` à n'importe quel site |
| **Aucun canal IPC** | Pas de script de préchargement ; l'interface ne parle qu'au HTTP local |
| **`sandbox: true`** | Le rendu Chromium est en bac à sable |
| **`contextIsolation: true`** | Le contexte de la page est isolé de Node |
| **`nodeIntegration: false`** | La page n'a aucun accès à Node |
| **Liens externes** | Ouverts dans le navigateur du système, jamais dans la fenêtre |
| **Instance unique** | Un verrou empêche deux processus d'écrire dans la même base |

En-têtes envoyés sur chaque réponse : `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
`Cross-Origin-Opener-Policy: same-origin`. `X-Powered-By` est désactivé.

### 5.2 Authentification

- **Mots de passe** hachés par bcrypt, **coût 12**.
- **Session** portée par un jeton JWT dans un cookie `httpOnly`, `sameSite:
  strict`, `secure` en production. Durée : 12 heures par défaut.
- **Secret de signature** : 512 bits tirés au hasard au premier lancement, écrits
  en `0600` dans le dossier de données. **Il n'existe aucune valeur par défaut en
  dur** : un secret présent dans le code source permettrait à quiconque lit le
  dépôt de forger un jeton administrateur. Un `JWT_SECRET` fourni doit faire au
  moins 32 caractères, sinon le démarrage échoue.
- **Limitation des tentatives** : 8 essais par tranche de 15 minutes, par couple
  adresse IP + nom d'utilisateur. Sans elle, un mot de passe de quatre caractères
  tombe en quelques secondes.

### 5.3 Autorisation

Trois rôles (`employe`, `comptable`, `admin`) appliqués **par le serveur sur
chaque route**. L'interface se contente de masquer ce qui serait refusé.

**Le rôle est relu à chaque requête** plutôt que porté par le jeton : retirer un
accès prend effet immédiatement, et non à l'expiration de la session douze heures
plus tard.

Le cloisonnement des rôles fait l'objet de tests dédiés : c'est le genre de règle
qu'une refonte casse sans bruit.

### 5.4 Limites de charge

La limite de corps est de **1 Mo** par défaut. Deux routes en dérogent, parce
qu'elles transportent légitimement plus : l'envoi de courriel (un PDF encodé en
base64) et l'import de tableur, à 25 Mo.

Auparavant, une limite unique de 50 Mo s'appliquait à **tous** les points
d'entrée, offrant un levier de saturation mémoire sur n'importe lequel.

### 5.5 Les secrets au repos

Deux secrets sont enregistrés dans la base : le mot de passe du serveur d'envoi
de courriels et la clé d'API Stripe.

Or la base est recopiée par les sauvegardes automatiques vers un dossier souvent
synchronisé. En clair, ces secrets partiraient dans le nuage à chaque copie, et
une sauvegarde égarée livrerait la boîte courriel de l'entreprise.

`secretStorage.js` les chiffre par le **coffre du système d'exploitation**,
DPAPI sous Windows, via `safeStorage` d'Electron. La valeur n'est déchiffrable
que par le même compte utilisateur, sur la même machine. Une sauvegarde emportée
ailleurs ne contient qu'un bloc inexploitable.

Deux préfixes disent franchement ce qui a eu lieu :

| Préfixe | Signification |
| --- | --- |
| `coffre:` | Réellement protégé par le coffre du système |
| `clair:` | Simplement encodé : aucun coffre n'était disponible à l'écriture |

Une base restaurée sur une autre machine ne sait plus déchiffrer : le paiement en
ligne se désactive et l'écran des paramètres invite à ressaisir la clé, plutôt
que de laisser croire qu'il fonctionne encore.

### 5.6 Le journal d'audit

Les actions sensibles sont consignées dans `logs_audit` avec horodatage, auteur,
rôle et l'écart constaté champ par champ, sous la forme « avant → après ».

**Le journal est en ajout seul, garanti par la base de données.** Deux
déclencheurs SQLite refusent tout `UPDATE` et tout `DELETE` sur la table :

```sql
CREATE TRIGGER logs_audit_sans_modification ...
CREATE TRIGGER logs_audit_sans_suppression ...
```

La garantie ne repose donc pas sur l'absence d'une route, mais sur un refus de
SQLite quel que soit le chemin emprunté, y compris un accès direct au fichier
avec un outil tiers. Un journal réécrivable ne prouverait rien.

En contrepartie, le journal ne se purge pas. C'est le bon défaut pour une piste
d'audit comptable, et le volume reste modeste puisque seules les actions
sensibles y entrent.

Deux règles sur le contenu : **aucun secret n'y figure** (mots de passe et
empreintes sont remplacés par une mention) et le logo d'entreprise en est exclu,
car c'est un fichier de plusieurs mégaoctets sans portée comptable.

Écrire au journal **ne peut pas faire échouer l'action métier** : refuser
d'annuler un encaissement saisi à tort serait plus dommageable que de perdre une
ligne de trace.

### 5.7 Ce qui n'est pas protégé

Dire ce qu'un dispositif ne couvre pas fait partie de l'honnêteté d'un document
de sécurité.

| | |
| --- | --- |
| **Le binaire n'est pas signé** | Windows affiche un avertissement SmartScreen à l'installation. Aucun certificat de signature de code n'a encore été acheté |
| **La base n'est pas chiffrée au repos** | Seuls les deux secrets le sont. Quelqu'un qui a accès au disque a accès à la comptabilité : c'est le modèle d'un logiciel de bureau mono-poste |
| **La clé de licence est partageable** | Sans serveur, rien n'empêche de la donner à un tiers |
| **L'essai se réinitialise** | Supprimer `comptes.sqlite` remet le compteur à zéro |
| **Le paquet est ouvrable** | Une archive `asar` n'est pas un coffre-fort |
| **Modèle de confiance** | Clora fait confiance au compte Windows qui l'exécute. Il ne protège pas contre un administrateur local hostile |

Ces limites sont assumées : la fraude marginale coûte moins cher que
l'infrastructure et la friction qu'un vrai verrou imposerait aux clients
honnêtes.

---

## 6. Licence et maintenance

### Le modèle commercial

**Licence perpétuelle** avec **maintenance annuelle facultative**. Le client
achète une fois et garde son logiciel pour toujours ; la maintenance lui donne
les versions publiées pendant qu'elle court.

### Le mécanisme

Une clé de licence est un **message signé en Ed25519**. L'application embarque la
clé **publique** et vérifie la signature sur place. La clé privée ne quitte
jamais la machine de l'éditeur.

Conséquences, toutes voulues :

- aucun serveur à bâtir, à payer ni à surveiller ;
- **aucun appel sortant** : l'argument « vos données ne partent pas » reste vrai,
  ce qui compte sur un logiciel comptable ;
- l'activation fonctionne **hors ligne**, sur un chantier ou dans un sous-sol.

Format d'une clé : `CLORA-<charge utile base64url>.<signature base64url>`. Le
préfixe permet à une chaîne collée par erreur de se reconnaître.

### La règle qui rend le modèle applicable

**Chaque version publiée porte sa date de compilation**, écrite dans
`build-info.json` par le workflow de publication. Si cette date dépasse
l'échéance de maintenance d'une clé, **cette version-là** refuse de s'activer,
mais toute version antérieure continue de fonctionner indéfiniment.

Le client qui cesse de payer garde son logiciel et ses données ; il ne reçoit
simplement plus les nouveautés. **Rien à bloquer, rien à reprendre.**

Sans ce fichier, l'application retomberait sur la date du jour et aucune clé ne
serait jamais refusée.

### Les états d'une installation

| État | Signification |
| --- | --- |
| `desactive` | Aucune clé publique configurée : le contrôle est inerte |
| `essai` | Période d'essai en cours (30 jours) |
| `activee` | Clé valide, maintenance couvrant cette version |
| `essai_expire` | Essai terminé, aucune clé saisie |
| `maintenance_expiree` | Clé valide, mais la maintenance ne couvre pas cette version |

Quand l'installation n'est plus utilisable, l'API répond **402**, et le refus
est placé **avant** l'authentification, car il n'y a pas lieu de se connecter
sans licence valable. Les routes de licence, elles, restent accessibles sans
session : exiger d'être connecté pour saisir une clé enfermerait l'utilisateur
dehors.

### Émettre les clés

Une seule fois, pour créer la paire :

```bash
node scripts/generer-licence.js --nouvelle-paire
```

Écrit `clef-privee-licence.pem`, **jamais versionnée**, et renseigne
`licencePublique.js`, qui l'est.

À chaque vente :

```bash
node scripts/generer-licence.js --titulaire "Plomberie Tremblay" \
  --courriel marc@tremblay.ca --mois 12
```

> **La clé privée ne doit exister que sur la machine de l'éditeur.** Elle est
> exclue du dépôt par `.gitignore`, exclue du paquet livré par la configuration
> de compilation (`!scripts/**`, `!*.pem`), et **deux tests vérifient cette
> exclusion sur le paquet réellement produit** plutôt que de s'en remettre à une
> relecture de la configuration. La perdre, c'est ne plus pouvoir émettre ni
> renouveler aucune licence.

### État actuel

`CLE_PUBLIQUE` est **vide**. Le contrôle est donc inerte : ni essai, ni
expiration. C'est délibéré pendant la période de tests utilisateurs : le jour où
la clé entre dans une version publiée, l'essai de trente jours se met à courir
chez tous ceux qui l'installent.

---

## 7. Le paiement en ligne

### Le principe

Clora crée un **lien de paiement Stripe** par facture. Le client règle par carte
ou par débit préautorisé sans créer de compte. L'argent va directement au compte
Stripe de l'entreprise : **Clora n'est à aucun moment intermédiaire de
paiement**, ce qui relèverait d'un tout autre régime réglementaire.

### L'intégration

**Aucune bibliothèque Stripe.** `stripeService.js` parle à l'API REST par le
module `https` de Node, avec :

- l'encodage de formulaire attendu, notation à crochets comprise (`a[b][c]=v`) ;
- la **version d'API épinglée** (`Stripe-Version: 2024-06-20`), sans quoi une
  évolution de Stripe changerait le comportement sans qu'aucune ligne de code
  n'ait bougé ;
- des **clés d'idempotence** sur les créations.

Une clé **restreinte** est demandée à l'utilisateur, avec l'écriture sur Prix,
Produits et Liens de paiement, et la lecture sur Sessions de paiement. Une clé
secrète complète fonctionne, mais donne tous les droits sur le compte Stripe à un
logiciel installé sur un poste de bureau.

Les moyens de paiement ne sont **pas imposés par paramètre** : Stripe applique
ceux que l'entreprise a activés dans son tableau de bord. Les imposer ferait
échouer la création du lien tant que le débit préautorisé n'est pas activé, et
priverait la facture de tout moyen de paiement pour rien.

### Ce qui garantit la justesse des comptes

**Un lien actif au plus par facture**, portant le solde restant et non le total.
Un acompte encaissé entre-temps retire l'ancien lien et en crée un juste.

**Un règlement inscrit une seule fois.** L'identifiant de session Stripe porte
une contrainte d'unicité en base. C'est cette contrainte, et non la prudence du
code, qui l'empêche, quel que soit le nombre de passages du planificateur.

**Seul l'argent réellement reçu est inscrit.** Le relevé n'inscrit que sur
`payment_status === 'paid'`. Une session « complétée » en débit préautorisé est
encore `unpaid` : le règlement met plusieurs jours ouvrables à se dénouer.

**Le relevé filtre par lien, pas par fenêtre de dates.** Un débit préautorisé
lent sortirait d'une fenêtre temporelle et serait perdu.

**Une erreur passagère ne condamne pas un règlement.** Seul un code d'erreur 4xx
est traité comme un refus définitif ; une panne réseau d'une minute laisse le
règlement à reprendre au passage suivant.

**Un règlement non imputable ne disparaît pas.** Facture soldée à la main pendant
qu'un client payait en ligne : le cas est consigné avec son motif, signalé dans
les paramètres et porté au journal d'audit.

### L'expiration des liens

**Passé quatre-vingt-dix jours sans la moindre session, un lien est retiré.**
Sans cette borne, une facture d'essai jamais réglée serait sondée indéfiniment,
une fois l'heure.

Le délai n'est pas arbitraire : c'est un mois de grâce après `net60`, le terme le
plus long que Clora propose. Une facture encore payable ne doit jamais voir son
lien expirer avant son échéance.

Deux précautions l'accompagnent :

- **le lien est aussi désactivé chez Stripe.** Cesser de l'interroger en le
  laissant vivant ferait qu'un client paierait sans que Clora ne le voie jamais ;
- **un lien qui a vu passer la moindre session est épargné**, quel que soit son
  âge, le temps qu'un débit préautorisé se dénoue.

Le compteur de jours rend zéro sur une date illisible, de sorte qu'une donnée
abîmée fasse **conserver** le lien plutôt que le retirer à tort.

---

## 8. Sauvegardes et restauration

**La copie passe par `VACUUM INTO`, et non par une copie de fichier.** La base
tourne en mode WAL : dupliquer `database.sqlite` pendant une écriture donnerait
un fichier amputé de tout ce qui n'a pas encore été reporté depuis le journal.

Une sauvegarde par jour, vérifiée à chaque passage horaire, **plus une à la
fermeture de l'application** : un poste éteint chaque soir n'atteindrait jamais
l'échéance autrement. Tous les dossiers ouverts pendant la session y passent, pas
seulement le dernier consulté.

Rétention : les 30 plus récentes. Les fichiers étrangers au dossier ne sont
jamais touchés.

**La restauration ne remplace pas la base pendant qu'elle est ouverte.** La
sauvegarde est d'abord contrôlée (intégrité SQLite, présence du schéma Clora)
puis une demande est enregistrée et appliquée **au redémarrage**, alors
qu'aucune connexion ni journal ne décrit encore l'ancienne base. Celle-ci est
conservée à côté sous `database.sqlite.avant-restauration-<horodatage>` : une
restauration sur le mauvais fichier reste réversible.

---

## 9. Le planificateur

Un passage **toutes les heures**, pour chaque dossier d'entreprise :

1. génération des factures d'abonnement dues ;
2. envoi des relances dont le palier est franchi ;
3. relevé des règlements Stripe ;
4. sauvegarde si l'échéance quotidienne est atteinte.

Chaque étape est isolée : l'échec de l'une n'empêche pas les suivantes. Les
opérations sont idempotentes (la date de prochaine génération avance à chaque
facture émise), donc une vérification fréquente est sans risque.

---

## 10. Tests et intégration continue

**331 tests**, exécutés par `node --test`. Répartition :

| Domaine | Tests |
| --- | --- |
| Paiement en ligne Stripe | 31 |
| Sauvegardes et restauration | 24 |
| Indemnité kilométrique | 17 |
| Import de tableur | 19 |
| Rapprochement bancaire | 19 |
| Cycle de vie des factures | 18 |
| Relances automatiques | 17 |
| Notes de crédit | 17 |
| Envoi de courriels | 16 |
| Licence et maintenance | 15 |
| Exports CSV | 15 |
| Conditions de paiement | 15 |
| Journal d'audit | 15 |
| Encaissements et annulations | 14 |
| API et cloisonnement des rôles | 14 |
| Devis | 12 |
| Montants figés | 11 |
| Mises à jour | 10 |
| Balance âgée | 9 |
| Multi-entreprise | 8 |
| Abonnements | 8 |
| Arithmétique monétaire | 7 |

Deux partis pris méritent d'être signalés :

**Les tests monétaires comparent JavaScript et SQL** sur plusieurs milliers de
montants générés. Une divergence entre les deux implémentations ferait qu'un
écran et un export affichent des chiffres différents.

**Les tests Stripe passent par un vrai serveur HTTP local**, et non par un
simulacre en mémoire. Ils éprouvent donc l'encodage réel des requêtes, les
en-têtes d'authentification et la version d'API épinglée.

### L'atelier d'intégration continue

`.github/workflows/ci.yml`, déclenché sur chaque demande de fusion et sur chaque
poussée vers `master` :

```
npm ci  →  npm test  →  npm ci (client)  →  npx eslint .  →  npm run build
```

Aucune fusion n'a lieu au rouge.

---

## 11. Compilation et livraison

### Pourquoi la compilation doit avoir lieu sous Windows

`sqlite3` est une bibliothèque **native**. Son binaire Windows n'est téléchargé
que par un `npm ci` exécuté sous Windows. Une compilation depuis Linux ou macOS
produirait un installateur inutilisable.

### Le workflow de publication

`.github/workflows/release.yml`, déclenché par une étiquette `v*` :

1. `npm ci` sous Windows : c'est cette étape qui récupère le bon binaire ;
2. écriture de `build-info.json` : date du jour et version tirée de l'étiquette ;
3. `npm run build` : compilation de l'interface, puis `electron-builder` ;
4. dépôt de l'installateur sur la page des publications, en **deux exemplaires** :
   `Clora-Installateur-<version>.exe` et une copie sous le nom fixe
   `Clora-Installateur.exe`.

Le nom fixe existe pour une raison précise : le nom versionné rendrait mort à
chaque publication tout lien direct posé sur un site web. GitHub sert en
permanence `/releases/latest/download/Clora-Installateur.exe`, et le bouton de
téléchargement du site n'a plus jamais à être modifié.

**L'étiquette doit correspondre au champ `version` de `package.json`.** C'est ce
champ qu'`electron-builder` lit pour nommer le fichier et qu'`app.getVersion()`
rend à la vérification de mise à jour. Publier sans l'avoir incrémenté ferait
qu'un installateur mal numéroté annoncerait indéfiniment une version disponible
que chaque poste croirait ne pas avoir.

### L'installateur

Format NSIS, **un seul clic**, sans demande d'autorisation administrateur
(installation par utilisateur), icône sur le bureau et dans le menu Démarrer.
Environ 104 Mo.

`deleteAppDataOnUninstall` est à **faux** : désinstaller Clora ne doit pas
effacer la comptabilité de l'entreprise.

### Mise à jour

L'application **ne télécharge et n'installe rien**. Elle compare sa version à la
dernière étiquette publiée, une fois par jour au plus, et affiche un bandeau.

C'est délibéré : l'application n'étant pas signée, `electron-updater` exécuterait
un binaire dont l'origine n'est vérifiée par rien, la vérification de signature
est précisément ce qui est désactivé faute de certificat. Sur un logiciel qui
détient la comptabilité d'une entreprise, ce n'est pas acceptable.

**C'est le seul appel sortant de l'application**, il se coupe dans les
paramètres, il n'a lieu qu'en mode empaqueté, et il échoue en silence hors ligne
ou derrière un pare-feu.

---

## 12. Outillage de diagnostic

`npm run doctor` inspecte une base à la recherche d'anomalies comptables :
paiements supérieurs au solde, statuts désalignés, transactions bancaires liées à
une facture disparue. Il signale sans rien modifier.

Trois corrections peuvent être demandées explicitement :

| Commande | Effet |
| --- | --- |
| `--corriger-statuts` | Réaligne le statut des factures sur leurs montants |
| `--refiger-montants` | Recalcule les montants depuis les lignes, en cas de dérive signalée |
| `--annuler-surpaiements` | Défait les encaissements issus d'un rapprochement qui dépassent le total |

---

## 13. Dettes et limites connues

| Sujet | État |
| --- | --- |
| **Certificat de signature de code** | Non acheté. L'avertissement SmartScreen subsiste. Le problème du jeton matériel doit être réglé avant l'achat : un certificat moderne exige une clé sur matériel certifié, qu'un exécuteur GitHub ne peut pas porter |
| **Frais Stripe en dépenses** | Pas repris automatiquement |
| **Kilométrage : méthode unique** | Seule l'indemnité au kilomètre est calculée. La proration des coûts réels, qu'attend l'ARC d'un travailleur autonome non incorporé, n'est pas offerte. Aucune taxe récupérable n'est portée sur une indemnité |
| **Rapprochement bancaire** | La suggestion se réduit à une égalité de montant au cent près. Ni fenêtre de dates, ni tolérance, ni classement des candidats |
| **Volume du rapprochement** | Plafond de 5 000 lignes ; le relevé transite en JSON sous une limite de corps de 1 Mo |
| **Retraits bancaires** | Ignorés : frais et sorties sont hors périmètre |
| **Windows seul** | Aucune cible macOS ou Linux |
| **Bandeau de mise à jour** | Le cas positif n'a jamais été observé sur un vrai Windows avant la publication de la 1.5.1 |
| **Redémarrage après restauration** | `app.relaunch()` non vérifié sur un vrai Windows |

---

*Clora est un logiciel de Safehill Technologies. Code source consultable, non
libre de droits : voir [LICENSE](../LICENSE).*
