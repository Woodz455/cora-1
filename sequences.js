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
 * Préfixe des factures des dossiers antérieurs au réglage. Ce sont les
 * initiales de l'éditeur, restées écrites en dur jusqu'à la 1.10.0 : ces
 * dossiers le gardent, pour que leur numérotation ne change pas sous leurs
 * pieds.
 */
const PREFIXE_FACTURE_HERITE = 'SHT';

/** Préfixe des factures d'un dossier neuf, que l'administrateur peut changer. */
const PREFIXE_FACTURE_DEFAUT = 'FAC';

/**
 * Préfixes des devis et des notes de crédit. Les compteurs sont tenus par
 * préfixe : une facture qui en prendrait un partagerait sa numérotation avec
 * ces documents, et chaque série aurait des trous.
 */
const PREFIXES_RESERVES = ['DEV', 'NC'];

/**
 * Met un préfixe de facture en forme : majuscules, 2 à 6 lettres ou chiffres.
 *
 * @returns {string|null} le préfixe, ou null s'il n'est pas utilisable
 */
function normaliserPrefixe(valeur) {
  if (typeof valeur !== 'string') return null;
  const prefixe = valeur.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,6}$/.test(prefixe)) return null;
  if (PREFIXES_RESERVES.includes(prefixe)) return null;
  return prefixe;
}

/**
 * Construit un numéro de document au format PREFIXE-AAAAMM-NNNN.
 *
 * @param {import('sqlite').Database} db
 * @param {string} code  le préfixe du dossier pour une facture, 'DEV' pour un devis
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

module.exports = {
  nextSequence,
  nextDocumentNumber,
  normaliserPrefixe,
  PREFIXE_FACTURE_HERITE,
  PREFIXE_FACTURE_DEFAUT,
  PREFIXES_RESERVES
};
