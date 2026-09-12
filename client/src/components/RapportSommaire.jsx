import { useEffect, useState, useRef } from 'react';
import { api, formatMontant } from '../api';
import { useModale } from '../useModale';
import { libellePeriode, dateLongue, moisLong, suffixePeriode } from '../periodes';

/** Nombre de catégories de dépenses détaillées ; le reste est regroupé. */
const CATEGORIES_DETAILLEES = 8;

/** Part du facturé à partir de laquelle un client unique est signalé. */
const SEUIL_CONCENTRATION = 50;

/** Délai d'encaissement au-delà duquel le document le relève, en jours. */
const SEUIL_DELAI_JOURS = 30;

const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;

/** « 65,3 % » : virgule décimale, comme les montants. */
const pourcent = (v) => `${Number(v).toLocaleString('fr-CA', { maximumFractionDigits: 1 })} %`;

/** Part d'un montant dans un total, ou un tiret quand le total est nul. */
const part = (montant, total) => (total > 0 ? pourcent((montant / total) * 100) : '-');

/**
 * Ce qui mérite d'être lu en premier, déduit des chiffres eux-mêmes.
 *
 * Des constats, pas des conseils : le document dit ce qu'il voit et laisse le
 * lecteur, ou son comptable, en tirer la conclusion.
 */
function pointsDAttention(s) {
  const points = [];
  const m = (v) => formatMontant(v);

  if (s.facturation.nb_factures === 0) {
    points.push('Aucune facture n\'a été émise sur la période.');
  }
  if (s.resultat.benefice_net < 0) {
    points.push(`Les dépenses hors taxes de la période (${m(s.depenses.total_ht)}) dépassent `
      + `les encaissements (${m(s.encaissements.total_encaisse)}).`);
  }
  if (s.creances.en_retard > 0) {
    const anciennes = s.creances.balance.totaux.jours_91_plus;
    points.push(`${pluriel(s.creances.nb_factures_en_retard, 'facture')} en retard de paiement `
      + `pour ${m(s.creances.en_retard)}`
      + (anciennes > 0 ? `, dont ${m(anciennes)} depuis plus de 90 jours.` : '.'));
  }
  if (s.clients.part_premier_client !== null && s.clients.part_premier_client >= SEUIL_CONCENTRATION) {
    points.push(`Votre premier client, ${s.clients.principaux[0].client}, représente `
      + `${pourcent(s.clients.part_premier_client)} du facturé de la période.`);
  }
  if (s.encaissements.delai_moyen_jours !== null && s.encaissements.delai_moyen_jours > SEUIL_DELAI_JOURS) {
    points.push(`Vos clients ont payé en moyenne ${s.encaissements.delai_moyen_jours} jours `
      + 'après l\'émission de la facture.');
  }
  return points;
}

/** Regroupe les petites catégories de dépenses en une ligne « Autres ». */
function categoriesResumees(parCategorie) {
  if (parCategorie.length <= CATEGORIES_DETAILLEES) return parCategorie;
  const gardees = parCategorie.slice(0, CATEGORIES_DETAILLEES - 1);
  const reste = parCategorie.slice(CATEGORIES_DETAILLEES - 1);
  return [...gardees, {
    categorie: `Autres (${pluriel(reste.length, 'catégorie')})`,
    nombre: reste.reduce((t, c) => t + c.nombre, 0),
    montant_ht: Math.round(reste.reduce((t, c) => t + c.montant_ht, 0) * 100) / 100
  }];
}

/* --- Éléments de mise en page.
       Couleurs en dur, comme sur la facture : le document doit sortir identique
       sur papier blanc quel que soit le thème de l'application. --- */

const COULEURS = {
  encre: '#0f172a', gris: '#475569', clair: '#94a3b8', filet: '#e2e8f0',
  fond: '#f8fafc', bleu: '#0e4a9e', vert: '#10b981', rouge: '#dc2626',
  ambre: '#b45309', violet: '#7c3aed'
};

/** Un bloc du document, insécable à l'impression. */
function Section({ titre, sousTitre, children }) {
  return (
    <section style={{ marginTop: '32px', breakInside: 'avoid', pageBreakInside: 'avoid' }}>
      <h3 style={{ margin: '0 0 4px 0', fontSize: '1.05rem', color: COULEURS.encre, borderBottom: `2px solid ${COULEURS.filet}`, paddingBottom: '6px' }}>
        {titre}
      </h3>
      {sousTitre && <p style={{ margin: '0 0 12px 0', fontSize: '0.8rem', color: COULEURS.clair }}>{sousTitre}</p>}
      {!sousTitre && <div style={{ height: '12px' }} />}
      {children}
    </section>
  );
}

function Tuile({ titre, valeur, detail, couleur }) {
  return (
    <div style={{ minWidth: 0, padding: '14px 16px', background: COULEURS.fond, borderRadius: '8px', borderTop: `4px solid ${couleur}` }}>
      <p style={{ margin: '0 0 6px 0', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.03em', color: COULEURS.gris, fontWeight: 600 }}>
        {titre}
      </p>
      <p style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: COULEURS.encre }}>{valeur}</p>
      {detail && <p style={{ margin: '4px 0 0 0', fontSize: '0.78rem', color: COULEURS.gris }}>{detail}</p>}
    </div>
  );
}

/** Grille de tuiles à colonnes égales : la même mise en page quel que soit le montant. */
const grille = (colonnes) => ({ display: 'grid', gridTemplateColumns: `repeat(${colonnes}, minmax(0, 1fr))`, gap: '12px' });

const th = (align = 'left', extra = {}) => ({
  padding: '8px 10px', textAlign: align, fontSize: '0.8rem', color: COULEURS.gris,
  fontWeight: 600, background: COULEURS.fond, borderBottom: `2px solid ${COULEURS.filet}`, ...extra
});
const td = (align = 'left', extra = {}) => ({
  padding: '8px 10px', textAlign: align, fontSize: '0.9rem', color: COULEURS.encre,
  borderBottom: `1px solid ${COULEURS.filet}`, ...extra
});
const tdTotal = (align = 'left', extra = {}) => td(align, {
  fontWeight: 700, borderTop: `2px solid ${COULEURS.filet}`, borderBottom: 'none', ...extra
});

/** La balance âgée compte sept colonnes : elle se serre pour tenir en largeur. */
const SERRE = { padding: '8px 6px', fontSize: '0.84rem' };

/**
 * Barre proportionnelle en pur HTML : un graphique SVG survit mal à la
 * capture d'image qui produit le PDF, une simple boîte colorée toujours.
 */
function Barre({ valeur, max, couleur }) {
  const largeur = max > 0 ? Math.max(0, Math.min(100, (valeur / max) * 100)) : 0;
  return (
    <div style={{ height: '10px', background: COULEURS.filet, borderRadius: '5px', overflow: 'hidden', minWidth: '80px' }}>
      <div style={{ width: `${largeur}%`, height: '100%', background: couleur }} />
    </div>
  );
}

/**
 * Compte rendu de gestion d'une période, prêt à imprimer ou à enregistrer en PDF.
 *
 * Un sommaire de gestion, et non des états financiers : Clora ne tient ni
 * grand livre ni plan comptable, et le document le dit en pied de page.
 *
 * @param {{annee: string, mois?: string, trimestre?: string}} periode
 * @param {Function} onClose
 */
function RapportSommaire({ periode, onClose }) {
  const [sommaire, setSommaire] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const [erreurPdf, setErreurPdf] = useState(null);
  const printRef = useRef(null);
  // Le document arrive après le montage, dans un autre conteneur que celui de
  // l'attente : le raccourci clavier ne se pose que sur le conteneur définitif.
  const modaleRef = useModale(onClose, { actif: Boolean(sommaire || erreur) });

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = 'auto'; };
  }, []);

  useEffect(() => {
    let annule = false;
    const params = new URLSearchParams({ annee: periode.annee });
    if (periode.mois) params.set('mois', periode.mois);
    else if (periode.trimestre) params.set('trimestre', periode.trimestre);

    api.get(`/api/rapports/sommaire?${params.toString()}`)
      .then((data) => { if (!annule) setSommaire(data); })
      .catch((err) => { if (!annule) setErreur(err.message); });
    return () => { annule = true; };
  }, [periode.annee, periode.mois, periode.trimestre]);

  const telechargerPdf = async () => {
    if (!printRef.current || enCours) return;
    setEnCours(true);
    setErreurPdf(null);
    try {
      // Même chargement différé que pour la facture : jsPDF et html2canvas ne
      // pèsent sur le démarrage de personne.
      const { default: html2pdf } = await import('html2pdf.js');
      await html2pdf()
        .from(printRef.current)
        .set({
          margin: [10, 10, 12, 10],
          filename: `Compte_rendu_${suffixePeriode(periode)}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2 },
          jsPDF: { unit: 'mm', format: 'letter', orientation: 'portrait' },
          // Les sections se déclarent insécables ; le rendu doit le respecter.
          pagebreak: { mode: ['css', 'legacy'] }
        })
        .save();
    } catch (err) {
      setErreurPdf(err.message || 'La production du PDF a échoué.');
    } finally {
      setEnCours(false);
    }
  };

  const titre = `Compte rendu, ${libellePeriode(periode)}`;

  if (erreur || !sommaire) {
    return (
      <div ref={modaleRef} className="modal-overlay" role="dialog" aria-modal="true" aria-label={titre}>
        <div className="modal-content glass-panel">
          {erreur
            ? <p className="alert alert-error" role="alert">{erreur}</p>
            : <p>Préparation du compte rendu…</p>}
          <button type="button" className="btn-secondary" onClick={onClose}>Fermer</button>
        </div>
      </div>
    );
  }

  const s = sommaire;
  const e = s.entreprise || {};
  const m = (v) => formatMontant(v);
  const points = pointsDAttention(s);
  const plusieursMois = s.par_mois.length > 1;
  const maxMensuel = Math.max(0, ...s.par_mois.flatMap((x) => [x.facture, x.encaisse]));
  const categories = categoriesResumees(s.depenses.par_categorie);
  const balance = s.creances.balance;
  const clientsMasques = balance.nb_clients - balance.clients.length;

  return (
    <div
      ref={modaleRef} className="modal-overlay" role="dialog" aria-modal="true" aria-label={titre}
      style={{ zIndex: 9999, padding: '20px', overflowY: 'auto', display: 'block' }}
    >
      <div className="no-print" style={{ display: 'flex', justifyContent: 'center', gap: '15px', marginBottom: '20px', position: 'sticky', top: '10px', zIndex: 10000, flexWrap: 'wrap' }}>
        <button type="button" className="btn-secondary" onClick={onClose} style={{ background: 'white' }}>Fermer</button>
        <button type="button" className="btn-primary" onClick={telechargerPdf} disabled={enCours}>
          {enCours ? 'Production du PDF…' : '⬇️ Télécharger le PDF'}
        </button>
        <button type="button" className="btn-secondary" onClick={() => window.print()} style={{ background: 'white' }}>
          🖨️ Imprimer
        </button>
      </div>

      {erreurPdf && (
        <div className="no-print" style={{ maxWidth: '800px', margin: '0 auto 20px' }}>
          <p className="alert alert-error" role="alert">{erreurPdf}</p>
        </div>
      )}

      <div
        ref={printRef}
        className="print-only"
        style={{ background: 'white', color: COULEURS.encre, maxWidth: '800px', margin: '0 auto', padding: '40px', boxShadow: '0 0 20px rgba(0,0,0,0.1)', borderRadius: '8px', fontFamily: 'inherit' }}
      >
        {/* En-tête : la même identité que sur la facture. */}
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '20px', borderBottom: `2px solid ${COULEURS.filet}`, paddingBottom: '20px' }}>
          <div>
            {e.entreprise_logo && (
              <img src={e.entreprise_logo} alt="" style={{ maxHeight: '70px', maxWidth: '220px', marginBottom: '12px', display: 'block' }} />
            )}
            <p style={{ margin: '0 0 4px 0', fontSize: '1.1rem', color: COULEURS.bleu, fontWeight: 'bold' }}>
              {e.entreprise_nom || 'Votre entreprise'}
            </p>
            {e.entreprise_adresse && (
              <p style={{ margin: '0 0 4px 0', fontSize: '0.9rem', color: COULEURS.gris, whiteSpace: 'pre-line' }}>{e.entreprise_adresse}</p>
            )}
            {e.entreprise_email && (
              <p style={{ margin: 0, fontSize: '0.9rem', color: COULEURS.gris }}>{e.entreprise_email}</p>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ margin: '0 0 6px 0', fontSize: '1.7rem', color: COULEURS.encre, letterSpacing: '0.02em' }}>COMPTE RENDU</h2>
            <p style={{ margin: '0 0 6px 0', fontWeight: 'bold', fontSize: '1.05rem' }}>{libellePeriode(s.periode)}</p>
            <p style={{ margin: '0 0 4px 0', fontSize: '0.85rem', color: COULEURS.gris }}>
              Du {dateLongue(s.periode.debut)} au {dateLongue(s.periode.fin)}
            </p>
            <p style={{ margin: 0, fontSize: '0.85rem', color: COULEURS.gris }}>Produit le {dateLongue(s.date_reference)}</p>
          </div>
        </header>

        <p style={{ margin: '16px 0 0 0', fontSize: '0.85rem', color: COULEURS.gris }}>
          Sommaire de gestion établi à partir des factures, encaissements et dépenses inscrits dans Clora.
          Tous les montants sont en dollars canadiens.
        </p>

        {/* --- En un coup d'œil --- */}
        <Section titre="En un coup d'œil">
          <div style={grille(4)}>
            <Tuile
              titre="Facturé" valeur={m(s.facturation.facture_net)} couleur={COULEURS.bleu}
              detail={`${pluriel(s.facturation.nb_factures, 'facture')} à ${pluriel(s.facturation.nb_clients, 'client')}`
                + (s.facturation.total_credite > 0 ? `, net de ${m(s.facturation.total_credite)} de crédits` : '')}
            />
            <Tuile
              titre="Encaissé" valeur={m(s.encaissements.total_encaisse)} couleur={COULEURS.vert}
              detail={pluriel(s.encaissements.nb_paiements, 'paiement')
                + (s.encaissements.delai_moyen_jours !== null
                  ? `, reçus en moyenne ${s.encaissements.delai_moyen_jours} jours après émission` : '')}
            />
            <Tuile
              titre="Dépenses hors taxes" valeur={m(s.depenses.total_ht)} couleur={COULEURS.rouge}
              detail={`${pluriel(s.depenses.nb_depenses, 'dépense')}, ${m(s.depenses.taxes_recuperables)} de taxes récupérables`}
            />
            <Tuile
              titre="Bénéfice net" valeur={m(s.resultat.benefice_net)} couleur={COULEURS.violet}
              detail={s.resultat.marge !== null
                ? `${pourcent(s.resultat.marge)} de l'encaissé, moins les dépenses hors taxes`
                : 'Encaissé moins dépenses hors taxes'}
            />
          </div>
        </Section>

        {points.length > 0 && (
          <Section titre="Points d'attention">
            <ul style={{ margin: 0, paddingLeft: '20px', color: COULEURS.encre, fontSize: '0.92rem', lineHeight: 1.6 }}>
              {points.map((p) => <li key={p}>{p}</li>)}
            </ul>
          </Section>
        )}

        {/* --- Évolution mensuelle : inutile pour un mois seul --- */}
        {plusieursMois && (
          <Section titre="Évolution mensuelle" sousTitre="Facturé net des crédits par mois d'émission, encaissé par mois de paiement, dépenses hors taxes par date de dépense.">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th()}>Mois</th>
                  <th style={th('right')}>Facturé</th>
                  <th style={th('right')}>Encaissé</th>
                  <th style={th()}>Encaissé, en proportion</th>
                  <th style={th('right')}>Dépenses HT</th>
                </tr>
              </thead>
              <tbody>
                {s.par_mois.map((x) => (
                  <tr key={x.mois}>
                    <td style={td()}>{moisLong(x.mois)}</td>
                    <td style={td('right')}>{m(x.facture)}</td>
                    <td style={td('right')}>{m(x.encaisse)}</td>
                    <td style={td()}><Barre valeur={x.encaisse} max={maxMensuel} couleur={COULEURS.vert} /></td>
                    <td style={td('right')}>{m(x.depenses_ht)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td style={tdTotal()}>Total</td>
                  <td style={tdTotal('right')}>{m(s.facturation.facture_net)}</td>
                  <td style={tdTotal('right')}>{m(s.encaissements.total_encaisse)}</td>
                  <td style={tdTotal()} />
                  <td style={tdTotal('right')}>{m(s.depenses.total_ht)}</td>
                </tr>
              </tfoot>
            </table>
          </Section>
        )}

        {/* --- Créances : un état au jour du rapport --- */}
        <Section
          titre={`Ce qui vous est dû au ${dateLongue(s.date_reference)}`}
          sousTitre="État des comptes clients au jour où ce document est produit, toutes périodes confondues."
        >
          {balance.totaux.total > 0 ? (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th('left', { ...SERRE, minWidth: '150px' })}>Client</th>
                  {balance.tranches.map((t) => <th key={t.cle} style={th('right', SERRE)}>{t.libelle}</th>)}
                  <th style={th('right', SERRE)}>Total dû</th>
                </tr>
              </thead>
              <tbody>
                {balance.clients.map((c) => (
                  <tr key={c.client_id}>
                    <td style={td('left', SERRE)}>{c.client}</td>
                    {balance.tranches.map((t) => (
                      <td key={t.cle} style={td('right', { ...SERRE, color: t.cle === 'jours_91_plus' && c[t.cle] > 0 ? COULEURS.rouge : COULEURS.encre })}>
                        {c[t.cle] > 0 ? m(c[t.cle]) : '-'}
                      </td>
                    ))}
                    <td style={td('right', { ...SERRE, fontWeight: 600 })}>{m(c.total)}</td>
                  </tr>
                ))}
                {clientsMasques > 0 && (
                  <tr>
                    <td style={td('left', { ...SERRE, color: COULEURS.clair, fontStyle: 'italic' })} colSpan={balance.tranches.length + 2}>
                      et {pluriel(clientsMasques, 'autre client')} : le détail complet figure dans la balance âgée de l'écran Rapports.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td style={tdTotal('left', SERRE)}>Total</td>
                  {balance.tranches.map((t) => <td key={t.cle} style={tdTotal('right', SERRE)}>{m(balance.totaux[t.cle])}</td>)}
                  <td style={tdTotal('right', SERRE)}>{m(balance.totaux.total)}</td>
                </tr>
              </tfoot>
            </table>
          ) : (
            <p style={{ margin: 0, fontSize: '0.92rem', color: COULEURS.gris }}>Aucune somme n'est due : toutes les factures sont réglées.</p>
          )}
        </Section>

        {/* --- Clients --- */}
        <Section titre="Vos principaux clients sur la période" sousTitre="Classés sur le facturé net des notes de crédit.">
          {s.clients.principaux.length > 0 ? (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th()}>Client</th>
                  <th style={th('right')}>Factures</th>
                  <th style={th('right')}>Facturé</th>
                  <th style={th('right')}>Part</th>
                </tr>
              </thead>
              <tbody>
                {s.clients.principaux.map((c) => (
                  <tr key={c.client_id}>
                    <td style={td()}>{c.client}</td>
                    <td style={td('right')}>{c.nb_factures}</td>
                    <td style={td('right')}>{m(c.facture)}</td>
                    <td style={td('right')}>{part(c.facture, s.facturation.facture_net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ margin: 0, fontSize: '0.92rem', color: COULEURS.gris }}>Aucune facture sur la période.</p>
          )}
        </Section>

        {/* --- Dépenses --- */}
        <Section titre="Vos dépenses sur la période" sousTitre="Montants hors taxes, par catégorie.">
          {categories.length > 0 ? (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th()}>Catégorie</th>
                  <th style={th('right')}>Dépenses</th>
                  <th style={th('right')}>Hors taxes</th>
                  <th style={th('right')}>Part</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.categorie}>
                    <td style={td()}>{c.categorie}</td>
                    <td style={td('right')}>{c.nombre}</td>
                    <td style={td('right')}>{m(c.montant_ht)}</td>
                    <td style={td('right')}>{part(c.montant_ht, s.depenses.total_ht)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td style={tdTotal()}>Total hors taxes</td>
                  <td style={tdTotal('right')}>{s.depenses.nb_depenses}</td>
                  <td style={tdTotal('right')}>{m(s.depenses.total_ht)}</td>
                  <td style={tdTotal('right')} />
                </tr>
              </tfoot>
            </table>
          ) : (
            <p style={{ margin: 0, fontSize: '0.92rem', color: COULEURS.gris }}>Aucune dépense sur la période.</p>
          )}
          {s.depenses.kilometres > 0 && (
            <p style={{ margin: '12px 0 0 0', fontSize: '0.88rem', color: COULEURS.gris }}>
              Dont déplacements : {s.depenses.kilometres.toLocaleString('fr-CA')} km parcourus,
              pour une indemnité de {m(s.depenses.indemnite_kilometrique)}.
            </p>
          )}
        </Section>

        {/* --- Taxes --- */}
        <Section titre="Taxes de la période" sousTitre="Taxes facturées à vos clients, moins celles payées sur vos achats. Un montant net négatif correspond à un remboursement attendu.">
          <div style={grille(3)}>
            <Tuile titre="Taxes facturées" valeur={m(s.taxes.taxes_facturees)} couleur={COULEURS.bleu} />
            <Tuile titre="Taxes payées" valeur={m(s.taxes.taxes_payees)} couleur={COULEURS.ambre} />
            <Tuile titre="Taxes nettes à remettre" valeur={m(s.taxes.taxes_nettes)} couleur={s.taxes.taxes_nettes < 0 ? COULEURS.vert : COULEURS.encre} />
          </div>
          {s.taxes.parRegime.length > 0 && (
            <p style={{ margin: '12px 0 0 0', fontSize: '0.88rem', color: COULEURS.gris }}>
              Facturé par régime : {s.taxes.parRegime.map((r) => `${r.nom} ${m(r.montant)}`).join(', ')}.
            </p>
          )}
        </Section>

        <footer style={{ marginTop: '48px', paddingTop: '16px', borderTop: `1px solid ${COULEURS.filet}`, fontSize: '0.78rem', color: COULEURS.clair, textAlign: 'center', lineHeight: 1.5 }}>
          <p style={{ margin: '0 0 6px 0' }}>
            Ce document est un sommaire de gestion produit par Clora. Il ne constitue pas des états financiers
            et ne remplace ni un bilan ni un état des résultats préparés par un comptable.
          </p>
          {(e.taxe_1_numero || e.taxe_2_numero) && (
            <p style={{ margin: 0 }}>
              {[
                e.taxe_1_numero && `${e.taxe_1_nom} : ${e.taxe_1_numero}`,
                e.taxe_2_numero && `${e.taxe_2_nom} : ${e.taxe_2_numero}`
              ].filter(Boolean).join(' | ')}
            </p>
          )}
        </footer>
      </div>
    </div>
  );
}

export default RapportSommaire;
