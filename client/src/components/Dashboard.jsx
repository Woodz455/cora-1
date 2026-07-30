import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { api, formatMontant } from '../api';

function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let annule = false;
    api.get('/api/stats')
      .then((data) => { if (!annule) setStats(data); })
      .catch((err) => { if (!annule) setError(err.message); })
      .finally(() => { if (!annule) setLoading(false); });
    return () => { annule = true; };
  }, []);

  if (loading) return <p style={{ color: 'var(--text-muted)' }}>Chargement du tableau de bord…</p>;
  if (error) return <p className="alert alert-error" role="alert">{error}</p>;
  if (!stats) return null;

  const cartes = [
    { titre: "Chiffre d'affaires encaissé", valeur: stats.chiffreAffaires, couleur: '#10b981' },
    { titre: 'Montant en attente', valeur: stats.facturesEnAttente, couleur: '#f59e0b' },
    { titre: 'Montant en retard', valeur: stats.facturesEnRetard, couleur: '#ef4444' }
  ];

  return (
    <div style={{ animation: 'fadeIn 0.5s ease-out' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginBottom: '40px' }}>
        {cartes.map((carte) => (
          <div key={carte.titre} className="glass-card" style={{ padding: '25px', borderLeft: `4px solid ${carte.couleur}` }}>
            <p style={{ margin: '0 0 10px 0', color: 'var(--text-muted)', fontSize: '0.9rem', textTransform: 'uppercase', fontWeight: 'bold' }}>
              {carte.titre}
            </p>
            <h3 style={{ margin: 0, fontSize: '2.3rem', color: 'var(--text-main)' }}>{formatMontant(carte.valeur)}</h3>
          </div>
        ))}
      </div>

      <div className="glass-card" style={{ padding: '30px' }}>
        {/* Les revenus sont regroupés par mois d'encaissement et non d'émission :
            c'est la trésorerie réellement entrée sur la période. */}
        <h3 style={{ margin: '0 0 20px 0', color: 'var(--text-main)', fontSize: '1.2rem' }}>Encaissements par mois</h3>
        {stats.chartData && stats.chartData.length > 0 ? (
          <div style={{ height: '350px', width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-color)" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)' }} dx={-10} tickFormatter={(val) => `${val} $`} />
                <Tooltip
                  cursor={{ fill: 'var(--hover-subtle)' }}
                  contentStyle={{ borderRadius: '12px', border: '1px solid var(--glass-border)', background: 'var(--app-bg)', color: 'var(--text-main)' }}
                  formatter={(value) => [formatMontant(value), 'Encaissé']}
                />
                <Bar dataKey="revenu" fill="#0e4a9e" radius={[6, 6, 0, 0]} maxBarSize={60} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="empty-state">Aucun encaissement enregistré pour l'instant.</p>
        )}
      </div>
    </div>
  );
}

export default Dashboard;
