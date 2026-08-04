# Clora

Application de bureau de facturation, devis et suivi financier pour les PME
canadiennes. Interface React, API Express, base SQLite locale, empaquetée avec
Electron.

> **Vous cherchez à installer Clora, pas à le compiler ?**
> Téléchargez l'installateur Windows depuis la [dernière publication][versions]
> et suivez [INSTALLATION.md](INSTALLATION.md). Ce qui suit s'adresse au
> développement.

[versions]: https://github.com/Woodz455/cora-1/releases/latest

Le code est consultable, mais il n'est pas libre de droits : voir
[LICENSE](LICENSE).

## Démarrage

```bash
npm install
cd client && npm install && cd ..

npm start          # serveur (port 3000) + interface Vite (port 5173)
npm run electron:dev   # les deux, dans la fenêtre Electron
```

Au premier lancement, l'application demande de créer un compte administrateur.

## Installateur Windows

L'utilisateur final reçoit un unique fichier `.exe` : un double-clic installe
Clora sans poser de question, sans demande d'autorisation administrateur, et
place une icône sur le bureau. La marche à suivre côté utilisateur est décrite
dans [INSTALLATION.md](INSTALLATION.md).

**Fabrication.** Poser une étiquette de version suffit ; le workflow
[`release.yml`](.github/workflows/release.yml) compile sur une machine Windows
et dépose le fichier sur la page des publications :

```bash
git tag v1.2.0 && git push origin v1.2.0
```

Ce détour est obligatoire : `sqlite3` est une bibliothèque native, et son
binaire Windows n'est téléchargé que par un `npm ci` exécuté sous Windows. La
compilation depuis Linux ou macOS produirait un installateur inutilisable.

Depuis une machine Windows, la fabrication manuelle est&nbsp;:

```bash
npm ci
cd client && npm ci && cd ..
npm run build          # produit dist/Clora-Installateur-<version>.exe
```

**Le fichier n'est pas signé.** Windows affichera donc « Windows a protégé
votre ordinateur » au premier lancement, et il faut passer par *Informations
complémentaires → Exécuter quand même*. Supprimer cet avertissement demande un
certificat de signature de code payant ; le jour où l'on en dispose, il suffit
de renseigner `CSC_LINK` et `CSC_KEY_PASSWORD` dans les secrets du dépôt, sans
autre changement.

**Visuels.** Tous les dérivés du logo sont produits par `npm run visuels` à
partir de `image/clora-source.png`, l'œuvre d'origine : logotype détouré,
symbole carré, et l'icône Windows `image/clora.ico` en sept tailles. Ils sont
versionnés — ne relancer la commande que si le logo change.

Le logo existe sous **deux formes**, et ce n'est pas une coquetterie. Le
logotype large sert partout où la place le permet ; le symbole carré — la
flèche verte — sert à l'icône Windows et à l'onglet du navigateur, qui sont
carrés. Une icône s'affiche en 16 × 16 px dans la barre des tâches : un mot de
750 px de large y serait illisible.

Une variante éclaircie du logotype (`logotype-sombre.png`) prend le relais en
thème sombre, où le bleu marine disparaîtrait sur le panneau foncé.

## Scripts

| Commande | Rôle |
| --- | --- |
| `npm start` | Serveur et interface en mode développement |
| `npm run electron:dev` | Application de bureau en mode développement |
| `npm run build` | Compile l'interface et produit l'installateur (sous Windows) |
| `npm run visuels` | Régénère logotype, symbole et icône depuis `image/clora-source.png` |
| `npm test` | Suite de tests (calculs financiers, rôles, API) |
| `npm run doctor` | Diagnostique les anomalies dans les données comptables |
| `npm run doctor -- --corriger-statuts` | Réaligne le statut des factures sur leurs montants |
| `npm run doctor -- --refiger-montants` | Recalcule les montants depuis les lignes, en cas de dérive signalée |
| `npm run doctor -- --annuler-surpaiements` | Défait les encaissements issus d'un rapprochement qui dépassent le total de la facture |
| `npm run db:init` | Crée ou met à jour le schéma de la base |
| `npm run seed:demo` | Insère un jeu de données de démonstration (base vide seulement) |
| `node reset_data.js --confirmer` | Efface factures, devis et paiements (sauvegarde automatique) |

## Configuration

Un fichier `.env` optionnel, à la racine, permet de régler :

```ini
# Signature des sessions. Généré automatiquement au premier lancement
# (fichier .jwt-secret) si absent. 32 caractères minimum.
JWT_SECRET=

# Envoi des factures et des relances par courriel
SMTP_HOST=smtp.exemple.ca
SMTP_PORT=587
SMTP_USER=compta@exemple.ca
SMTP_PASS=

PORT=3000
HOST=127.0.0.1     # l'API n'est pas exposée au réseau local par défaut
SESSION_HOURS=12
```

`.env`, `.jwt-secret` et `database.sqlite` ne sont pas versionnés : ils
contiennent des secrets et les données réelles de l'entreprise.

## Rôles

| Rôle | Accès |
| --- | --- |
| `employe` | Factures, devis, clients, catalogue |
| `comptable` | En plus : encaissements, annulations, dépenses, rapports, banque, abonnements |
| `admin` | Accès complet, dont les paramètres, les comptes et la suppression de factures |

Le serveur applique ces règles sur chaque route ; l'interface se contente de ne
pas proposer ce qui serait refusé.

## Organisation du code

```
config.js          Emplacement des données, secret de session, port et hôte
database.js        Schéma, migrations et index
money.js           Arithmétique monétaire (JavaScript et SQL alignés)
sequences.js       Numérotation des documents, jamais réattribuée
dbUtils.js         Transactions sérialisées et réentrantes
validators.js      Validation des données entrantes
rateLimit.js       Limitation des tentatives de connexion
scheduler.js       Passage horaire : factures récurrentes et relances dues
bankService.js     Rapprochement bancaire et imputation des dépôts
*Service.js        Logique métier par domaine
routes/            Points d'entrée HTTP, avec leurs contraintes de rôle
tests/             Tests exécutés par `npm test`
client/src/        Interface React
```

## Règles comptables

- **Montants arrêtés à l'émission.** Sous-total, taxes et total sont calculés
  une fois, au moment où le document est créé, puis conservés tels quels. Ils ne
  sont jamais recalculés depuis les lignes à la lecture : une facture remise à un
  client garde son montant, quelles que soient les évolutions ultérieures des
  taux ou de la règle d'arrondi. Ils ne sont réarrêtés que si le document est
  modifié dans l'application, ce qu'un paiement encaissé interdit.
- **Taxes par province.** Les taux découlent de la province du client
  (TPS/TVQ au Québec, TVH en Ontario, TPS/TVP dans l'Ouest…) et sont eux aussi
  figés à l'émission.
- **Arrondi.** Chaque taxe est calculée sur le sous-total hors taxes et arrondie
  au cent séparément ; le total est la somme de ces valeurs arrondies.
- **Devises.** Une facture porte sa devise et le taux de change appliqué à
  l'émission. Les rapports consolident tout en dollars canadiens.
- **Conservation.** Une facture comportant un paiement ne peut être ni modifiée,
  ni annulée, ni supprimée : elle doit faire l'objet d'une note de crédit.
- **Note de crédit ou annulation de paiement ?** La note de crédit corrige ce
  que le client **doit**, et reprend les taxes correspondantes — elle vaut pour
  un retour de marchandise ou une remise accordée après coup. L'annulation d'un
  encaissement corrige ce que l'entreprise a **reçu**, sans toucher aux taxes :
  elle vaut pour une erreur de saisie. Créditer une facture pour rattraper un
  paiement mal saisi récupérerait à tort de la taxe sur un montant jamais
  facturé.

## Encaissements

Un paiement est enregistré depuis la facture, ou par rapprochement d'une
transaction bancaire. Il ne peut jamais dépasser le solde restant.

Un encaissement saisi à tort — chèque sans provision, montant erroné, dépôt
pointé sur la mauvaise facture — s'annule depuis la fenêtre de paiement, où
figure l'historique complet.

- **La ligne n'est jamais effacée** : elle reste visible, barrée, avec la date
  de l'annulation, son auteur et son motif. Un mouvement d'argent qui
  disparaîtrait sans trace serait injustifiable en vérification.
- Un paiement annulé cesse aussitôt de compter dans le solde, le statut de la
  facture, le chiffre d'affaires et le tableau de bord.
- L'annulation est **réservée à l'administrateur** : le comptable enregistre les
  encaissements, revenir sur l'un d'eux touche à un montant déjà porté aux
  comptes.
- Si le paiement venait du rapprochement bancaire, **la transaction repasse en
  attente** et se détache de la facture : le dépôt retourne dans la file, prêt à
  être affecté correctement.

## Rapprochement bancaire

Un relevé s'importe au format CSV : les colonnes de date, de description et de
montant sont détectées automatiquement, seuls les dépôts sont retenus, et les
lignes déjà présentes sont ignorées.

**Un dépôt peut régler plusieurs factures.** Il s'impute autant de fois que
nécessaire et reste dans la file tant qu'il lui demeure quelque chose à
affecter : un virement global de 3 000 $ solde d'abord une facture de 113 $,
puis une autre, et ainsi de suite.

- La colonne **Part** permet d'imputer un montant précis. Laissée vide, elle
  affecte le plus petit du reste du dépôt et du solde de la facture — le geste
  courant, qui ne demande aucune saisie.
- Une part ne peut dépasser ni le reste du dépôt, ni le solde de la facture.
- Le statut suit l'imputation : `En attente`, `Partiellement rapproché`, puis
  `Rapproché` une fois le dépôt épuisé.
- **Le montant déjà imputé n'est pas stocké**, il se déduit des encaissements
  qui désignent le dépôt. Un total conservé en base aurait fini par diverger —
  annulation d'un encaissement, suppression d'une facture — sans que rien ne le
  signale.
- Annuler un encaissement libère aussitôt la part correspondante : le dépôt
  redevient imputable pour ce montant.
- Une facture en devise étrangère est refusée : un dépôt en dollars canadiens
  imputé tel quel sur un solde en dollars américains fausserait les deux.

## Notes de crédit

Une facture émise ne se corrige pas : on lui oppose un second document, qui
porte son propre numéro (`NC-AAAAMM-NNNN`) et sa propre date. C'est ce document
qui réduit ce que le client doit, sans jamais toucher à la pièce d'origine.

- Les taux de taxe de la note sont **ceux de la facture créditée**, pas ceux des
  paramètres du jour : créditer en janvier une facture de l'an dernier applique
  bien les taux de l'an dernier.
- Le cumul des crédits ne peut pas dépasser le total de la facture.
- Une facture portant une note de crédit ne peut plus être modifiée, annulée ni
  supprimée : ses montants sont désormais engagés dans un autre document.
- Une facture intégralement créditée passe au statut `Créditée`. Si les
  paiements dépassent le montant net dû, la facture affiche le montant à
  rembourser au client.
- L'émission est réservée à l'administrateur et au comptable ; l'annulation
  d'une note, au seul administrateur.
- Dans les rapports de taxes, les crédits sont déduits sur **la période de la
  note**, et non sur celle de la facture d'origine.

## Relances automatiques

Activées dans les paramètres, elles envoient un rappel de paiement dès qu'une
facture impayée franchit l'un des paliers de retard configurés (`7,15,30` jours
par défaut).

- Un palier ne part **qu'une fois par facture** ; c'est le palier le plus élevé
  franchi qui est retenu, jamais plusieurs d'un coup.
- Une facture annulée, soldée, entièrement créditée, non échue, ou dont le
  client n'a pas d'adresse courriel, est écartée.
- Le rappel reprend le solde **net des notes de crédit** et suit la langue du
  client (français ou anglais).
- Chaque envoi — réussi ou en échec — est consigné ; un échec SMTP n'interrompt
  pas les suivants et le palier reste à envoyer au prochain passage.
- Le rappel automatique est un courriel **texte** : le PDF est produit par le
  navigateur et n'existe pas côté serveur. Pour l'envoyer en pièce jointe,
  utiliser le bouton « Relancer » de la liste des factures.
- Le passage a lieu chaque heure (`scheduler.js`) ; les paramètres permettent
  aussi de le déclencher à la demande, après avoir prévisualisé les factures
  concernées.

L'envoi exige une configuration SMTP (voir la section Configuration).

## Sauvegardes

L'application détient l'unique exemplaire de la comptabilité : une copie datée
est donc produite automatiquement, **activée par défaut**.

- **Quand.** Une par jour, vérifiée à chaque passage horaire du planificateur,
  plus une à la fermeture de l'application — un poste éteint chaque soir
  n'atteindrait jamais l'échéance autrement.
- **Où.** `sauvegardes/` dans le dossier de données, ou tout dossier choisi
  dans les Paramètres. **Viser un dossier synchronisé** (OneDrive, Dropbox,
  Google Drive) est ce qui fait sortir la copie de la machine, et donc ce qui
  protège réellement d'une panne de disque ou d'un vol.
- **Combien.** Les 30 plus récentes par défaut ; au-delà, les plus anciennes
  sont supprimées. Les fichiers étrangers au dossier ne sont jamais touchés.

La copie passe par `VACUUM INTO` et non par une copie de fichier. La base
tourne en mode WAL : dupliquer `database.sqlite` pendant une écriture donnerait
un fichier amputé de tout ce qui n'a pas encore été reporté depuis le journal.

**Restauration.** Depuis les Paramètres, réservée à l'administrateur. La
sauvegarde est d'abord contrôlée (intégrité SQLite, présence du schéma Clora) :
un fichier douteux est refusé sans que rien ne soit modifié. Le remplacement
n'a pas lieu tant que la base est ouverte — une demande est enregistrée, puis
appliquée au redémarrage, alors qu'aucune connexion ni journal ne décrit encore
l'ancienne base. La base remplacée est conservée à côté sous
`database.sqlite.avant-restauration-<horodatage>` : une restauration sur le
mauvais fichier reste réversible.

## Mises à jour

Au premier écran suivant la connexion, et une fois par jour au plus, Clora
compare sa version à la dernière publiée. Si une version plus récente existe,
un bandeau discret le signale avec un lien vers la page de téléchargement,
ouverte dans le navigateur du système.

**Rien n'est téléchargé ni installé par l'application.** C'est délibéré :
l'application n'étant pas signée, `electron-updater` exécuterait un binaire
dont l'origine n'est vérifiée par rien — la vérification de signature est
précisément ce qui est désactivé faute de certificat. Sur un logiciel qui
détient la comptabilité d'une entreprise, ce n'est pas acceptable. Le jour où
un certificat existe, la mise à jour silencieuse devient envisageable.

C'est **le seul appel sortant de l'application**, et il se coupe depuis les
Paramètres. La vérification n'a lieu qu'en mode empaqueté, échoue en silence
hors ligne ou derrière un pare-feu, et n'affiche jamais rien dans ce cas.

## Conditions de paiement

Chaque client porte un terme — payable sur réception, Net 15, Net 30, Net 60 —
qui détermine l'échéance des factures émises pour lui. Net 30 par défaut.

Le terme est **figé sur la facture à l'émission**, au même titre que les taux de
taxe : changer les conditions d'un client ne déplace jamais l'échéance d'un
document déjà remis. La date reste modifiable au cas par cas, pour un accord
ponctuel, sans toucher à la fiche du client.

La conversion d'un devis applique elle aussi le terme du client, là où elle
imposait trente jours à tous indistinctement.

Le calcul d'échéance raisonne en UTC des deux côtés (`paymentTerms.js` et
`client/src/api.js`) : un décalage de fuseau ferait basculer la date d'un jour,
et fausserait du même coup les relances et la balance âgée, qui en dépendent.

## Balance âgée

Écran Rapports : ce qui vous est dû, ventilé par ancienneté du retard — non
échu, 1 à 30, 31 à 60, 61 à 90, 91 jours et plus — par client puis en total,
exportable en CSV.

Les bornes sont inclusives des deux côtés : un retard de 30 jours appartient à
« 1 à 30 », un retard de 31 bascule dans la tranche suivante. Le retard se
calcule en jours entiers depuis l'échéance, par `julianday` côté base, pour
éviter les décalages de fuseau d'un calcul fait au navigateur.

Le solde retenu est **net des paiements et des notes de crédit**, converti en
dollars canadiens, et exclut les factures annulées comme les paiements annulés :
la balance emprunte les mêmes expressions SQL que les écrans de facturation, et
son total doit donc toujours égaler le « Reste à percevoir » de la vue
d'ensemble.

## Registres pour le comptable

Deux exports CSV depuis l'écran Rapports, suivant la période sélectionnée :

- **Registre des ventes** — une ligne par facture : numéro, dates, client,
  statut, sous-total, chaque taxe nommée et chiffrée, total, crédité, encaissé,
  solde, devise et équivalent en dollars canadiens. Les factures annulées en
  sont absentes.
- **Registre des encaissements** — une ligne par paiement reçu, avec son
  origine (saisie manuelle ou rapprochement bancaire). **Les paiements annulés
  en sont exclus** : les faire figurer gonflerait les rentrées déclarées.

Les montants exportés sont ceux **figés à l'émission**, lus tels quels : un
export qui recalculerait ses totaux pourrait diverger de ce que le client a
reçu.

Trois détails décident de l'utilisabilité du fichier chez son destinataire :
BOM UTF-8 (sans quoi Excel affiche « BÃ©langer »), séparateur point-virgule
(l'Excel francophone empile sinon toute la ligne dans une colonne), et virgule
décimale sur les montants. L'échappement suit la RFC 4180 : un client nommé
« Ateliers Bélanger; Cie » ressort intact.

## Journal d'audit

Les actions sensibles sont consignées dans `logs_audit` : annulation d'un
encaissement, annulation ou suppression d'une facture, suppression d'une note de
crédit, modification d'un client, **changement des taux de taxe**, création,
modification ou suppression d'un compte, changement d'identifiants,
restauration d'une sauvegarde.

Chaque entrée porte l'horodatage, l'auteur, son rôle et l'écart constaté —
uniquement les champs qui ont changé, sous la forme « avant → après ».

**En ajout seul, garanti par la base.** Deux déclencheurs SQLite refusent tout
`UPDATE` et tout `DELETE` sur la table : la garantie ne repose pas sur l'absence
de route, mais sur un refus de SQLite quel que soit le chemin emprunté. Un
journal réécrivable ne prouverait rien. En contrepartie, le journal ne se purge
pas — c'est le bon défaut pour une piste d'audit comptable, et le volume reste
modeste puisque seules les actions sensibles y entrent.

Deux règles sur le contenu : aucun secret n'y figure (mots de passe et
empreintes sont remplacés par une mention), et le logo d'entreprise en est
exclu — c'est un data-URI de plusieurs mégaoctets, sans portée comptable.

La consultation se fait depuis l'onglet **Journal**, ouvert à l'administration
et à la comptabilité, avec filtres par action, auteur et période. La pagination
est faite par le serveur, contrairement aux autres écrans de liste : le journal
est la seule table qui ne fait que croître.

Écrire au journal ne peut pas faire échouer l'action métier : refuser d'annuler
un encaissement saisi à tort serait plus dommageable que de perdre une ligne de
trace. Un échec part en erreur console.

## Tests

```bash
npm test
```

La suite couvre l'arithmétique monétaire (dont l'égalité entre les calculs
JavaScript et SQL sur plusieurs milliers de montants), le cycle de vie des
factures, les encaissements et leur annulation, les notes de crédit, les
relances automatiques, la conversion des devis, la facturation récurrente, le
rapprochement bancaire — y compris la répartition d'un dépôt sur plusieurs
factures — et le cloisonnement des rôles.
