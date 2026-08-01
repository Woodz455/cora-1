import { useEffect, useState, useRef } from 'react';
import EmailModal from './EmailModal';
import { api, formatMontant } from '../api';
import { useModale } from '../useModale';

/**
 * Libellés du document, en français et en anglais.
 *
 * Le nom de l'entreprise ne figure plus dans ces textes : il était écrit en dur
 * (« Merci de faire confiance à Safehill Technologies »), ce qui rendait le
 * logiciel inutilisable par une autre entreprise. Il provient désormais des
 * paramètres.
 */
function construireDictionnaire(isEn, nomEntreprise) {
  const societe = nomEntreprise || '';
  const signature = societe ? `\n\n${isEn ? 'Thank you,' : 'Merci de votre confiance,'}\n${societe}` : '';

  return {
    invoice: isEn ? 'INVOICE' : 'FACTURE',
    quote: isEn ? 'QUOTE' : 'SOUMISSION',
    note: isEn ? 'CREDIT NOTE' : 'NOTE DE CRÉDIT',
    dateEmission: isEn ? 'Issue Date' : "Date d'émission",
    dateValidite: isEn ? 'Valid Until' : "Valide jusqu'au",
    dateEcheance: isEn ? 'Due Date' : 'Échéance',
    creditedTo: isEn ? 'CREDITED TO' : 'CRÉDITÉ À',
    noteRef: isEn ? 'Relates to invoice' : 'Se rapporte à la facture',
    noteDu: isEn ? 'dated' : 'du',
    noteMotif: isEn ? 'Reason' : 'Motif',
    totalNote: isEn ? 'Total Credited' : 'Total crédité',
    noteFooter: isEn
      ? 'This amount is deducted from the balance of invoice'
      : 'Ce montant vient en déduction du solde de la facture',
    emailSubjNote: isEn ? 'Credit Note' : 'Note de crédit',
    emailBodyNote: (isEn
      ? 'Please find attached your credit note in PDF format.'
      : 'Veuillez trouver ci-joint votre note de crédit au format PDF.') + signature,
    billedTo: isEn ? 'BILLED TO' : 'FACTURÉ À',
    attn: isEn ? 'Attn:' : 'À l\'attention de :',
    service: isEn ? 'Service' : 'Service',
    qty: isEn ? 'Qty / Hours' : 'Qté / heures',
    price: isEn ? 'Price / Rate' : 'Prix / tarif',
    amount: isEn ? 'Amount' : 'Montant',
    subtotal: isEn ? 'Subtotal' : 'Sous-total',
    totalQuote: isEn ? 'Quote Total' : 'Total de la soumission',
    totalInvoice: isEn ? 'Invoice Total' : 'Total de la facture',
    alreadyPaid: isEn ? 'Already Paid' : 'Déjà payé',
    balanceDue: isEn ? 'Balance Due' : 'Solde dû',
    creditNote: isEn ? 'Credit note' : 'Note de crédit',
    refundDue: isEn ? 'Refund Due' : 'À vous rembourser',
    thanks: societe
      ? (isEn ? `Thank you for your business — ${societe}.` : `Merci de votre confiance — ${societe}.`)
      : (isEn ? 'Thank you for your business.' : 'Merci de votre confiance.'),
    payBefore: isEn ? 'Please pay the balance due by: ' : "Veuillez régler le solde dû avant l'échéance : ",
    quoteValid: isEn ? 'This quote is valid until ' : 'Cette soumission est valide jusqu\'au ',
    emailSubjFact: isEn ? 'Invoice' : 'Facture',
    emailSubjQuote: isEn ? 'Quote' : 'Soumission',
    emailSubjRelance: isEn ? 'Payment Reminder - Invoice' : 'Rappel de paiement - Facture',
    emailHello: isEn ? 'Hello' : 'Bonjour',
    emailBodyFact: (isEn
      ? 'Please find attached your invoice in PDF format.'
      : 'Veuillez trouver ci-joint votre facture au format PDF.') + signature,
    emailBodyQuote: (isEn
      ? 'Please find attached your quote in PDF format.'
      : 'Veuillez trouver ci-joint votre soumission au format PDF.') + signature,
    emailBodyRelance: (isEn
      ? 'This is a friendly reminder that your invoice is due.\nPlease find it attached in PDF format.'
      : 'Ceci est un rappel amical concernant votre facture arrivée à échéance.\nVous la trouverez ci-jointe au format PDF.') + signature
  };
}

/**
 * Aperçu imprimable d'une facture, d'une soumission ou d'une note de crédit.
 *
 * @param {number} factureId identifiant du document — celui de la note en mode `note`
 * @param {'facture'|'devis'|'note'} [mode]
 */
function InvoicePrintTemplate({ factureId, onClose, mode = 'facture', isRelance = false }) {
  const estDevis = mode === 'devis';
  // La note de crédit est une pièce comptable à part entière, que le client
  // doit recevoir avec son numéro et sa date. Elle n'existait jusqu'ici que
  // sous forme de lignes en déduction dans le PDF de la facture.
  const estNote = mode === 'note';

  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(isRelance);
  const [message, setMessage] = useState(null);
  const printRef = useRef(null);
  const modaleRef = useModale(() => onClose(false), { actif: !loading });

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = 'auto'; };
  }, []);

  useEffect(() => {
    let annule = false;

    const charger = async () => {
      try {
        // Les paramètres d'entreprise accompagnent déjà les détails du document :
        // l'appel séparé à /api/settings était réservé aux administrateurs et
        // échouait pour tout autre rôle, produisant des PDF sans en-tête.
        const chemin = estNote ? `/api/notes-credit/${factureId}/details`
          : estDevis ? `/api/devis/${factureId}/details`
            : `/api/factures/${factureId}/details`;
        const data = await api.get(chemin);
        if (!annule) setDetails(data);
      } catch (err) {
        if (!annule) setError(err.message);
      } finally {
        if (!annule) setLoading(false);
      }
    };

    charger();
    return () => { annule = true; };
  }, [factureId, mode, estDevis, estNote]);

  if (loading) {
    return (
      <div ref={modaleRef} className="modal-overlay">
        <div className="modal-content glass-panel"><p>Chargement du document…</p></div>
      </div>
    );
  }

  if (error || !details) {
    return (
      <div ref={modaleRef} className="modal-overlay" role="dialog" aria-modal="true" aria-label="Document introuvable">
        <div className="modal-content glass-panel">
          <p className="alert alert-error" role="alert">{error || 'Document introuvable.'}</p>
          <button type="button" className="btn-secondary" onClick={() => onClose(false)}>Fermer</button>
        </div>
      </div>
    );
  }

  const settings = details.settings || {};
  const client = details.client_details || {};
  const isEn = client.langue === 'en';
  const dict = construireDictionnaire(isEn, settings.entreprise_nom);
  const numero = estNote ? details.numero_note
    : estDevis ? details.numero_devis
      : details.numero_facture;

  // Le document part chez le client : les montants suivent sa langue, comme le
  // reste de la mise en page.
  const montant = (valeur) => formatMontant(valeur, details.devise, isEn ? 'en' : 'fr');
  const pourcentage = (taux) => `${(taux * 100).toFixed(3).replace(/\.?0+$/, '')} %`;

  const handleSendEmail = async (emailData) => {
    if (!printRef.current) throw new Error('Le document n\'est pas prêt.');

    const typeDoc = estNote ? 'Note_de_credit' : estDevis ? 'Soumission' : 'Facture';
    const filename = `${typeDoc}_${numero}.pdf`;

    // html2pdf embarque jsPDF et html2canvas, à eux seuls la moitié du paquet
    // JavaScript. Ils ne sont chargés qu'au moment d'un envoi par courriel,
    // et non au démarrage de l'application.
    const { default: html2pdf } = await import('html2pdf.js');

    const pdfBase64 = await html2pdf()
      .from(printRef.current)
      .set({
        margin: 10,
        filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      })
      .outputPdf('datauristring');

    await api.post('/api/emails/send', {
      to: emailData.to,
      cc: emailData.cc,
      subject: emailData.subject,
      text: emailData.message,
      attachmentBase64: pdfBase64,
      filename
    });

    if (isRelance) {
      await api.post(`/api/factures/${factureId}/relance/marquer`);
      // On signale au parent que le compteur de relances doit être rafraîchi.
      onClose(true);
      return;
    }

    setIsEmailModalOpen(false);
    setMessage('Courriel envoyé avec succès.');
  };

  const objetCourriel = isRelance ? dict.emailSubjRelance
    : estNote ? dict.emailSubjNote
      : estDevis ? dict.emailSubjQuote
        : dict.emailSubjFact;
  const sujet = `${objetCourriel} n° ${numero}`
    + (settings.entreprise_nom ? ` — ${settings.entreprise_nom}` : '');

  const texteCourriel = isRelance ? dict.emailBodyRelance
    : estNote ? dict.emailBodyNote
      : estDevis ? dict.emailBodyQuote
        : dict.emailBodyFact;
  const corps = `${dict.emailHello} ${client.nom_contact || client.nom_entreprise},\n\n${texteCourriel}`;

  return (
    <div ref={modaleRef} className="modal-overlay" role="dialog" aria-modal="true" aria-label={`Aperçu ${numero}`}
      style={{ zIndex: 9999, padding: '20px', overflowY: 'auto', display: 'block' }}>
      <div className="no-print" style={{ display: 'flex', justifyContent: 'center', gap: '15px', marginBottom: '20px', position: 'sticky', top: '10px', zIndex: 10000, flexWrap: 'wrap' }}>
        <button type="button" className="btn-secondary" onClick={() => onClose(false)} style={{ background: 'white' }}>Fermer</button>
        <button type="button" className="btn-secondary" onClick={() => setIsEmailModalOpen(true)} style={{ background: 'white', color: '#0e4a9e', borderColor: '#0e4a9e' }}>
          ✉️ Envoyer par courriel
        </button>
        <button type="button" className="btn-primary" onClick={() => window.print()}>🖨️ Imprimer / sauvegarder en PDF</button>
      </div>

      {message && (
        <div className="no-print" style={{ maxWidth: '800px', margin: '0 auto 20px' }}>
          <p className="alert alert-success" role="status">{message}</p>
        </div>
      )}

      <div
        ref={printRef}
        className="print-only"
        style={{ background: 'white', color: 'black', maxWidth: '800px', margin: '0 auto', padding: '40px', boxShadow: '0 0 20px rgba(0,0,0,0.1)', borderRadius: '8px' }}
      >
        <div style={{ marginBottom: '30px' }}>
          {settings.entreprise_logo && (
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <img
                src={settings.entreprise_logo}
                alt={settings.entreprise_nom || ''}
                style={{ maxWidth: '100%', height: 'auto', maxHeight: '120px' }}
              />
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #f1f5f9', paddingBottom: '20px', gap: '20px' }}>
            <div>
              <p style={{ margin: '0 0 5px 0', fontSize: '1.1rem', color: '#0e4a9e', fontWeight: 'bold' }}>
                {settings.entreprise_nom || 'Votre entreprise'}
              </p>
              {settings.entreprise_email && (
                <p style={{ margin: '0 0 5px 0', fontSize: '0.95rem', color: '#475569' }}>
                  {isEn ? 'Email' : 'Courriel'} : {settings.entreprise_email}
                </p>
              )}
              {settings.entreprise_adresse && (
                <p style={{ margin: '0 0 5px 0', fontSize: '0.95rem', color: '#475569', whiteSpace: 'pre-line' }}>
                  {settings.entreprise_adresse}
                </p>
              )}
            </div>
            <div style={{ textAlign: 'right' }}>
              <h2 style={{ margin: '0 0 10px 0', fontSize: '2rem', color: estNote ? '#b45309' : '#0f172a' }}>
                {estNote ? dict.note : estDevis ? dict.quote : dict.invoice}
              </h2>
              <p style={{ margin: '0 0 5px 0', fontWeight: 'bold' }}>N° {numero}</p>
              <p style={{ margin: '0 0 5px 0', fontSize: '0.9rem', color: '#475569' }}>
                {dict.dateEmission} : {details.date_emission}
              </p>
              {/* Une note de crédit ne s'échoit pas : elle renvoie à la facture
                  qu'elle corrige, seul repère utile pour le client. */}
              {estNote ? (
                <p style={{ margin: 0, fontSize: '0.9rem', color: '#475569' }}>
                  {dict.noteRef} n° {details.numero_facture} {dict.noteDu} {details.facture_date_emission}
                </p>
              ) : (
                <p style={{ margin: 0, fontSize: '0.9rem', color: '#475569' }}>
                  {estDevis ? dict.dateValidite : dict.dateEcheance} : {estDevis ? details.date_validite : details.date_echeance}
                </p>
              )}
            </div>
          </div>
        </div>

        <div style={{ marginBottom: '40px' }}>
          <p style={{ margin: '0 0 8px 0', textTransform: 'uppercase', fontSize: '0.85rem', color: '#94a3b8', fontWeight: 'bold' }}>
            {estNote ? dict.creditedTo : dict.billedTo}
          </p>
          <h3 style={{ margin: '0 0 5px 0', fontSize: '1.2rem', color: '#0f172a' }}>{client.nom_entreprise}</h3>
          {client.nom_contact && <p style={{ margin: '0 0 5px 0', color: '#475569' }}>{dict.attn} {client.nom_contact}</p>}
          {client.email && <p style={{ margin: '0 0 5px 0', color: '#475569' }}>{client.email}</p>}
          {client.adresse && <p style={{ margin: 0, color: '#475569', whiteSpace: 'pre-line' }}>{client.adresse}</p>}
        </div>

        {estNote && details.motif && (
          <div style={{ marginBottom: '30px', padding: '15px 20px', background: '#fffbeb', borderRadius: '8px', borderLeft: '4px solid #b45309' }}>
            <p style={{ margin: 0, color: '#0f172a', whiteSpace: 'pre-line', fontSize: '0.95rem' }}>
              <strong>{dict.noteMotif} : </strong>{details.motif}
            </p>
          </div>
        )}

        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '30px' }}>
          <thead>
            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
              <th style={{ padding: '12px', textAlign: 'left', color: '#475569', fontWeight: '600' }}>{dict.service}</th>
              <th style={{ padding: '12px', textAlign: 'center', color: '#475569', fontWeight: '600' }}>{dict.qty}</th>
              <th style={{ padding: '12px', textAlign: 'right', color: '#475569', fontWeight: '600' }}>{dict.price}</th>
              <th style={{ padding: '12px', textAlign: 'right', color: '#475569', fontWeight: '600' }}>{dict.amount}</th>
            </tr>
          </thead>
          <tbody>
            {details.lignes.map((ligne) => (
              <tr key={ligne.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '15px 12px', color: '#0f172a' }}>{ligne.description}</td>
                <td style={{ padding: '15px 12px', textAlign: 'center', color: '#475569' }}>{ligne.quantite}</td>
                <td style={{ padding: '15px 12px', textAlign: 'right', color: '#475569' }}>{montant(ligne.prix_unitaire)}</td>
                <td style={{ padding: '15px 12px', textAlign: 'right', fontWeight: '500', color: '#0f172a' }}>
                  {montant(ligne.quantite * ligne.prix_unitaire)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Les montants de taxes viennent du serveur, arrondis exactement comme
            le total : sous-total + taxes égale toujours le total imprimé. */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
          <div style={{ width: '320px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', color: '#475569' }}>
              <span>{dict.subtotal}</span>
              <span>{montant(details.sous_total)}</span>
            </div>
            {details.taux_taxe_1 > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', color: '#475569' }}>
                <span>{details.taxe_1_nom || 'Taxe 1'} ({pourcentage(details.taux_taxe_1)})</span>
                <span>{montant(details.montant_taxe_1)}</span>
              </div>
            )}
            {details.taux_taxe_2 > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', color: '#475569' }}>
                <span>{details.taxe_2_nom || 'Taxe 2'} ({pourcentage(details.taux_taxe_2)})</span>
                <span>{montant(details.montant_taxe_2)}</span>
              </div>
            )}
            <div style={{
              display: 'flex', justifyContent: 'space-between', padding: '8px 0',
              color: estNote ? '#b45309' : '#0f172a', fontWeight: 'bold',
              borderTop: '1px solid #e2e8f0',
              ...(estNote ? { fontSize: '1.2rem', paddingTop: '12px' } : {})
            }}>
              <span>{estNote ? dict.totalNote : estDevis ? dict.totalQuote : dict.totalInvoice}</span>
              <span>{estNote ? '- ' : ''}{montant(details.montant_total)}</span>
            </div>
            {!estDevis && !estNote && (
              <>
                {/* Les notes de crédit apparaissent sur la facture : le client
                    doit pouvoir rapprocher le solde demandé de ce qu'il a reçu. */}
                {(details.notes_credit || []).map((note) => (
                  <div key={note.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', color: '#ea580c' }}>
                    <span>{dict.creditNote} {note.numero_note}</span>
                    <span>- {montant(note.montant_total)}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', color: '#10b981' }}>
                  <span>{dict.alreadyPaid}</span>
                  <span>- {montant(details.montant_paye)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderTop: '2px solid #e2e8f0', marginTop: '5px', fontWeight: 'bold', fontSize: '1.2rem', color: '#0f172a' }}>
                  <span>{details.montant_a_rembourser > 0 ? dict.refundDue : dict.balanceDue}</span>
                  <span>
                    {montant(details.montant_a_rembourser > 0 ? details.montant_a_rembourser : details.solde_restant)}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Les instructions de paiement n'ont pas de sens sur une note de
            crédit : c'est l'entreprise qui doit, pas le client. */}
        {settings.payment_instructions && !estNote && (
          <div style={{ marginTop: '40px', padding: '20px', background: '#f8fafc', borderRadius: '8px', borderLeft: '4px solid #0e4a9e' }}>
            <p style={{ margin: 0, color: '#0f172a', whiteSpace: 'pre-line', fontSize: '0.95rem' }}>
              {settings.payment_instructions}
            </p>
          </div>
        )}

        <div style={{ marginTop: '60px', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem', borderTop: '1px solid #f1f5f9', paddingTop: '20px' }}>
          <p style={{ margin: '0 0 5px 0' }}>{dict.thanks}</p>
          {estNote && <p style={{ margin: '0 0 5px 0' }}>{dict.noteFooter} n° {details.numero_facture}.</p>}
          {!estDevis && !estNote && <p style={{ margin: '0 0 5px 0' }}>{dict.payBefore}{details.date_echeance}.</p>}
          {estDevis && <p style={{ margin: '0 0 5px 0' }}>{dict.quoteValid}{details.date_validite}.</p>}
          {details.devise && details.devise !== 'CAD' && (
            <p style={{ margin: '5px 0', fontStyle: 'italic', fontSize: '0.8rem' }}>
              {isEn
                ? `* Amounts are in ${details.devise} (accounting rate: 1 ${details.devise} = ${details.taux_change} CAD).`
                : `* Les montants sont exprimés en ${details.devise} (taux comptable appliqué : 1 ${details.devise} = ${details.taux_change} CAD).`}
            </p>
          )}
          {(settings.taxe_1_numero || settings.taxe_2_numero) && (
            <p style={{ margin: '10px 0 0 0', fontSize: '0.75rem' }}>
              {[
                settings.taxe_1_numero && `${settings.taxe_1_nom} : ${settings.taxe_1_numero}`,
                settings.taxe_2_numero && `${settings.taxe_2_nom} : ${settings.taxe_2_numero}`
              ].filter(Boolean).join(' | ')}
            </p>
          )}
        </div>
      </div>

      <EmailModal
        isOpen={isEmailModalOpen}
        onClose={() => setIsEmailModalOpen(false)}
        onSend={handleSendEmail}
        initialTo={client.email || ''}
        initialSubject={sujet}
        defaultMessage={corps}
      />
    </div>
  );
}

export default InvoicePrintTemplate;
