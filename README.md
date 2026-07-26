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
| `npm run db:init` | Crée ou met à jour le schéma de la base |
| `npm run seed:demo` | Insère un jeu de données de démonstration (base vide seulement) |
| `node reset_data.js --confirmer` | Efface factures, devis et paiements (sauvegarde automatique) |

## Configuration

Un fichier `.env` optionnel, à la racine, permet de régler :

```ini
# Signature des sessions. Généré automatiquement au premier lancement
# (fichier .jwt-secret) si absent. 32 caractères minimum.
JWT_SECRET=

# Envoi des factures par courriel
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
scheduler.js       Génération périodique des factures récurrentes
*Service.js        Logique métier par domaine
routes/            Points d'entrée HTTP, avec leurs contraintes de rôle
tests/             Tests exécutés par `npm test`
client/src/        Interface React
```

## Règles comptables

- **Taxes par province.** Les taux découlent de la province du client
  (TPS/TVQ au Québec, TVH en Ontario, TPS/TVP dans l'Ouest…) et sont figés à
  l'émission du document : une facture passée ne change jamais de montant.
- **Arrondi.** Chaque taxe est calculée sur le sous-total hors taxes et arrondie
  au cent séparément ; le total est la somme de ces valeurs arrondies. La base
  et l'interface appliquent la même règle, vérifiée par les tests.
- **Devises.** Une facture porte sa devise et le taux de change appliqué à
  l'émission. Les rapports consolident tout en dollars canadiens.
- **Conservation.** Une facture comportant un paiement ne peut être ni modifiée,
  ni annulée, ni supprimée : elle doit faire l'objet d'une note de crédit.

## Tests

```bash
npm test
```

La suite couvre l'arithmétique monétaire (dont l'égalité entre les calculs
JavaScript et SQL sur plusieurs milliers de montants), le cycle de vie des
factures, la conversion des devis, la facturation récurrente, le rapprochement
bancaire et le cloisonnement des rôles.
