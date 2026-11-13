/**
 * PDF des documents : facture, devis, note de crédit, compte rendu.
 *
 * Le serveur imprime le document avec le moteur de Chromium, en vrai texte et
 * au format lettre (voir pdfService.js). Il ne reçoit que ce que l'écran
 * affiche déjà : l'aperçu et le PDF ne peuvent pas diverger.
 */

import { api } from './api';

/**
 * Fabrique le PDF d'un élément de la page.
 *
 * @param {HTMLElement} element le document, tel qu'affiché
 * @param {{titre?: string, langue?: string}} [options] la langue du document,
 *   qui est celle du client pour une facture
 * @returns {Promise<string>} le PDF en data-URI
 */
export async function fabriquerPdf(element, { titre = '', langue = 'fr' } = {}) {
  const { pdf } = await api.post('/api/pdf', { html: element.outerHTML, titre, langue });
  return pdf;
}

/** Propose d'enregistrer un PDF reçu en data-URI. */
export function enregistrerPdf(dataUri, nom) {
  const base64 = dataUri.slice(dataUri.indexOf(',') + 1);
  const octets = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([octets], { type: 'application/pdf' }));
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = nom;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  // Le téléchargement a pris l'adresse : on peut la rendre.
  setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
}
