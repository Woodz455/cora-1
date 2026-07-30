/**
 * Numérotation des documents comptables.
 *
 * Les numéros dérivaient des enregistrements présents en base (`COUNT(*)` pour
 * les devis, dernier identifiant inséré pour les factures). Supprimer un
 * document libérait alors son numéro, qui repartait chez un autre client alors
 * qu'il avait déjà été émis — et se heurtait à la contrainte d'unicité.
 *
 * Un compteur persistant par préfixe règle le problème : il n'est jamais
 * décrémenté, quoi qu'il advienne des documents eux-mêmes.
 */

/**
 * Réserve le prochain numéro de séquence pour un préfixe donné.
 *
 * À appeler à l'intérieur d'une transaction : la lecture et l'incrémentation
 * doivent être atomiques.
 *
 * @param {import('sqlite').Database} db
 * @param {{prefix: string, table: string, column: string}} options
 *   `table` et `column` servent à initialiser le compteur depuis les numéros
 *   déjà émis, pour les bases antérieures à ce mécanisme. Ce sont des
 *   constantes internes, jamais des données utilisateur.
 * @returns {Promise<number>}
 */
async function nextSequence(db, { prefix, table, column }) {
  const compteur = await db.get('SELECT last_value FROM document_sequences WHERE prefix = ?', [prefix]);

  let base;
  if (compteur) {
    base = compteur.last_value;
  } else {
    const row = await db.get(
      `SELECT MAX(CAST(substr(${column}, ?) AS INTEGER)) AS max_seq
       FROM ${table} WHERE ${column} LIKE ?`,
      [prefix.length + 1, `${prefix}%`]
    );
    base = row && row.max_seq ? row.max_seq : 0;
  }

  const suivant = base + 1;
  await db.run(
    `INSERT INTO document_sequences (prefix, last_value) VALUES (?, ?)
     ON CONFLICT(prefix) DO UPDATE SET last_value = excluded.last_value`,
    [prefix, suivant]
  );

  return suivant;
}

/**
 * Construit un numéro de document au format PREFIXE-AAAAMM-NNNN.
 *
 * @param {import('sqlite').Database} db
 * @param {string} code  'SHT' pour une facture, 'DEV' pour un devis
 * @param {string} dateStr date d'émission au format AAAA-MM-JJ
 * @param {{table: string, column: string}} source
 * @returns {Promise<string>}
 */
async function nextDocumentNumber(db, code, dateStr, source) {
  const [year, month] = dateStr.split('-');
  const prefix = `${code}-${year}${month}-`;
  const sequence = await nextSequence(db, { prefix, ...source });
  return `${prefix}${String(sequence).padStart(4, '0')}`;
}

module.exports = { nextSequence, nextDocumentNumber };
