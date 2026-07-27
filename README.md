# Clora

Application de bureau de facturation, devis et suivi financier pour les PME
canadiennes. Interface React, API Express, base SQLite locale, empaquetée avec
Electron.

## Démarrage

```bash
npm install
cd client && npm install && cd ..

npm start          # serveur (port 3000) + interface Vite (port 5173)
npm run electron:dev   # les deux, dans la fenêtre Electron
```

Au premier lancement, l'application demande de créer un compte administrateur.

## Scripts

| Commande | Rôle |
| --- | --- |
| `npm start` | Serveur et interface en mode développement |
| `npm run electron:dev` | Application de bureau en mode développement |
| `npm run build` | Compile l'interface et produit l'installateur |
| `npm test` | Suite de tests (calculs financiers, rôles, API) |
| `npm run doctor` | Diagnostique les anomalies dans les données comptables |
| `npm run doctor -- --corriger-statuts` | Réaligne le statut des factures sur leurs montants |
| `npm run doctor -- --refiger-montants` | Recalcule les montants depuis les lignes, en cas de dérive signalée |
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

## Tests

```bash
npm test
```

La suite couvre l'arithmétique monétaire (dont l'égalité entre les calculs
JavaScript et SQL sur plusieurs milliers de montants), le cycle de vie des
factures, les notes de crédit, les relances automatiques, la conversion des
devis, la facturation récurrente, le rapprochement bancaire et le cloisonnement
des rôles.
