import React, { useEffect, useState, useRef } from 'react';
import html2pdf from 'html2pdf.js';
import EmailModal from './EmailModal';

function InvoicePrintTemplate({ factureId, onClose, mode = 'facture', isRelance = false }) {
  const [details, setDetails] = useState(null);
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(isRelance);
  const printRef = useRef(null);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'auto';
    };
  }, []);

  useEffect(() => {
    const fetchDetails = async () => {
      try {
        const [detailsRes, settingsRes] = await Promise.all([
          fetch(mode === 'devis' ? `/api/devis/${factureId}/details` : `/api/factures/${factureId}/details`),
          fetch('/api/settings')
        ]);
        if (!detailsRes.ok) throw new Error('Erreur de chargement');
        const data = await detailsRes.json();
        const settingsData = await settingsRes.json();
        setDetails(data);
        setSettings(settingsData);
      } catch (err) {
        setError('Impossible de charger les détails de la facture.');
      } finally {
        setLoading(false);
      }
    };
    fetchDetails();
  }, [factureId]);

  if (loading) return <div className="modal-overlay"><div className="modal-content glass-panel"><p>Chargement du modèle...</p></div></div>;
  if (error) return <div className="modal-overlay"><div className="modal-content glass-panel"><p style={{color: 'red'}}>{error}</p><button className="btn-secondary" onClick={onClose}>Fermer</button></div></div>;
  if (!details) return null;

  const isEn = details.client_details.langue === 'en';
  
  const currencySymbol = details.devise === 'USD' ? 'US$' : '$';
  
  const dict = {
    invoice: isEn ? 'INVOICE' : 'FACTURE',
    quote: isEn ? 'QUOTE' : 'SOUMISSION',
    dateEmission: isEn ? 'Issue Date' : "Date d'émission",
    dateValidite: isEn ? 'Valid Until' : "Valide jusqu'au",
    dateEcheance: isEn ? 'Due Date' : "Échéance",
    billedTo: isEn ? 'BILLED TO :' : 'Facturé à :',
    service: isEn ? 'Service' : 'Service',
    qty: isEn ? 'Qty / Hours' : 'Qté / Heures',
    price: isEn ? 'Price / Rate' : 'Prix / Tarif',
    amount: isEn ? 'Amount' : 'Montant',
    subtotal: isEn ? 'Subtotal' : 'Sous-total',
    totalQuote: isEn ? 'Quote Total' : 'Total de la soumission',
    totalInvoice: isEn ? 'Invoice Total' : 'Total de la facture',
    alreadyPaid: isEn ? 'Already Paid' : 'Déjà payé',
    balanceDue: isEn ? 'Balance Due' : 'Solde dû',
    thanks: isEn ? 'Thank you for your business.' : 'Merci de faire confiance à Safehill Technologies.',
    payBefore: isEn ? 'Please pay the balance due by: ' : 'Veuillez régler le solde dû avant la date d\'échéance : ',
    quoteValid: isEn ? 'This quote is valid until ' : 'Cette soumission est valide jusqu\'au ',
    emailSubjFact: isEn ? 'Invoice' : 'Facture',
    emailSubjQuote: isEn ? 'Quote' : 'Soumission',
    emailHello: isEn ? 'Hello' : 'Bonjour',
    emailBodyFact: isEn ? 'Please find attached your invoice in PDF format.\n\nThank you,\nSafehill Technologies Team' : "Veuillez trouver ci-joint votre facture en format PDF.\n\nMerci de votre confiance,\nL'équipe Safehill Technologies",
    emailBodyQuote: isEn ? 'Please find attached your quote in PDF format.\n\nThank you,\nSafehill Technologies Team' : "Veuillez trouver ci-joint votre soumission en format PDF.\n\nMerci de votre confiance,\nL'équipe Safehill Technologies",
    emailSubjRelance: isEn ? 'Payment Reminder - Invoice' : 'Rappel de paiement - Facture',
    emailBodyRelance: isEn ? 'This is a friendly reminder that your invoice is due.\nPlease find it attached in PDF format.\n\nThank you,\nSafehill Technologies Team' : "Ceci est un rappel amical concernant votre facture qui est arrivée à échéance.\nVeuillez la trouver ci-jointe en format PDF.\n\nMerci de votre confiance,\nL'équipe Safehill Technologies",
  };

  const handlePrint = () => {
    window.print();
  };

  const handleSendEmail = async (emailData) => {
    if (!printRef.current) throw new Error("Document non prêt");

    const element = printRef.current;
    const docType = mode === 'devis' ? 'Soumission' : 'Facture';
    const docNumber = mode === 'devis' ? details.numero_devis : details.numero_facture;
    const filename = `${docType}_${docNumber}.pdf`;

    // Options for html2pdf
    const opt = {
      margin:       10,
      filename:     filename,
      image:        { type: 'jpeg', quality: 0.98 },
      html2canvas:  { scale: 2 },
      jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    // Generate base64 PDF
    const pdfBase64 = await html2pdf().from(element).set(opt).outputPdf('datauristring');

    // Send to backend
    const response = await fetch('/api/emails/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: emailData.to,
        cc: emailData.cc,
        subject: emailData.subject,
        text: emailData.message,
        attachmentBase64: pdfBase64,
        filename: filename
      })
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error || 'Erreur lors de l\'envoi');
    }

    alert('Courriel envoyé avec succès !');
    setIsEmailModalOpen(false);
    if (isRelance) {
      await fetch(`/api/factures/${factureId}/relance/marquer`, { method: 'POST' });
      onClose();
    }
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 9999, padding: '20px', overflowY: 'auto', display: 'block' }}>
      
      {/* Boutons d'action (Non imprimés) */}
      <div className="no-print" style={{ display: 'flex', justifyContent: 'center', gap: '15px', marginBottom: '20px', position: 'sticky', top: '10px', zIndex: 10000 }}>
        <button className="btn-secondary" onClick={onClose} style={{ background: 'white' }}>Fermer</button>
        <button className="btn-secondary" onClick={() => setIsEmailModalOpen(true)} style={{ background: 'white', color: '#0e4a9e', borderColor: '#0e4a9e' }}>✉️ Envoyer par courriel</button>
        <button className="btn-primary" onClick={handlePrint}>🖨️ Imprimer / Sauvegarder PDF</button>
      </div>

      {/* Le document imprimable */}
      <div ref={printRef} className="print-only" style={{ 
        background: 'white', 
        color: 'black', 
        maxWidth: '800px', 
        margin: '0 auto', 
        padding: '40px', 
        boxShadow: '0 0 20px rgba(0,0,0,0.1)',
        borderRadius: '8px'
      }}>
        
        {/* En-tête de la facture */}
        <div style={{ marginBottom: '30px' }}>
          {/* Bannière de l'entreprise */}
          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            {settings.entreprise_logo ? (
              <img src={settings.entreprise_logo} alt={settings.entreprise_nom || 'Entreprise'} style={{ maxWidth: '100%', height: 'auto', maxHeight: '120px' }} />
            ) : (
              <img src="/banner.png" alt="Bannière" style={{ maxWidth: '100%', height: 'auto', maxHeight: '120px' }} />
            )}
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #f1f5f9', paddingBottom: '20px' }}>
            <div>
              <p style={{ margin: '0 0 5px 0', fontSize: '1.1rem', color: '#0e4a9e', fontWeight: 'bold', fontFamily: 'Outfit, sans-serif' }}>{settings.entreprise_nom || 'Votre Entreprise'}</p>
              {settings.entreprise_email && <p style={{ margin: '0 0 5px 0', fontSize: '0.95rem', color: '#475569' }}>Courriel : {settings.entreprise_email}</p>}
              {settings.entreprise_adresse && <p style={{ margin: '0 0 5px 0', fontSize: '0.95rem', color: '#475569', whiteSpace: 'pre-line' }}>{settings.entreprise_adresse}</p>}
            </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ margin: '0 0 10px 0', fontSize: '2rem', color: '#0f172a' }}>{mode === 'devis' ? dict.quote : dict.invoice}</h2>
            <p style={{ margin: '0 0 5px 0', fontWeight: 'bold' }}>N° {mode === 'devis' ? details.numero_devis : details.numero_facture}</p>
            <p style={{ margin: '0 0 5px 0', fontSize: '0.9rem', color: '#475569' }}>{dict.dateEmission} : {details.date_emission}</p>
            <p style={{ margin: '0', fontSize: '0.9rem', color: '#475569' }}>{mode === 'devis' ? dict.dateValidite : dict.dateEcheance} : {mode === 'devis' ? details.date_validite : details.date_echeance}</p>
          </div>
        </div>
        </div>

        {/* Bloc Facturé à */}
        <div style={{ marginBottom: '40px' }}>
          <p style={{ margin: '0 0 8px 0', textTransform: 'uppercase', fontSize: '0.85rem', color: '#94a3b8', fontWeight: 'bold' }}>{dict.billedTo}</p>
          <h3 style={{ margin: '0 0 5px 0', fontSize: '1.2rem', color: '#0f172a' }}>{details.client_details.nom_entreprise}</h3>
          {details.client_details.nom_contact && <p style={{ margin: '0 0 5px 0', color: '#475569' }}>Attn: {details.client_details.nom_contact}</p>}
          {details.client_details.email && <p style={{ margin: '0 0 5px 0', color: '#475569' }}>{details.client_details.email}</p>}
          {details.client_details.adresse && <p style={{ margin: '0', color: '#475569', whiteSpace: 'pre-line' }}>{details.client_details.adresse}</p>}
        </div>

        {/* Tableau des services */}
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
            {details.lignes.map((ligne, idx) => (
              <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '15px 12px', color: '#0f172a' }}>{ligne.description}</td>
                <td style={{ padding: '15px 12px', textAlign: 'center', color: '#475569' }}>{ligne.quantite}</td>
                <td style={{ padding: '15px 12px', textAlign: 'right', color: '#475569' }}>{ligne.prix_unitaire.toFixed(2)} {currencySymbol}</td>
                <td style={{ padding: '15px 12px', textAlign: 'right', fontWeight: '500', color: '#0f172a' }}>
                  {(ligne.quantite * ligne.prix_unitaire).toFixed(2)} {currencySymbol}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totaux */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
          <div style={{ width: '300px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', color: '#475569' }}>
              <span>{dict.subtotal}</span>
              <span>{(details.sous_total || 0).toFixed(2)} {currencySymbol}</span>
            </div>
            {details.taux_taxe_1 > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', color: '#475569' }}>
                <span>{details.taxe_1_nom || details.settings?.taxe_1_nom || 'Taxe 1'} ({(details.taux_taxe_1 * 100).toFixed(3)}%)</span>
                <span>{((details.sous_total || 0) * details.taux_taxe_1).toFixed(2)} {currencySymbol}</span>
              </div>
            )}
            {details.taux_taxe_2 > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', color: '#475569' }}>
                <span>{details.taxe_2_nom || details.settings?.taxe_2_nom || 'Taxe 2'} ({(details.taux_taxe_2 * 100).toFixed(3)}%)</span>
                <span>{((details.sous_total || 0) * details.taux_taxe_2).toFixed(2)} {currencySymbol}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', color: '#0f172a', fontWeight: 'bold' }}>
              <span>{mode === 'devis' ? dict.totalQuote : dict.totalInvoice}</span>
              <span>{details.montant_total.toFixed(2)} {currencySymbol}</span>
            </div>
            {mode === 'facture' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', color: '#10b981' }}>
                  <span>{dict.alreadyPaid}</span>
                  <span>- {details.montant_paye.toFixed(2)} {currencySymbol}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderTop: '2px solid #e2e8f0', marginTop: '5px', fontWeight: 'bold', fontSize: '1.2rem', color: '#0f172a' }}>
                  <span>{dict.balanceDue}</span>
                  <span>{details.solde_restant.toFixed(2)} {currencySymbol}</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Informations de paiement */}
        {settings?.payment_instructions && (
          <div style={{ marginTop: '40px', padding: '20px', background: '#f8fafc', borderRadius: '8px', borderLeft: '4px solid #0e4a9e' }}>
            <p style={{ margin: 0, color: '#0f172a', whiteSpace: 'pre-line', fontSize: '0.95rem' }}>
              {settings.payment_instructions}
            </p>
          </div>
        )}

        {/* Pied de page */}
        <div style={{ marginTop: '60px', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem', borderTop: '1px solid #f1f5f9', paddingTop: '20px' }}>
          <p style={{ margin: '0 0 5px 0' }}>{dict.thanks}</p>
          {mode === 'facture' && <p style={{ margin: '0 0 5px 0' }}>{dict.payBefore}{details.date_echeance}.</p>}
          {mode === 'devis' && <p style={{ margin: '0 0 5px 0' }}>{dict.quoteValid}{details.date_validite}.</p>}
          {details.devise && details.devise !== 'CAD' && (
            <p style={{ margin: '5px 0', fontStyle: 'italic', fontSize: '0.8rem' }}>
              * Les montants sont exprimés en {details.devise} (Taux appliqué pour comptabilité CAD : 1 {details.devise} = {details.taux_change} CAD).
            </p>
          )}
          {details.settings && (details.settings.taxe_1_numero || details.settings.taxe_2_numero) && (
            <p style={{ margin: '10px 0 0 0', fontSize: '0.75rem' }}>
              {details.settings.taxe_1_nom} : {details.settings.taxe_1_numero} 
              {details.settings.taxe_1_numero && details.settings.taxe_2_numero ? ' | ' : ''}
              {details.settings.taxe_2_numero ? `${details.settings.taxe_2_nom} : ${details.settings.taxe_2_numero}` : ''}
            </p>
          )}
        </div>

      </div>

      <EmailModal 
        isOpen={isEmailModalOpen}
        onClose={() => setIsEmailModalOpen(false)}
        onSend={handleSendEmail}
        initialTo={details.client_details.email || ''}
        initialSubject={`${isRelance ? dict.emailSubjRelance : (mode === 'devis' ? dict.emailSubjQuote : dict.emailSubjFact)} N° ${mode === 'devis' ? details.numero_devis : details.numero_facture} - Safehill Technologies`}
        defaultMessage={`${dict.emailHello} ${details.client_details.nom_contact || details.client_details.nom_entreprise},\n\n${isRelance ? dict.emailBodyRelance : (mode === 'devis' ? dict.emailBodyQuote : dict.emailBodyFact)}`}
      />
    </div>
  );
}

export default InvoicePrintTemplate;
