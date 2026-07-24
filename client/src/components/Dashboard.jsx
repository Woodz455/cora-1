import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch('/api/stats');
        if (!res.ok) throw new Error('Erreur réseau');
        const data = await res.json();
        setStats(data);
      } catch (err) {
        console.error(err);
        setError('Impossible de charger les statistiques.');
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  if (loading) return <div className="dashboard-container" style={{ padding: '30px' }}><p>Chargement du tableau de bord...</p></div>;
  if (error) return <div className="dashboard-container" style={{ padding: '30px' }}><p style={{ color: 'red' }}>{error}</p></div>;

  return (
    <div className="dashboard-container" style={{ padding: '30px', animation: 'fadeIn 0.5s ease-out' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <h2 style={{ fontSize: '2rem', color: 'var(--text-main)', margin: 0, fontFamily: 'Outfit, sans-serif' }}>Tableau de bord</h2>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px', marginBottom: '40px' }}>
        <div className="glass-card" style={{ padding: '25px', borderLeft: '4px solid #10b981' }}>
          <p style={{ margin: '0 0 10px 0', color: 'var(--text-muted)', fontSize: '0.9rem', textTransform: 'uppercase', fontWeight: 'bold' }}>Chiffre d'affaires encaissé</p>
          <h3 style={{ margin: 0, fontSize: '2.5rem', color: 'var(--text-main)' }}>{stats.chiffreAffaires.toFixed(2)} $</h3>
        </div>
        <div className="glass-card" style={{ padding: '25px', borderLeft: '4px solid #f59e0b' }}>
          <p style={{ margin: '0 0 10px 0', color: 'var(--text-muted)', fontSize: '0.9rem', textTransform: 'uppercase', fontWeight: 'bold' }}>Montant en attente</p>
          <h3 style={{ margin: 0, fontSize: '2.5rem', color: 'var(--text-main)' }}>{stats.facturesEnAttente.toFixed(2)} $</h3>
        </div>
        <div className="glass-card" style={{ padding: '25px', borderLeft: '4px solid #ef4444' }}>
          <p style={{ margin: '0 0 10px 0', color: 'var(--text-muted)', fontSize: '0.9rem', textTransform: 'uppercase', fontWeight: 'bold' }}>Montant en retard</p>
          <h3 style={{ margin: 0, fontSize: '2.5rem', color: 'var(--text-main)' }}>{stats.facturesEnRetard.toFixed(2)} $</h3>
        </div>
      </div>

      <div className="glass-card" style={{ padding: '30px' }}>
        <h3 style={{ margin: '0 0 20px 0', color: 'var(--text-main)', fontSize: '1.2rem' }}>Revenus par mois</h3>
        <div style={{ height: '350px', width: '100%' }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats.chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b' }} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b' }} dx={-10} tickFormatter={(val) => `${val}$`} />
              <Tooltip 
                cursor={{ fill: '#f8fafc' }} 
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1)' }}
                formatter={(value) => [`${value.toFixed(2)} $`, 'Revenus']}
              />
              <Bar dataKey="revenu" fill="#0e4a9e" radius={[6, 6, 0, 0]} maxBarSize={60} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
