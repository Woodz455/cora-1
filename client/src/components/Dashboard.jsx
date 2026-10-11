import { useState, useEffect, useMemo } from 'react';
import { TriangleAlert } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../api';
import { useLangue } from '../i18n.js';

/**
 * Les premiers pas du dossier, dans l'ordre que son profil suggère.
 *
 * Une liste qui se coche d'elle-même d'après ce qui est déjà dans le dossier,
 * et non un assistant qui retiendrait l'utilisateur : chaque étape mène à
 * l'écran où elle s'accomplit, et rien n'empêche de faire autre chose d'abord.
 * Elle disparaît quand tout est fait, ou d'un clic.
 */
function PremiersPas({ demarrage, onMasquer, naviguer }) {
  const { t, tp } = useLangue();
  const faites = demarrage.etapes.filter((e) => e.fait).length;
  const total = demarrage.etapes.length;

  return (
    <div className="glass-card" style={{ padding: '32px', marginBottom: '40px' }}>
      <div className="toolbar" style={{ marginBottom: '16px' }}>
        <div>
          <h3 style={{ margin: 0, color: 'var(--text-main)', fontSize: '1.2rem' }}>{t('Pour commencer')}</h3>
          <p style={{ margin: '4px 0 0 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
            {demarrage.profil ? `${t(demarrage.profil.libelle)}${t(' : ')}` : ''}
            {tp(faites, "{n} étape sur {total}. Chaque étape se coche d'elle-même.",
              "{n} étapes sur {total}. Chaque étape se coche d'elle-même.", { total })}
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={onMasquer}>{t('Masquer')}</button>
      </div>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {demarrage.etapes.map((etape, index) => (
          <li key={etape.cle}>
            <button
              type="button"
              onClick={() => naviguer(etape.vue, etape.ancre ? { ancre: etape.ancre } : null)}
              aria-label={etape.fait ? t('{titre}, fait', { titre: t(etape.titre) }) : t(etape.titre)}
              style={{
                width: '100%', textAlign: 'left', padding: '12px 16px', font: 'inherit',
                background: etape.fait ? 'transparent' : 'var(--hover-subtle)',
                border: '1px solid var(--glass-border)', borderRadius: '10px',
                color: etape.fait ? 'var(--text-muted)' : 'var(--text-main)', cursor: 'pointer',
                marginBottom: '8px', display: 'flex', gap: '12px', alignItems: 'flex-start'
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  flexShrink: 0, width: '26px', height: '26px', borderRadius: '50%', fontSize: '0.85rem',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600,
                  background: etape.fait ? 'var(--status-paid-bg)' : 'var(--glass-bg)',
                  color: etape.fait ? 'var(--status-paid)' : 'var(--text-main)',
                  border: etape.fait ? 'none' : '1px solid var(--glass-border)'
                }}
              >
                {etape.fait ? '✓' : index + 1}
              </span>
              <span style={{ flex: 1 }}>
                <span style={{ display: 'block', fontWeight: etape.fait ? 500 : 600, textDecoration: etape.fait ? 'line-through' : 'none' }}>
                  {t(etape.titre)}
                </span>
                {!etape.fait && (
                  <span style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {t(etape.detail)}
                  </span>
                )}
              </span>
              {!etape.fait && <span aria-hidden="true" style={{ color: 'var(--text-muted)' }}>→</span>}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Dashboard({ naviguer }) {
  const [stats, setStats] = useState(null);
  const [aFaire, setAFaire] = useState({ factures: [], devis: [], depots: [] });
  const [demarrage, setDemarrage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { t, tp, montant } = useLangue();

  // Réservé à l'administration : un 403 signifie simplement qu'il n'y a rien à
  // montrer, les étapes menant presque toutes aux paramètres.
  useEffect(() => {
    let annule = false;
    api.get('/api/demarrage')
      .then((data) => { if (!annule) setDemarrage(data); })
      .catch(() => {});
    return () => { annule = true; };
  }, []);

  const masquerPremiersPas = async () => {
    try {
      await api.post('/api/demarrage/masquer', {});
      setDemarrage((prev) => (prev ? { ...prev, masque: true } : prev));
    } catch {
      // La liste reviendra au prochain passage : rien de grave.
    }
  };

  useEffect(() => {
    let annule = false;

    const charger = async () => {
      try {
        const data = await api.get('/api/stats');
        if (!annule) setStats(data);
      } catch (err) {
        if (!annule) setError(err.message);
      } finally {
        if (!annule) setLoading(false);
      }

      // Ce qu'il reste à faire, monté depuis les listes déjà servies par l'API.
      // Le rapprochement bancaire est réservé à certains rôles : son absence ne
      // doit pas priver un employé du reste du tableau.
      const [factures, devis, depots] = await Promise.all([
        api.get('/api/factures').catch(() => []),
        api.get('/api/devis').catch(() => []),
        api.get('/api/banque/transactions').catch(() => [])
      ]);
      if (annule) return;

      const aujourdhui = new Date().toISOString().split('T')[0];
      setAFaire({
        factures: factures.filter((f) => f.statut !== 'Annulée'
          && f.solde_restant > 0 && f.date_echeance < aujourdhui),
        devis: devis.filter((d) => d.statut !== 'Converti' && d.statut !== 'Refusé'),
        depots: depots
      });
    };

    charger();
    return () => { annule = true; };
  }, []);

  const taches = useMemo(() => [
    {
      cle: 'factures',
      nombre: aFaire.factures.length,
      libelle: (n) => tp(n, '{n} facture échue à relancer', '{n} factures échues à relancer'),
      vue: 'factures',
      parametres: { echuesSeulement: true }
    },
    {
      cle: 'devis',
      nombre: aFaire.devis.length,
      libelle: (n) => tp(n, '{n} devis en attente de réponse', '{n} devis en attente de réponse|pluriel'),
      vue: 'devis',
      parametres: null
    },
    {
      cle: 'depots',
      nombre: aFaire.depots.length,
      libelle: (n) => tp(n, '{n} dépôt bancaire à imputer', '{n} dépôts bancaires à imputer'),
      vue: 'banque',
      parametres: null
    }
  ].filter((tache) => tache.nombre > 0), [aFaire, tp]);

  if (loading) return <p style={{ color: 'var(--text-muted)' }}>{t('Chargement du tableau de bord…')}</p>;
  if (error) return <p className="alert alert-error" role="alert">{error}</p>;
  if (!stats) return null;

  // Chaque indicateur ouvre la liste correspondante : un chiffre inquiétant
  // sans moyen d'agir obligeait à retrouver soi-même les factures visées.
  //
  // Les trois teintes qui peignaient la bande à gauche de chaque carte ont été
  // retirées avec elle : trois couleurs alignées sur une même rangée faisaient
  // tableau de démonstration, et le contour gris suffit à délimiter la carte.
  //
  // Reste `alerte`, qui n'est pas une étiquette mais un signalement : un chiffre
  // ne prend une couleur que lorsqu'il annonce quelque chose, et redevient noir
  // le reste du temps. C'est déjà ainsi que la balance âgée traite ses créances
  // de plus de quatre-vingt-dix jours. À zéro, une carte au repos : c'est
  // l'information.
  const cartes = [
    {
      titre: t("Chiffre d'affaires encaissé"), valeur: stats.chiffreAffaires,
      vue: 'factures', parametres: { statutInitial: 'Payée' }, aide: t('Voir les factures réglées')
    },
    {
      titre: t('Montant en attente'), valeur: stats.facturesEnAttente,
      vue: 'factures', parametres: { statutInitial: 'En attente' }, aide: t('Voir les factures en attente')
    },
    {
      titre: t('Montant en retard'), valeur: stats.facturesEnRetard,
      alerte: stats.facturesEnRetard > 0,
      vue: 'factures', parametres: { echuesSeulement: true }, aide: t('Voir les factures échues')
    }
  ];

  const premiersPasVisibles = demarrage && !demarrage.masque && demarrage.etapes.some((e) => !e.fait);

  return (
    <div style={{ animation: 'fadeIn 0.5s ease-out' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '20px' }}>
        {/* L'action la plus fréquente était absente de l'écran d'accueil. */}
        <button type="button" className="btn-primary" onClick={() => naviguer('factures', { ouvrirNouvelle: true })}>
          {t('+ Nouvelle facture')}
        </button>
      </div>

      {premiersPasVisibles && (
        <PremiersPas demarrage={demarrage} onMasquer={masquerPremiersPas} naviguer={naviguer} />
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginBottom: '40px' }}>
        {cartes.map((carte) => (
          <button
            key={carte.titre}
            type="button"
            className="glass-card"
            onClick={() => naviguer(carte.vue, carte.parametres)}
            title={carte.aide}
            style={{
              padding: '24px', textAlign: 'left',
              cursor: 'pointer', font: 'inherit', width: '100%'
            }}
          >
            {/* Deux marques plutôt qu'une : une couleur seule ne signale rien à
                qui ne la distingue pas. Le triangle porte le mot, que la
                couleur ne peut pas dire. */}
            <p style={{
              margin: '0 0 8px 0', fontSize: '0.9rem', textTransform: 'uppercase', fontWeight: 'bold',
              color: carte.alerte ? 'var(--status-danger)' : 'var(--text-muted)',
              display: 'flex', alignItems: 'center', gap: '.4rem'
            }}>
              {carte.alerte && <TriangleAlert size={14} aria-label={t('En retard')} />}
              {carte.titre}
            </p>
            <h3 style={{
              margin: 0, fontSize: '2.3rem',
              color: carte.alerte ? 'var(--status-danger)' : 'var(--text-main)'
            }}>
              {montant(carte.valeur)}
            </h3>
          </button>
        ))}
      </div>

      {/* Ce qu'il reste à faire aujourd'hui. L'application est organisée par
          objet — Factures, Devis, Clients — et rien ne disait par quoi
          commencer. */}
      <div className="glass-card" style={{ padding: '32px', marginBottom: '40px' }}>
        <h3 style={{ margin: '0 0 20px 0', color: 'var(--text-main)', fontSize: '1.2rem' }}>{t('À faire')}</h3>
        {taches.length === 0 ? (
          <p className="empty-state">{t("Rien ne demande votre attention pour l'instant.")}</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {taches.map((tache) => (
              <li key={tache.cle}>
                <button
                  type="button"
                  onClick={() => naviguer(tache.vue, tache.parametres)}
                  style={{
                    width: '100%', textAlign: 'left', padding: '12px 16px', font: 'inherit',
                    background: 'var(--hover-subtle)', border: '1px solid var(--glass-border)',
                    borderRadius: '10px', color: 'var(--text-main)', cursor: 'pointer',
                    marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                  }}
                >
                  <span>{tache.libelle(tache.nombre)}</span>
                  <span aria-hidden="true" style={{ color: 'var(--text-muted)' }}>→</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="glass-card" style={{ padding: '32px' }}>
        {/* Les revenus sont regroupés par mois d'encaissement et non d'émission :
            c'est la trésorerie réellement entrée sur la période. */}
        <h3 style={{ margin: '0 0 20px 0', color: 'var(--text-main)', fontSize: '1.2rem' }}>{t('Encaissements par mois')}</h3>
        {stats.chartData && stats.chartData.length > 0 ? (
          <div style={{ height: '350px', width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-color)" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)' }} dx={-10} tickFormatter={(val) => t('{valeur} $', { valeur: val })} />
                <Tooltip
                  cursor={{ fill: 'var(--hover-subtle)' }}
                  contentStyle={{ borderRadius: '12px', border: '1px solid var(--glass-border)', background: 'var(--app-bg)', color: 'var(--text-main)' }}
                  formatter={(value) => [montant(value), t('Encaissé')]}
                />
                <Bar dataKey="revenu" fill="#0e4a9e" radius={[6, 6, 0, 0]} maxBarSize={60} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="empty-state">{t("Aucun encaissement enregistré pour l'instant.")}</p>
        )}
      </div>
    </div>
  );
}

export default Dashboard;
