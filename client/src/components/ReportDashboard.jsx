import React, { useState, useEffect } from 'react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import InfoTooltip from './InfoTooltip';

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444'];

function ReportDashboard() {
  const [stats, setStats] = useState(null);
  const [taxStats, setTaxStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [statsRes, taxRes] = await Promise.all([
          fetch('/api/rapports'),
          fetch('/api/rapports/taxes')
        ]);
        if (!statsRes.ok || !taxRes.ok) throw new Error('Erreur réseau');
        
        const data = await statsRes.json();
        const taxData = await taxRes.json();
        
        setStats(data);
        setTaxStats(taxData);
      } catch (err) {
        setError('Impossible de charger les rapports');
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  if (loading) return <p style={{ color: 'var(--text-muted)' }}>Calcul des statistiques...</p>;
  if (error) return <p style={{ color: '#ef4444' }}>{error}</p>;
  if (!stats) return null;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <h2 style={{ color: 'var(--text-main)', margin: 0 }}>Vue d'ensemble financière</h2>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', background: 'var(--glass-bg)', padding: '5px 10px', borderRadius: '15px', border: '1px solid var(--glass-border)' }}>
          🇨🇦 Tous les montants sont consolidés en CAD
        </span>
      </div>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px' }}>
        {/* Carte 1 : Revenu Total */}
        <div className="glass-card" style={{ borderTop: '4px solid var(--safehill-blue)' }}>
          <p style={{ margin: '0 0 10px 0', color: 'var(--text-muted)', fontWeight: '500', textTransform: 'uppercase', fontSize: '0.85rem' }}>Total Facturé</p>
          <h3 style={{ margin: 0, fontSize: '2rem', color: 'var(--text-main)' }}>{stats.revenu_total.toFixed(2)} $</h3>
        </div>

        {/* Carte 2 : Total Encaissé */}
        <div className="glass-card" style={{ borderTop: '4px solid var(--status-paid)' }}>
          <p style={{ margin: '0 0 10px 0', color: 'var(--text-muted)', fontWeight: '500', textTransform: 'uppercase', fontSize: '0.85rem' }}>Total Encaissé</p>
          <h3 style={{ margin: 0, fontSize: '2rem', color: 'var(--status-paid)' }}>{stats.total_encaisse.toFixed(2)} $</h3>
        </div>

        {/* Carte 3 : Total Dépenses */}
        <div className="glass-card" style={{ borderTop: '4px solid #ef4444' }}>
          <p style={{ margin: '0 0 10px 0', color: 'var(--text-muted)', fontWeight: '500', textTransform: 'uppercase', fontSize: '0.85rem' }}>
            Total Dépenses TTC <InfoTooltip text="Toutes Taxes Comprises : Le montant total de vos achats incluant les taxes." />
          </p>
          <h3 style={{ margin: 0, fontSize: '2rem', color: '#ef4444' }}>{stats.total_depenses.toFixed(2)} $</h3>
        </div>

        {/* Carte 4 : Bénéfice Net */}
        <div className="glass-card" style={{ borderTop: '4px solid #8b5cf6' }}>
          <p style={{ margin: '0 0 10px 0', color: 'var(--text-muted)', fontWeight: '500', textTransform: 'uppercase', fontSize: '0.85rem' }}>
            Bénéfice Net <InfoTooltip text="Total Encaissé (Revenus) - Total Dépenses TTC." />
          </p>
          <h3 style={{ margin: 0, fontSize: '2rem', color: '#8b5cf6' }}>{(stats.total_encaisse - stats.total_depenses).toFixed(2)} $</h3>
        </div>

        {/* Carte 5 : Solde à Percevoir */}
        <div className="glass-card" style={{ borderTop: '4px solid var(--status-partial)' }}>
          <p style={{ margin: '0 0 10px 0', color: 'var(--text-muted)', fontWeight: '500', textTransform: 'uppercase', fontSize: '0.85rem' }}>Reste à Percevoir</p>
          <h3 style={{ margin: 0, fontSize: '2rem', color: 'var(--status-partial)' }}>{stats.solde_a_percevoir.toFixed(2)} $</h3>
        </div>
      </div>
      
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginTop: '40px' }}>
        {/* Graphique des statuts */}
        <div className="glass-panel" style={{ padding: '20px' }}>
          <h3 style={{ marginTop: 0, color: 'var(--text-main)' }}>Répartition des statuts</h3>
          {stats.statusDistribution && stats.statusDistribution.length > 0 ? (
            <div style={{ width: '100%', height: 300 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={stats.statusDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={5}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {stats.statusDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: 'var(--app-bg)', borderColor: 'var(--glass-border)', color: 'var(--text-main)' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p style={{ color: 'var(--text-muted)' }}>Aucune donnée disponible</p>
          )}
        </div>

        {/* Top Clients */}
        <div className="glass-panel" style={{ padding: '20px' }}>
          <h3 style={{ marginTop: 0, color: 'var(--text-main)' }}>Top Clients (Revenus)</h3>
          {stats.topClients && stats.topClients.length > 0 ? (
            <div style={{ width: '100%', height: 300 }}>
              <ResponsiveContainer>
                <BarChart data={stats.topClients} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <XAxis type="number" stroke="var(--text-muted)" />
                  <YAxis dataKey="name" type="category" stroke="var(--text-main)" width={100} />
                  <Tooltip contentStyle={{ backgroundColor: 'var(--app-bg)', borderColor: 'var(--glass-border)', color: 'var(--text-main)' }} />
                  <Bar dataKey="revenu" fill="var(--safehill-blue)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p style={{ color: 'var(--text-muted)' }}>Aucune donnée disponible</p>
          )}
        </div>
      </div>

      {/* Factures en Retard */}
      {stats.lateInvoices && stats.lateInvoices.length > 0 && (
        <div className="glass-panel" style={{ marginTop: '40px', padding: '30px', border: '1px solid #ef4444' }}>
          <h3 style={{ margin: '0 0 15px 0', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '10px' }}>
            ⚠️ Alertes de Trésorerie : Factures en Retard
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {stats.lateInvoices.map(invoice => (
              <div key={invoice.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '15px', background: 'rgba(239, 68, 68, 0.05)', borderRadius: '8px' }}>
                <div>
                  <strong style={{ color: 'var(--text-main)' }}>{invoice.numero_facture}</strong> - {invoice.client}
                  <p style={{ margin: '5px 0 0 0', fontSize: '0.9rem', color: '#ef4444' }}>
                    Échéance dépassée : {invoice.date_echeance}
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--text-main)' }}>
                    {invoice.solde_restant.toFixed(2)} $
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rapport de Remises de Taxes */}
      {taxStats && taxStats.summary && (
        <div className="glass-panel" style={{ marginTop: '40px', padding: '30px' }}>
          <h3 style={{ margin: '0 0 15px 0', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '10px' }}>
            📊 Rapport de Taxes et Déclaration 
            <InfoTooltip text="CTI / RTI : Crédit ou Remboursement de la Taxe sur les Intrants. Vous récupérez les taxes payées sur vos achats." />
          </h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>
            Ce rapport calcule les taxes que vous avez facturées moins les taxes que vous avez payées sur vos achats (Crédits de taxe sur les intrants).
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '25px' }}>
            <div style={{ padding: '15px', background: 'var(--glass-bg)', borderLeft: '4px solid #3b82f6', borderRadius: '8px' }}>
              <p style={{ margin: '0 0 5px 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Taxes Totales Facturées</p>
              <h4 style={{ margin: 0, fontSize: '1.4rem', color: 'var(--text-main)' }}>{(taxStats.summary.total_taxe_1 + taxStats.summary.total_taxe_2).toFixed(2)} $</h4>
            </div>
            {taxStats.depenses && (
              <div style={{ padding: '15px', background: 'var(--glass-bg)', borderLeft: '4px solid #f59e0b', borderRadius: '8px' }}>
                <p style={{ margin: '0 0 5px 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Taxes Totales Payées (CTI)
                  <InfoTooltip text="La somme des taxes payées sur vos dépenses." />
                </p>
                <h4 style={{ margin: 0, fontSize: '1.4rem', color: 'var(--text-main)' }}>{(taxStats.depenses.total_tps_payee + taxStats.depenses.total_tvq_payee).toFixed(2)} $</h4>
              </div>
            )}
            {taxStats.depenses && (
              <div style={{ padding: '15px', background: 'var(--glass-bg)', borderLeft: '4px solid #10b981', borderRadius: '8px' }}>
                <p style={{ margin: '0 0 5px 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Taxes Nettes à Remettre
                  <InfoTooltip text="Taxes facturées MOINS taxes payées." />
                </p>
                <h4 style={{ margin: 0, fontSize: '1.4rem', color: 'var(--text-main)' }}>{((taxStats.summary.total_taxe_1 + taxStats.summary.total_taxe_2) - (taxStats.depenses.total_tps_payee + taxStats.depenses.total_tvq_payee)).toFixed(2)} $</h4>
              </div>
            )}
          </div>

          <h4 style={{ color: 'var(--text-main)', marginBottom: '10px' }}>Détails par taxe</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--glass-border)' }}>
                <th style={{ textAlign: 'left', padding: '10px', color: 'var(--text-muted)' }}>Nom de la Taxe</th>
                <th style={{ textAlign: 'right', padding: '10px', color: 'var(--text-muted)' }}>Montant perçu</th>
              </tr>
            </thead>
            <tbody>
              {taxStats.details.map((d, idx) => (
                <React.Fragment key={idx}>
                  {d.taxe_1_nom && (
                    <tr style={{ borderBottom: '1px solid var(--glass-border)' }}>
                      <td style={{ padding: '10px', color: 'var(--text-main)' }}>{d.taxe_1_nom}</td>
                      <td style={{ padding: '10px', textAlign: 'right', color: 'var(--text-main)', fontWeight: 'bold' }}>{d.montant_taxe_1.toFixed(2)} $</td>
                    </tr>
                  )}
                  {d.taxe_2_nom && d.montant_taxe_2 > 0 && (
                    <tr style={{ borderBottom: '1px solid var(--glass-border)' }}>
                      <td style={{ padding: '10px', color: 'var(--text-main)' }}>{d.taxe_2_nom}</td>
                      <td style={{ padding: '10px', textAlign: 'right', color: 'var(--text-main)', fontWeight: 'bold' }}>{d.montant_taxe_2.toFixed(2)} $</td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default ReportDashboard;
