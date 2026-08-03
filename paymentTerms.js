/**
 * Conditions de paiement.
 *
 * L'échéance d'une facture était un champ date libre, pré-rempli à trente jours
 * sans que rien ne dise pourquoi. Un terme convenu avec le client — payable sur
 * réception, Net 30, Net 60 — se saisit une fois sur sa fiche et s'applique
 * ensuite de lui-même.
 */

/** Termes reconnus, du plus court au plus long. */
const CONDITIONS = [
  { valeur: 'reception', libelle: 'Payable sur réception', jours: 0 },
  { valeur: 'net15', libelle: 'Net 15 jours', jours: 15 },
  { valeur: 'net30', libelle: 'Net 30 jours', jours: 30 },
  { valeur: 'net60', libelle: 'Net 60 jours', jours: 60 }
];

/** Terme appliqué à un client dont la fiche n'en porte pas. */
const CONDITION_DEFAUT = 'net30';

const PAR_VALEUR = new Map(CONDITIONS.map((c) => [c.valeur, c]));

/** Normalise un terme, avec repli sur le défaut plutôt qu'une erreur. */
function normaliserCondition(valeur) {
  return PAR_VALEUR.has(valeur) ? valeur : CONDITION_DEFAUT;
}

/** Nombre de jours accordés par un terme. */
function joursDeCondition(valeur) {
  const condition = PAR_VALEUR.get(normaliserCondition(valeur));
  return condition.jours;
}

/** Libellé lisible d'un terme. */
function libelleCondition(valeur) {
  return PAR_VALEUR.get(normaliserCondition(valeur)).libelle;
}

/**
 * Échéance découlant d'une date d'émission et d'un terme.
 *
 * Le calcul passe par les composantes UTC : `setDate` sur une date construite
 * en heure locale ferait basculer d'un jour selon le fuseau, et une échéance
 * décalée fausserait aussi bien les relances que la balance âgée.
 *
 * @param {string} dateEmission AAAA-MM-JJ
 * @param {string} condition
 * @returns {string} AAAA-MM-JJ
 */
function calculerEcheance(dateEmission, condition) {
  const base = new Date(`${dateEmission}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return dateEmission;

  base.setUTCDate(base.getUTCDate() + joursDeCondition(condition));
  return base.toISOString().split('T')[0];
}

module.exports = {
  CONDITIONS,
  CONDITION_DEFAUT,
  normaliserCondition,
  joursDeCondition,
  libelleCondition,
  calculerEcheance
};
