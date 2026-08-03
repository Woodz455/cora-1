import { useState, useEffect, useMemo } from 'react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import InfoTooltip from './InfoTooltip';
import { api, formatMontant } from '../api';

const COULEURS_STATUT = {
  'Payée': '#10b981',
  'Partiellement payée': '#f59e0b',
  'En attente': '#3b82f6',
  'Annulée': '#94a3b8'
};
const COULEURS_DEFAUT = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'];

const MOIS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
];

/** Carte d'indicateur. */
function Carte({ titre, valeur, couleur, aide }) {
  return (
    <div className="glass-card" style={{ borderTop: `4px solid ${couleur}` }}>
      <p style={{ margin: '0 0 10px 0', color: 'var(--text-muted)', fontWeight: '500', textTransform: 'uppercase', fontSize: '0.85rem' }}>
        {titre}{aide && <InfoTooltip text={aide} />}
      </p>
      <h3 style={{ margin: 0, fontSize: '1.9rem', color: couleur }}>{valeur}</h3>
    </div>
  );
}

function ReportDashboard() {
  const [stats, setStats] = useState(null);
  const [taxStats, setTaxStats] = useState(null);
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const anneeCourante = new Date().getFullYear();
  const [annee, setAnnee] = useState(String(anneeCourante));
  const [mois, setMois] = useState('');
  const [trimestre, setTrimestre] = useState('');

  useEffect(() => {
    let annule = false;
    api.get('/api/rapports')
      .then((data) => { if (!annule) setStats(data); })
      .catch((err) => { if (!annule) setError(err.message); })
      .finally(() => { if (!annule) setLoading(false); });

    // La balance âgée est indépendante de la période : elle décrit ce qui est
    // dû aujourd'hui, pas ce qui a été facturé sur un exercice.
    api.get('/api/rapports/balance-agee')
      .then((data) => { if (!annule) setBalance(data); })
      .catch(() => {});

    return () => { annule = true; };
  }, []);

  // Le rapport de taxes est rechargé à chaque changement de période : une
  // déclaration se prépare par trimestre ou par mois, pas sur l'historique complet.
  useEffect(() => {
    let annule = false;
    const params = new URLSearchParams();
    if (annee) params.set('annee', annee);
    if (mois) params.set('mois', mois);
    else if (trimestre) params.set('trimestre', trimestre);

    api.get(`/api/rapports/taxes?${params.toString()}`)
      .then((data) => { if (!annule) setTaxStats(data); })
      .catch((err) => { if (!annule) setError(err.message); });
    return () => { annule = true; };
  }, [annee, mois, trimestre]);

  const anneesDisponibles = useMemo(() => {
    const annees = [];
    for (let a = anneeCourante; a >= anneeCourante - 6; a--) annees.push(String(a));
    return annees;
  }, [anneeCourante]);

  if (loading) return <p style={{ color: 'var(--text-muted)' }}>Calcul des statistiques…</p>;
  if (error && !stats) return <p className="alert alert-error" role="alert">{error}</p>;
  if (!stats) return null;

  // Le bénéfice net se calcule sur les dépenses hors taxes : les taxes payées
  // sur les achats sont récupérables et ne constituent pas une charge.
  const beneficeNet = stats.total_encaisse - stats.total_depenses_ht;

  /** Les registres suivent la période choisie pour le rapport de taxes. */
  const lienExport = (registre) => {
    const params = new URLSearchParams();
    if (annee) params.set('annee', annee);
    if (mois) params.set('mois', mois);
    else if (trimestre) params.set('trimestre', trimestre);
    return `/api/rapports/export/${registre}?${params.toString()}`;
  };

  return (
    <div>
      <div className="toolbar">
        <h2 style={{ color: 'var(--text-main)', margin: 0 }}>Vue d'ensemble financière</h2>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', background: 'var(--glass-bg)', padding: '6px 12px', borderRadius: '15px', border: '1px solid var(--glass-border)' }}>
          🇨🇦 Tous les montants sont consolidés en dollars canadiens
        </span>
      </div>

      {balance && balance.clients.length > 0 && (
        <div className="glass-panel" style={{ padding: '25px', marginTop: '30px' }}>
          <div className="toolbar">
            <div>
              <h3 style={{ margin: 0, color: 'var(--text-main)' }}>
                ⏳ Balance âgée
                <InfoTooltip text="Répartition de ce qui vous est dû selon l'ancienneté du retard. Plus une créance vieillit, moins elle a de chances d'être recouvrée." />
              </h3>
              <p style={{ margin: '6px 0 0 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                Au {new Date(balance.date_reference).toLocaleDateString('fr-CA')}
              </p>
            </div>
            <a className="btn-secondary" href="/api/rapports/export/balance-agee" download>
              Exporter en CSV
            </a>
          </div>

          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Client</th>
                  {balance.tranches.map((t) => (
                    <th key={t.cle} style={{ textAlign: 'right' }}>{t.libelle}</th>
                  ))}
                  <th style={{ textAlign: 'right' }}>Total dû</th>
                </tr>
              </thead>
              <tbody>
                {balance.clients.map((c) => (
                  <tr key={c.client_id}>
                    <td>{c.client}</td>
                    {balance.tranches.map((t) => (
                      <td
                        key={t.cle}
                        style={{
                          textAlign: 'right',
                          // Le retard le plus ancien est celui qui doit sauter aux yeux.
                          color: t.cle === 'jours_91_plus' && c[t.cle] > 0
                            ? 'var(--status-danger)' : 'inherit'
                        }}
                      >
                        {c[t.cle] > 0 ? formatMontant(c[t.cle]) : '—'}
                      </td>
                    ))}
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatMontant(c.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 700, borderTop: '2px solid var(--glass-border)' }}>
                  <td>Total</td>
                  {balance.tranches.map((t) => (
                    <td key={t.cle} style={{ textAlign: 'right' }}>
                      {formatMontant(balance.totaux[t.cle])}
                    </td>
                  ))}
                  <td style={{ textAlign: 'right' }}>{formatMontant(balance.totaux.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <div className="glass-panel" style={{ padding: '20px', marginTop: '25px' }}>
        <div className="toolbar">
          <div>
            <h3 style={{ margin: 0, color: 'var(--text-main)' }}>📤 Registres pour votre comptable</h3>
            <p style={{ margin: '6px 0 0 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              Fichiers CSV directement lisibles dans Excel, à transmettre au logiciel comptable
              (Acomba, Sage, QuickBooks) pour la fin d'année.
            </p>
          </div>
          <div className="toolbar-group">
            {/* Un lien, et non un appel `api.get` : la réponse est un fichier,
                pas du JSON. Le cookie de session part avec la requête, l'API
                étant servie par la même origine. */}
            <a className="btn-secondary" href={lienExport('ventes')} download>
              Registre des ventes
            </a>
            <a className="btn-secondary" href={lienExport('encaissements')} download>
              Registre des encaissements
            </a>
          </div>
        </div>
      </div>

      {error && <p className="alert alert-error" role="alert">{error}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '20px' }}>
        <Carte titre="Total facturé" valeur={formatMontant(stats.revenu_total)} couleur="var(--safehill-blue)" />
        <Carte titre="Total encaissé" valeur={formatMontant(stats.total_encaisse)} couleur="var(--status-paid)" />
        <Carte
          titre="Dépenses hors taxes"
          valeur={formatMontant(stats.total_depenses_ht)}
          couleur="#ef4444"
          aide="Le montant de vos achats avant taxes. C'est cette valeur qui constitue une charge : les taxes payées sont récupérables."
        />
        <Carte
          titre="Bénéfice net"
          valeur={formatMontant(beneficeNet)}
          couleur="#8b5cf6"
          aide="Total encaissé moins les dépenses hors taxes."
        />
        <Carte titre="Reste à percevoir" valeur={formatMontant(stats.solde_a_percevoir)} couleur="var(--status-partial)" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '20px', marginTop: '40px' }}>
        <div className="glass-panel" style={{ padding: '20px' }}>
          <h3 style={{ marginTop: 0, color: 'var(--text-main)' }}>Répartition des statuts</h3>
          {stats.statusDistribution && stats.statusDistribution.length > 0 ? (
            <div style={{ width: '100%', height: 300 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={stats.statusDistribution}
                    cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={5}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)} %`}
                  >
                    {stats.statusDistribution.map((entry, index) => (
                      <Cell key={entry.name} fill={COULEURS_STATUT[entry.name] || COULEURS_DEFAUT[index % COULEURS_DEFAUT.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: 'var(--app-bg)', borderColor: 'var(--glass-border)', color: 'var(--text-main)' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="empty-state">Aucune donnée disponible.</p>
          )}
        </div>

        <div className="glass-panel" style={{ padding: '20px' }}>
          <h3 style={{ marginTop: 0, color: 'var(--text-main)' }}>Principaux clients (facturé)</h3>
          {stats.topClients && stats.topClients.length > 0 ? (
            <div style={{ width: '100%', height: 300 }}>
              <ResponsiveContainer>
                <BarChart data={stats.topClients} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <XAxis type="number" stroke="var(--text-muted)" />
                  <YAxis dataKey="name" type="category" stroke="var(--text-main)" width={110} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--app-bg)', borderColor: 'var(--glass-border)', color: 'var(--text-main)' }}
                    formatter={(value) => [formatMontant(value), 'Facturé']}
                  />
                  <Bar dataKey="revenu" fill="var(--safehill-blue)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="empty-state">Aucune donnée disponible.</p>
          )}
        </div>
      </div>

      {stats.lateInvoices && stats.lateInvoices.length > 0 && (
        <div className="glass-panel" style={{ marginTop: '40px', padding: '30px', border: '1px solid var(--status-danger-border)' }}>
          <h3 style={{ margin: '0 0 15px 0', color: 'var(--status-danger)' }}>
            ⚠️ Alertes de trésorerie : factures en retard
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {stats.lateInvoices.map((invoice) => (
              <div key={invoice.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '20px', padding: '15px', background: 'var(--status-danger-bg)', borderRadius: '8px' }}>
                <div>
                  <strong style={{ color: 'var(--text-main)' }}>{invoice.numero_facture}</strong> — {invoice.client}
                  <p style={{ margin: '5px 0 0 0', fontSize: '0.9rem', color: 'var(--status-danger)' }}>
                    Échéance dépassée : {invoice.date_echeance}
                  </p>
                </div>
                <span style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
                  {formatMontant(invoice.solde_restant)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="glass-panel" style={{ marginTop: '40px', padding: '30px' }}>
        <div className="toolbar">
          <h3 style={{ margin: 0, color: 'var(--text-main)' }}>
            📊 Rapport de taxes
            <InfoTooltip text="CTI / RTI : crédit ou remboursement de la taxe sur les intrants. Vous récupérez les taxes payées sur vos achats." />
          </h3>
          <div className="toolbar-group">
            <select className="search-input" style={{ minWidth: '120px' }} value={annee} onChange={(e) => setAnnee(e.target.value)} aria-label="Année">
              {anneesDisponibles.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            {/* Trimestre et mois s'excluent : choisir l'un remet l'autre à
                zéro, plutôt que de laisser l'écran décrire une période
                contradictoire que le serveur refuserait. */}
            <select
              className="search-input" style={{ minWidth: '150px' }} value={trimestre}
              onChange={(e) => { setTrimestre(e.target.value); if (e.target.value) setMois(''); }}
              aria-label="Trimestre"
            >
              <option value="">Aucun trimestre</option>
              <option value="1">T1 — janv. à mars</option>
              <option value="2">T2 — avr. à juin</option>
              <option value="3">T3 — juill. à sept.</option>
              <option value="4">T4 — oct. à déc.</option>
            </select>
            <select
              className="search-input" style={{ minWidth: '160px' }} value={mois}
              onChange={(e) => { setMois(e.target.value); if (e.target.value) setTrimestre(''); }}
              aria-label="Mois"
            >
              <option value="">Toute l'année</option>
              {MOIS.map((nom, i) => (
                <option key={nom} value={String(i + 1).padStart(2, '0')}>{nom}</option>
              ))}
            </select>
          </div>
        </div>

        {taxStats ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '20px', marginBottom: '25px' }}>
              <div style={{ padding: '15px', background: 'var(--glass-bg)', borderLeft: '4px solid #3b82f6', borderRadius: '8px' }}>
                <p style={{ margin: '0 0 5px 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Taxes facturées</p>
                <h4 style={{ margin: 0, fontSize: '1.4rem', color: 'var(--text-main)' }}>{formatMontant(taxStats.taxes_facturees)}</h4>
              </div>
              <div style={{ padding: '15px', background: 'var(--glass-bg)', borderLeft: '4px solid #f59e0b', borderRadius: '8px' }}>
                <p style={{ margin: '0 0 5px 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Taxes payées (CTI)
                  <InfoTooltip text="La somme des taxes payées sur vos dépenses de la période." />
                </p>
                <h4 style={{ margin: 0, fontSize: '1.4rem', color: 'var(--text-main)' }}>{formatMontant(taxStats.taxes_payees)}</h4>
              </div>
              <div style={{ padding: '15px', background: 'var(--glass-bg)', borderLeft: '4px solid #10b981', borderRadius: '8px' }}>
                <p style={{ margin: '0 0 5px 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Taxes nettes à remettre
                  <InfoTooltip text="Taxes facturées moins taxes payées. Un montant négatif correspond à un remboursement attendu." />
                </p>
                <h4 style={{ margin: 0, fontSize: '1.4rem', color: 'var(--text-main)' }}>{formatMontant(taxStats.taxes_nettes)}</h4>
              </div>
            </div>

            {/* Chaque régime est présenté séparément : TPS, TVH et TVQ se
                déclarent à des administrations et sur des lignes distinctes,
                les additionner en un seul total rendait le rapport inutilisable. */}
            <h4 style={{ color: 'var(--text-main)', marginBottom: '10px' }}>Détail par régime de taxe</h4>
            {taxStats.parRegime && taxStats.parRegime.length > 0 ? (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Régime</th>
                      <th className="numeric">Montant perçu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {taxStats.parRegime.map((regime) => (
                      <tr key={regime.nom}>
                        <td style={{ fontWeight: '500' }}>{regime.nom}</td>
                        <td className="numeric" style={{ fontWeight: 'bold' }}>{formatMontant(regime.montant)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td style={{ fontWeight: '600' }}>Revenus taxables</td>
                      <td className="numeric">{formatMontant(taxStats.summary.total_revenus_taxables)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty-state">Aucune taxe facturée sur cette période.</p>
            )}
          </>
        ) : (
          <p style={{ color: 'var(--text-muted)' }}>Chargement du rapport…</p>
        )}
      </div>
    </div>
  );
}

export default ReportDashboard;
