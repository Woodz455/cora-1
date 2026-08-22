/**
 * Dossier actif de la requête en cours.
 *
 * Les seize routeurs reçoivent tous une fonction `getDb()` sans argument, et
 * l'appellent en 81 endroits. Pour qu'elle rende la base du dossier ouvert, il
 * fallait soit lui passer la requête — donc réécrire ces 81 appels et toutes
 * les signatures qui les portent —, soit transporter le contexte autrement.
 *
 * `AsyncLocalStorage` le transporte. Un intergiciel place la base du dossier
 * dans le magasin au début de la requête ; tout ce qui s'exécute ensuite dans
 * cette chaîne asynchrone la retrouve, y compris au fond d'un service appelé
 * par une route appelée par un routeur. Aucune signature ne change.
 *
 * La contrepartie est réelle et vaut d'être connue : du code qui **sort** de la
 * chaîne asynchrone — un `setTimeout`, un émetteur d'événements — perd le
 * contexte. C'est pourquoi le planificateur, qui tourne sur minuterie et non
 * sur requête, reçoit sa base explicitement plutôt que par ce canal.
 */

const { AsyncLocalStorage } = require('node:async_hooks');

const magasin = new AsyncLocalStorage();

/**
 * Exécute une fonction avec un dossier pour contexte.
 *
 * @param {{db: Object, entreprise: Object}} contexte
 * @param {Function} suite
 */
function avecDossier(contexte, suite) {
  return magasin.run(contexte, suite);
}

/** Contexte du dossier courant, ou undefined hors requête. */
function contexteCourant() {
  return magasin.getStore();
}

/**
 * Base du dossier courant.
 *
 * Lève plutôt que de rendre `undefined` : une requête qui atteindrait le code
 * métier sans dossier écrirait sinon dans le vide, ou pire, produirait une
 * erreur incompréhensible à des centaines de lignes de la cause réelle.
 */
function baseCourante() {
  const contexte = magasin.getStore();
  if (!contexte || !contexte.db) {
    throw Object.assign(
      new Error("Aucun dossier d'entreprise n'est ouvert pour cette requête."),
      { status: 409, expose: true }
    );
  }
  return contexte.db;
}

/** Dossier courant — identifiant, nom, chemin —, ou null hors requête. */
function entrepriseCourante() {
  const contexte = magasin.getStore();
  return contexte && contexte.entreprise ? contexte.entreprise : null;
}

module.exports = { avecDossier, contexteCourant, baseCourante, entrepriseCourante };
