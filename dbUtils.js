/**
 * Utilitaires de transaction.
 *
 * L'application partage une unique connexion SQLite entre toutes les requêtes
 * HTTP. Un `BEGIN` émis pendant qu'une autre transaction est déjà ouverte
 * provoquait au mieux une erreur, au pire un `COMMIT` validant les écritures
 * d'une requête voisine.
 *
 * Deux mécanismes règlent le problème :
 *  - les transactions racine sont sérialisées dans une file ;
 *  - un appel imbriqué (une opération transactionnelle appelée depuis une autre,
 *    comme la création de facture lors de la conversion d'un devis) rejoint la
 *    transaction en cours via un SAVEPOINT au lieu de se bloquer sur la file.
 *
 * L'appartenance à une transaction est suivie par contexte asynchrone : deux
 * requêtes HTTP simultanées ne peuvent donc pas se croire dans la même transaction.
 */

const { AsyncLocalStorage } = require('node:async_hooks');

const contexte = new AsyncLocalStorage();

let queue = Promise.resolve();
let savepointCounter = 0;

/** Transaction racine : ouvre, valide, ou annule intégralement. */
async function runRoot(db, fn) {
  await db.exec('BEGIN IMMEDIATE;');
  try {
    const result = await fn();
    await db.exec('COMMIT;');
    return result;
  } catch (error) {
    try {
      await db.exec('ROLLBACK;');
    } catch (rollbackError) {
      // Journalisé sans écraser l'erreur métier, seule utile à l'appelant.
      console.error('Échec du ROLLBACK :', rollbackError.message);
    }
    throw error;
  }
}

/** Transaction imbriquée : délimitée par un point de sauvegarde. */
async function runNested(db, fn) {
  const nom = `sp_${++savepointCounter}`;
  await db.exec(`SAVEPOINT ${nom};`);
  try {
    const result = await fn();
    await db.exec(`RELEASE ${nom};`);
    return result;
  } catch (error) {
    try {
      await db.exec(`ROLLBACK TO ${nom};`);
      await db.exec(`RELEASE ${nom};`);
    } catch (rollbackError) {
      console.error('Échec du ROLLBACK TO SAVEPOINT :', rollbackError.message);
    }
    throw error;
  }
}

/**
 * Exécute `fn` dans une transaction.
 *
 * @template T
 * @param {import('sqlite').Database} db
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
function withTransaction(db, fn) {
  if (contexte.getStore()) {
    return runNested(db, fn);
  }

  const run = () => contexte.run({ active: true }, () => runRoot(db, fn));
  const result = queue.then(run, run);
  queue = result.then(() => undefined, () => undefined);
  return result;
}

module.exports = { withTransaction };
