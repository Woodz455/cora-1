# Clora : architecture, sécurité et licence

*Document technique. Version 1.11.0, novembre 2026.*

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
`sqlite3`. Huit côté interface : `react`, `react-dom`, `recharts`,
`lucide-react`, `papaparse`, `html2pdf.js`, et les deux polices du produit,
`@fontsource-variable/inter` et `@fontsource-variable/outfit`, qui n'apportent
que des fichiers.

Cette frugalité est délibérée : chaque dépendance est une surface d'attaque et
une dette de mise à jour. **Il n'y a notamment aucune bibliothèque Stripe** :
l'intégration parle directement à l'API REST par le module `https` de Node.

### Ce qui se passe au démarrage

1. Electron obtient un verrou d'instance unique : deux processus écrivant dans
   la même base SQLite se gêneraient.
2. Un **écran de démarrage** s'ouvre aussitôt : une petite fenêtre sans cadre
   qui charge `ecran-demarrage.html` (dans `client/dist`, à côté des
   logotypes), sans script, la langue passée par l'ancre (`#en`). La fenêtre
   principale est créée **cachée**, pour ne pas montrer un rectangle blanc.
3. Le serveur Express démarre. En production, sur **un port libre attribué par
   le système** ; en développement, sur 3000 pour que le proxy de Vite le trouve.
4. Le registre `comptes.sqlite` s'ouvre, migre si nécessaire, et désigne le
   dossier d'entreprise à charger. **Sans dossier enregistré, aucune base
   n'est créée** : le premier dossier naît avec le compte de son
   administrateur. Jusqu'à la 1.10.0, une base vide naissait ici, à la racine
   des données ; quitter avant de créer son compte la faisait prendre, au
   lancement suivant, pour un dossier hérité, et le nom d'entreprise saisi
   était ignoré. La création du compte donne désormais son identité à un
   dossier resté vierge (`nommerSiVierge`, `companyStore.js`).
5. Le planificateur horaire démarre.
6. La fenêtre charge `http://127.0.0.1:<port>` et s'affiche ; l'écran de
   démarrage se ferme, après être resté au moins 0,6 seconde.

Un échec à l'étape 3 ferme l'écran de démarrage et ouvre une boîte de dialogue
d'erreur explicite, au lieu de laisser l'utilisateur devant une fenêtre blanche.

### Ce qui se passe à la fermeture

Electron n'attend pas un gestionnaire asynchrone sur `before-quit`. La
fermeture est donc **suspendue une fois** (`event.preventDefault()`), le temps
de trois choses, puis relancée :

1. le serveur cesse d'accepter des requêtes ;
2. chaque dossier ouvert pendant la session reçoit sa sauvegarde de fin de
   journée, si la dernière a plus de 24 h ;
3. les bases sont fermées, ce qui consolide leurs journaux WAL.

Un délai de garde de 15 secondes laisse l'application se fermer même si le
dossier de sauvegarde ne répond pas. Jusqu'à la 1.10.0, rien n'était retenu :
le processus s'arrêtait pendant que la sauvegarde démarrait, elle n'avait donc
jamais lieu, et SQLite, interrompu en plein travail, faisait planter la sortie.
La restauration d'une sauvegarde passe par `app.exit(0)` et ne traverse pas ce
chemin : elle fait son propre point de contrôle avant de relancer.

À la première ouverture d'un dossier par un compte, l'interface lance la
**visite guidée** (`VisiteGuidee.jsx`). Les éléments présentés portent un
attribut `data-visite` ; la visite se retient par compte dans le registre
(`users.visite_vue`, `PUT /api/auth/visite`, renvoyé par `GET /api/auth/check`).

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
chiffrementSauvegardes.js  Format chiffré des sauvegardes (AES-256-GCM)
codesSecours.js    Clé des sauvegardes et code de récupération (base 32 de Crockford)
companyStore.js    Registre des dossiers d'entreprise et comptes partagés
traductionServeur.js  Messages du serveur traduits en anglais à la sortie
*Service.js        Logique métier par domaine (19 services)
routes/            21 modules de points d'entrée HTTP
client/src/        Interface React (37 composants, 14 crochets et modules,
                   dictionnaire anglais dans traductions/en.js)
tests/             33 fichiers, 459 tests, et deux essais de bout en bout dans e2e/
```

Le découpage est strict : **`server.js` ne fait que câbler**. Il ne contient
aucune règle métier. Les routes valident, vérifient le rôle et appellent un
service ; les services portent la logique et parlent à la base.

### Le chaînage des middlewares

L'ordre est significatif et chaque position est justifiée :

```
1. securityHeaders          En-têtes de sécurité
2. traductionDesReponses    AVANT toute route : un message d'erreur part dans
                            la langue de l'interface, connexion comprise
3. express.json             1 Mo, ou 25 Mo pour courriel et import
4. cookieParser
5. /api/licence             AVANT le contrôle de licence : sinon, un essai
                            expiré empêcherait de saisir la clé qui le débloque
6. licenceMiddleware        402 si l'installation n'est plus utilisable
7. /api/auth                AVANT l'authentification, évidemment
8. authMiddleware           401 sans jeton valide
9. dossierMiddleware        Ouvre le dossier de la session, résout le rôle
10. Les 20 routeurs métier  Chacun avec ses contraintes de rôle
11. apiNotFound             Une route d'API inconnue répond en JSON
12. Fichiers statiques      L'interface React compilée
13. errorHandler
```

### La langue de l'interface

Depuis la 1.8.0, chaque utilisateur travaille en français ou en anglais. Deux
langues distinctes coexistent, et ne se confondent jamais :

| | Suit | Porte |
| --- | --- | --- |
| **Langue de l'interface** | L'utilisateur (`users.langue`, registre des comptes) | Écrans, messages, compte rendu de la période, registres CSV |
| **Langue des documents** | Le client (`clients.langue`, dossier d'entreprise) | Factures, devis, notes de crédit, leurs courriels, relances, page de paiement |

**Côté interface**, le texte français est la clé : `t('Nouvelle facture')`
(`client/src/i18n.js`) rend « New invoice » en anglais d'après le dictionnaire
`client/src/traductions/en.js`, qui ne contient que des données. Un texte absent
du dictionnaire s'affiche en français plutôt que vide. Trois compléments :
`tp()` pour le pluriel, dont la règle diffère (« 0 facture », « 0 invoices ») ;
un suffixe de contexte (`|pluriel`) pour départager deux textes que le français
écrit pareil et que l'anglais distingue ; `montant()` pour les sommes, en
« 1 149,75 $ » ou « $1,149.75 ».

**Les valeurs enregistrées ne se traduisent pas** : statuts, cycles
d'abonnement, catégories de dépenses proposées et rôles restent en français en
base, et ne sont traduits qu'à l'affichage. Les filtres et le serveur les
comparent donc tels quels, et une base n'a aucune reprise à subir.

**Côté serveur**, les messages restent écrits en français là où ils sont levés,
puisque c'est là qu'on les lit. L'interface annonce sa langue par l'en-tête
`X-Clora-Langue` à chaque appel ; le middleware `traductionDesReponses` traduit
alors les champs `error` et `message` de la réponse (`traductionServeur.js` :
une table pour les messages fixes, des motifs pour ceux qui portent une valeur,
dont les montants, réécrits à l'anglaise). L'en-tête plutôt que la session :
l'écran de connexion doit pouvoir répondre « Invalid username or password » à
quelqu'un qui n'en a pas encore. Un registre CSV se télécharge par un lien, qui
ne porte pas d'en-tête : sa langue part dans l'adresse (`?langue=en`), et sans
elle le fichier reste celui d'avant, à l'octet près.

**Le test des traductions** (`traductions.test.js`) porte sur tous les écrans et
tous les fichiers du serveur, et non sur une liste : chaque clé employée a sa
traduction et garde ses valeurs (`{n}`), aucun texte visible n'est écrit en dur
dans un écran, et chaque message du serveur a son équivalent anglais. Un écran
ou un message ajouté sans traduction le fait échouer. Seuls deux outils en ligne
de commande, que l'utilisateur ne lance jamais, en sont exclus.

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

Le **préfixe des factures** est un réglage du dossier
(`settings.prefixe_facture`, Paramètres, administrateur seulement) : 2 à 6
lettres ou chiffres, mis en majuscules. Les dossiers antérieurs à la 1.10.1
gardent `SHT`, les initiales de l'éditeur, qui étaient écrites en dur ; un
dossier neuf, qui n'a encore rien facturé, reçoit `FAC`. Les compteurs étant
tenus par préfixe et par mois, changer de préfixe ouvre une série neuve sans
réutiliser aucun numéro, et `DEV` comme `NC` sont refusés pour que les séries
ne se mêlent pas. Le changement est consigné au journal d'audit.

### La date du jour

`dates.js` (et son double `client/src/dates.js`) rend le jour civil **dans le
fuseau du poste**. `new Date().toISOString()` et `date('now')` le rendent en
heure universelle, en avance de quatre ou cinq heures sur le Québec : dès 19 h
ou 20 h, « aujourd'hui » devenait le lendemain, ce qui datait mal les pièces,
affichait en retard une facture due le jour même et, en fin de mois, envoyait
une facture dans la série et la période de taxes du mois suivant.

Seule la **lecture** de la date du jour est locale. L'arithmétique sur des
dates déjà enregistrées (échéances, jours de retard, cycles d'abonnement) reste
en heure universelle, où un jour compte toujours vingt-quatre heures.

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
- **Code de récupération** : 20 caractères tirés au hasard (100 bits), remis à la
  création du compte et gardé sous forme d'empreinte bcrypt dans le registre.
  `POST /api/auth/reinitialiser` l'échange contre un nouveau mot de passe, sous
  la même limitation que la connexion, avec une réponse identique pour un compte
  inconnu, sans code ou un code erroné, et une comparaison bcrypt dans tous les
  cas pour que la durée ne trahisse rien. Le code ne sert qu'une fois.

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

Le module est **asynchrone**. Electron 45 a déclaré obsolètes les fonctions
synchrones de `safeStorage` (`isEncryptionAvailable`, `encryptString`,
`decryptString`), et la 46 les retire. Leurs remplaçantes rendent des promesses
et relisent ce que les anciennes ont chiffré : une installation existante garde
ses secrets. Les anciennes ne servent plus qu'à un Electron qui ignorerait les
nouvelles.

La nouvelle lecture peut aussi **demander de rechiffrer** une valeur
(`shouldReEncrypt`), quand elle a été lue avec une clé que le système a
remplacée. `lireSecret` le fait à la première lecture, pour les trois colonnes
qui portent un secret (`smtp_pass_chiffre`, `stripe_cle_chiffree`,
`sauvegarde_cle`). La réécriture ne touche la ligne que si la valeur n'a pas
changé entre-temps, et n'empêche jamais de lire. Sans elle, le secret serait
perdu d'un coup le jour où l'ancienne clé ne serait plus reconnue. Contrepartie :
une version de Clora antérieure à ce changement pourrait ne plus relire une
valeur ainsi rechiffrée.

**Les sauvegardes, elles, peuvent être chiffrées pour de bon.** La clé des
sauvegardes est tirée par Clora (24 caractères, 120 bits) et imprimée sur une
feuille de secours ; le coffre du système n'en garde qu'un exemplaire de travail.
Format d'un fichier `.clora` : signature `CLORASV1`, longueur et en-tête JSON
(version, série, empreinte de la clé, sel, nonce), données chiffrées en
AES-256-GCM, étiquette d'authentification de 16 octets. L'en-tête est
authentifié avec les données ; la clé de chaque fichier est dérivée de la clé
imprimée et du sel par HKDF-SHA256. L'empreinte (HKDF, 8 octets) fait
reconnaître une clé erronée avant tout déchiffrement, sans permettre de
retrouver la clé. Le chiffrement a lieu dans le répertoire de la base : aucune
copie en clair n'atteint le dossier de destination. Si le coffre ne rend plus la
clé, les sauvegardes s'arrêtent plutôt que de repartir en clair, et le tableau
de bord le signale.

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
| **La base n'est pas chiffrée au repos** | Seuls les secrets le sont, et les sauvegardes quand la protection est activée. Quelqu'un qui a accès au disque de l'ordinateur a accès à la comptabilité : c'est le modèle d'un logiciel de bureau mono-poste |
| **Protection des sauvegardes facultative** | Elle s'active dans Paramètres, et le tableau des premiers pas la propose. Les copies antérieures à la 1.9.1, dont on ignore le dossier, ne sont jamais chiffrées d'office : l'utilisateur les supprime lui-même |
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

**Une série de sauvegardes par dossier.** Chaque base porte un identifiant
permanent, `settings.dossier_uid`, attribué à la fin de `initDb` et rangé dans
la base elle-même : il suit la comptabilité jusque dans ses sauvegardes et sur
un nouvel ordinateur. Les noms le reprennent, `clora-<série>-<horodatage>.sqlite`
(série : les 12 premiers caractères de l'identifiant). La liste, la rétention
(les 30 plus récentes) et le contrôle « dernière sauvegarde de moins de 24 h »
ne portent que sur la série du dossier. Les copies sans série, antérieures à la
1.9.1, et celles d'une autre série sont rendues à part (`autres`) et ne sont
jamais supprimées automatiquement.

**La copie est produite à côté de la base, puis déposée d'un coup.**
`VACUUM INTO` écrit un fichier temporaire dans le répertoire du dossier, copié
vers la destination sous un nom en `.partiel`, puis renommé. Les fichiers de
travail abandonnés depuis plus d'une heure sont nettoyés au passage suivant.

**La restauration ne remplace pas la base pendant qu'elle est ouverte.**

1. `POST /api/sauvegardes/examiner` lit une copie locale de la sauvegarde et
   rend l'entreprise, le nombre de factures et de clients, et `meme_dossier`
   (vrai, faux, ou `null` pour une copie sans identifiant).
2. `POST /api/sauvegardes/restaurer` prépare la base à côté de sa cible
   (`<base>.restauration`), la contrôle (intégrité SQLite, présence du schéma
   Clora), puis l'accorde au poste : réglages de sauvegarde repris de la base
   actuelle ; identifiant conservé, attribué (copie sans identifiant) ou
   renouvelé (copie d'un autre dossier du poste). Un marqueur qui nomme sa cible
   est déposé dans le même répertoire, le journal WAL est reporté dans la base,
   et l'application redémarre.
3. Au démarrage, `initDb` applique le marqueur avant toute connexion, et
   seulement s'il désigne cette base : une demande sans cible est écartée. La
   base remplacée est conservée à côté sous
   `database.sqlite.avant-restauration-<horodatage>`, avec son journal WAL.

Jusqu'à la 1.9.0, le marqueur était déposé à la racine des données, loin des
dossiers rangés dans `entreprises/` : la restauration ne s'appliquait jamais sur
une installation récente, et pouvait remplacer le premier dossier sur une
installation antérieure au multi-dossier.

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

**459 tests**, exécutés par `node --test`. Répartition :

| Domaine | Tests |
| --- | --- |
| Paiement en ligne Stripe | 33 |
| Sauvegardes et restauration | 30 |
| Sauvegardes à plusieurs dossiers | 15 |
| Sauvegardes chiffrées | 12 |
| Code de récupération | 6 |
| Indemnité kilométrique | 17 |
| Import de tableur | 19 |
| Rapprochement bancaire | 19 |
| Cycle de vie des factures | 18 |
| Relances automatiques | 17 |
| Notes de crédit | 17 |
| Envoi de courriels | 16 |
| Compte rendu de gestion | 16 |
| Licence et maintenance | 15 |
| Exports CSV | 18 |
| Conditions de paiement | 15 |
| Journal d'audit | 16 |
| Encaissements et annulations | 14 |
| API et cloisonnement des rôles | 14 |
| Profils, premiers pas et visite guidée | 16 |
| Devis | 12 |
| Montants figés | 11 |
| Mises à jour | 10 |
| Balance âgée | 9 |
| Multi-entreprise et premier lancement | 11 |
| Coffre des secrets | 12 |
| Préfixe des factures | 8 |
| Date du jour et fuseau horaire | 6 |
| Abonnements | 8 |
| Apparence de l'interface | 10 |
| Arithmétique monétaire | 8 |
| Traduction de l'interface | 7 |
| Documents dans la langue du client | 4 |

Deux partis pris méritent d'être signalés :

**Les tests monétaires comparent JavaScript et SQL** sur plusieurs milliers de
montants générés. Une divergence entre les deux implémentations ferait qu'un
écran et un export affichent des chiffres différents.

**Les tests Stripe passent par un vrai serveur HTTP local**, et non par un
simulacre en mémoire. Ils éprouvent donc l'encodage réel des requêtes, les
en-têtes d'authentification et la version d'API épinglée.

**Les décisions visuelles sont écrites en tests.** `apparence.test.js` en porte
dix, qui lisent les sources de l'interface plutôt que son rendu. Une décision
de design qui n'est écrite nulle part revient d'elle-même au bout de trois
écrans ; celles-ci sont écrites, avec la raison qui les a produites :

| Règle | Ce qu'elle empêche de revenir |
| --- | --- |
| Pas de bande de couleur sur un conteneur | Le contour des panneaux était blanc sur un fond perle, donc invisible : la bande était la seule limite visible d'une carte |
| Le contour des conteneurs est un gris visible | Le jeton était à 0,9 d'opacité en blanc, et à 0,05 en thème sombre |
| Aucun émoji dans l'interface | Un émoji est rendu par la police du système : le bouton « Supprimer » avait un texte rouge et une corbeille grise |
| Le rouge d'un indicateur est conditionnel | Une couleur fixe étiquette au lieu de signaler ; le bénéfice net était violet qu'il fût positif ou négatif |
| Aucune couleur écrite en dur dans une cellule | Une valeur en dur ne suit pas les deux thèmes |
| La bulle d'aide est atteignable au clavier | Elle ne répondait qu'au survol, et trois de ses emplacements étaient rognés par un conteneur de défilement |
| Les polices sont embarquées et bien nommées | Elles étaient nommées sans être chargées : Windows affichait Segoe UI |
| L'espacement se tient sur son échelle | Cinq cents déclarations employaient deux grilles incompatibles, à parts égales |
| L'anneau de focus suit son jeton, et une fenêtre modale l'est vraiment | Le turquoise mesurait 2,14:1 sur un panneau clair, et une fenêtre annonçait `aria-modal` sans retenir le focus |
| Le texte indicatif d'un champ de recherche tient dans son champ | Quatre champs sur six coupaient leur texte en plein mot : « Rechercher un numéro ou ur » |

Ces tests ne remplacent pas le coup d'œil : ils empêchent une régression, ils ne
jugent pas une mise en page. Chacun a été éprouvé en reposant le défaut qu'il
surveille.

**Les documents du client sont relus pour leur langue.** `documents.test.js`
exécute la traduction des noms de taxes et le dictionnaire du gabarit, extraits
du composant, puis relit le reste du gabarit : aucun « n° », aucun nom de taxe
ni aucun deux-points n'y est plus écrit en dur. Il existe parce qu'une facture
anglaise affichait « TVH (13%) » et « Issue Date : » depuis le début, sans
qu'aucun test ni aucun testeur ne l'ait vu.

### L'atelier d'intégration continue

`.github/workflows/ci.yml`, déclenché sur chaque demande de fusion et sur chaque
poussée vers `master` :

```
npm ci  →  npm test  →  npm test (heure de Montréal)  →  npm ci (client)
        →  npx eslint .  →  npm run build  →  xvfb-run npm run test:e2e
```

Deux étapes existent parce que la suite ordinaire ne pouvait pas voir ce
qu'elles attrapent. Le **second passage à l'heure de Montréal** (`TZ`) révèle
une date lue dans le mauvais fuseau, invisible sur une machine en heure
universelle. Les **essais de bout en bout** (`tests/e2e/`) lancent la vraie
application de bureau. `fermeture.js` crée un compte, ferme la fenêtre et
vérifie la sortie propre, la sauvegarde de fin de journée et la consolidation
des journaux : tout ce qui ne vit que dans `main.js`. `coffre.js` pose une clé
de sauvegarde et un mot de passe de courriel, ferme, relance, et vérifie que le
coffre du système les a protégés puis rendus à l'identique, sans qu'aucune
fonction déclarée obsolète par Electron ne soit appelée. Il est le filet des
mises à jour d'Electron : c'est une version majeure qui avait rendu obsolètes
les fonctions sur lesquelles reposait le coffre. Sous Linux, le coffre n'est pas
celui de Windows : cet essai ne dit rien de la relecture, sur un vrai poste, des
secrets d'une installation existante.

`.github/dependabot.yml` surveille les dépendances du serveur, de l'interface
et des workflows, et propose leurs mises à jour chaque semaine.

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
Environ 123 Mo.

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
| **Electron 45 chez les autres testeurs** | Le passage à Electron 45 est vérifié sous Linux dans la vraie application, et sous Windows par une fabrication d'essai installée par-dessus la 1.10.1 sur un poste réel : les secrets enregistrés ont été relus par le nouveau coffre. Un seul poste a fait cet essai ; les autres le feront à la publication |
| **Facture modifiable après envoi** | Tant qu'elle n'est pas payée, une facture déjà envoyée au client se modifie, sans trace de l'envoi ni du changement |
| **Journal d'audit incomplet** | Modifier ou supprimer une dépense, rapprocher un dépôt, modifier un abonnement : rien n'est consigné |
| **Aucune date de verrouillage** | Une dépense d'une période déjà déclarée se modifie ou se supprime librement |
| **Pas de pièces justificatives** | Aucun reçu ne peut être joint à une dépense |
| **PDF en image** | La facture envoyée par courriel est une image : texte non sélectionnable, illisible par un lecteur d'écran, fichier lourd |
| **Dossiers et clients** | Ni renommage ni archivage d'un dossier, ni archivage d'un client |
| **Aucun fichier journal** | Sur un poste installé, les messages d'erreur ne sont écrits nulle part |
| **Durcissement du poste** | Le serveur local répond à n'importe quel en-tête `Host` ; la fenêtre n'a ni politique de contenu, ni blocage de la navigation externe |
| **Bandeau de mise à jour** | Le cas positif n'a jamais été observé sur un vrai Windows. La 1.11.0 en offre l'occasion sur toute installation restée en 1.10.1 |
| **Redémarrage après restauration** | Vérifié de bout en bout dans l'application de bureau sous Linux en 1.9.1, puis de nouveau en 1.10.1 (restauration appliquée, redémarrage automatique). Reste à l'observer sur un vrai Windows |
| **Sauvegarde à la fermeture** | Vérifiée à chaque fusion par l'essai de bout en bout, sous Linux, et observée le 12 novembre sur un poste Windows lors de l'essai d'Electron 45. Reste à la confirmer chez les autres testeurs |

---

*Clora est un logiciel de Safehill Technologies. Code source consultable, non
libre de droits : voir [LICENSE](../LICENSE).*
