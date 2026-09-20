import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { TriangleAlert } from 'lucide-react';
import { PieChart, Pie, Cell, Legend, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import InfoTooltip from './InfoTooltip';
import { api, formatMontant } from '../api';
import { libellePeriode } from '../periodes';

// Le document n'est chargé qu'à la demande : la plupart des visites de l'écran
// Rapports n'en produisent pas.
const RapportSommaire = lazy(() => import('./RapportSommaire'));

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

/**
 * Nom de client sur l'axe du graphique, en une seule ligne.
 *
 * Laissé à `recharts`, le nom était replié sur deux lignes dès qu'il dépassait
 * la largeur de l'axe, et les deux lignes se serraient contre la barre. Une
 * ligne coupée se lit mieux que deux lignes tassées, et l'infobulle de la barre
 * donne le nom entier.
 */
const LONGUEUR_NOM = 18;

/** Part en deçà de laquelle l'étiquette est omise : elle n'a pas la place. */
const PART_MINIMALE = 0.08;

/**
 * Pourcentage posé au bord d'une part de camembert.
 *
 * Écrit par `recharts`, il héritait de la couleur de sa part : l'ambre de
 * « Partiellement payée » tombait à 2,09:1 sur un panneau clair, très en
 * dessous du seuil de 4,5:1 exigé du texte courant. La couleur reste dans
 * l'arc et dans le carré de la légende, où elle est la clé de lecture ; le
 * chiffre prend la couleur du texte.
 */
function EtiquettePart({ cx, cy, midAngle, outerRadius, percent }) {
  if (percent < PART_MINIMALE) return null;

  const rayon = outerRadius + 18;
  const angle = -midAngle * (Math.PI / 180);
  const x = cx + rayon * Math.cos(angle);
  const y = cy + rayon * Math.sin(angle);

  return (
    <text
      x={x} y={y} textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central"
      style={{ fill: 'var(--text-main)', fontSize: '0.8rem' }}
    >
      {`${(percent * 100).toFixed(0)} %`}
    </text>
  );
}

function TickClient({ x, y, payload }) {
  const nom = String(payload.value ?? '');
  return (
    <text
      x={x - 8} y={y} dy={4} textAnchor="end"
      style={{ fill: 'var(--text-main)', fontSize: '0.78rem' }}
    >
      {nom.length > LONGUEUR_NOM ? `${nom.slice(0, LONGUEUR_NOM - 1)}…` : nom}
    </text>
  );
}

/**
 * Carte d'indicateur.
 *
 * Ni bande ni chiffre de couleur pour étiqueter. La bande est partie avec celles
 * des autres écrans ; la couleur du chiffre l'a suivie, pour la même raison :
 * cinq teintes alignées sur une rangée ne distinguaient pas cinq indicateurs,
 * elles faisaient tableau de démonstration. Le titre nomme déjà l'indicateur, et
 * le contour gris des panneaux délimite la carte.
 *
 * `alerte` est l'autre usage de la couleur, celui qui reste : un chiffre ne
 * prend le rouge que lorsqu'il annonce quelque chose. Le triangle l'accompagne
 * toujours, car une couleur seule ne signale rien à qui ne la distingue pas.
 */
function Carte({ titre, valeur, aide, alerte = false }) {
  return (
    <div className="glass-card">
      <p style={{
        margin: '0 0 10px 0', fontWeight: '500', textTransform: 'uppercase', fontSize: '0.85rem',
        color: alerte ? 'var(--status-danger)' : 'var(--text-muted)',
        display: 'flex', alignItems: 'center', gap: '.4rem'
      }}>
        {alerte && <TriangleAlert size={14} aria-label="Perte" />}
        {titre}{aide && <InfoTooltip text={aide} />}
      </p>
      <h3 style={{
        margin: 0, fontSize: '1.9rem',
        color: alerte ? 'var(--status-danger)' : 'var(--text-main)'
      }}>
        {valeur}
      </h3>
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
  const [sommaireOuvert, setSommaireOuvert] = useState(false);

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

  /** Les registres suivent la période choisie en tête de page. */
  const lienExport = (registre) => {
    const params = new URLSearchParams();
    if (annee) params.set('annee', annee);
    if (mois) params.set('mois', mois);
    else if (trimestre) params.set('trimestre', trimestre);
    return `/api/rapports/export/${registre}?${params.toString()}`;
  };

  const periode = { annee, mois, trimestre };

  return (
    <div>
      <div className="toolbar">
        <h2 style={{ color: 'var(--text-main)', margin: 0 }}>Vue d'ensemble financière</h2>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', background: 'var(--glass-bg)', padding: '6px 12px', borderRadius: '15px', border: '1px solid var(--glass-border)' }}>
          {/* Le drapeau qui ouvrait cette phrase était une paire d'indicateurs
              régionaux, que Windows ne compose pas : les testeurs voyaient deux
              lettres encadrées. La phrase nomme la devise, cela suffit. */}
          Tous les montants sont consolidés en dollars canadiens
        </span>
      </div>

      {/* Une seule période pour toute la page : le compte rendu, les registres
          et le rapport de taxes portent sur les mêmes bornes, et se recoupent. */}
      <div className="glass-panel" style={{ padding: '20px', marginTop: '25px' }}>
        <div className="toolbar">
          <div>
            <h3 style={{ margin: 0, color: 'var(--text-main)' }}>
              Compte rendu de la période
              <InfoTooltip text="Un sommaire de gestion en PDF : facturé, encaissé, dépenses, bénéfice, créances, clients et taxes de la période. À remettre à votre comptable ou à votre banquier." />
            </h3>
            <p style={{ margin: '6px 0 0 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              Choisissez un mois, un trimestre ou l'année entière. La période retenue s'applique
              aussi aux registres et au rapport de taxes ci-dessous.
            </p>
          </div>
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
              <option value="1">T1 : janv. à mars</option>
              <option value="2">T2 : avr. à juin</option>
              <option value="3">T3 : juill. à sept.</option>
              <option value="4">T4 : oct. à déc.</option>
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
            <button type="button" className="btn-primary" onClick={() => setSommaireOuvert(true)}>
              Produire le compte rendu
            </button>
          </div>
        </div>
      </div>

      {sommaireOuvert && (
        <Suspense fallback={null}>
          <RapportSommaire periode={periode} onClose={() => setSommaireOuvert(false)} />
        </Suspense>
      )}

      {balance && balance.clients.length > 0 && (
        <div className="glass-panel" style={{ padding: '25px', marginTop: '30px' }}>
          <div className="toolbar">
            <div>
              <h3 style={{ margin: 0, color: 'var(--text-main)' }}>
                Balance âgée
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
                        {c[t.cle] > 0 ? formatMontant(c[t.cle]) : '-'}
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
            <h3 style={{ margin: 0, color: 'var(--text-main)' }}>Registres pour votre comptable</h3>
            <p style={{ margin: '6px 0 0 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              Fichiers CSV directement lisibles dans Excel, à transmettre au logiciel comptable
              (Acomba, Sage, QuickBooks) pour la fin d'année. Période : {libellePeriode(periode)}.
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

      {/* La rangée d'indicateurs était le seul bloc de la page sans marge
          haute : elle se collait au panneau des registres. Quarante pixels,
          comme les trois blocs qui suivent. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '20px', marginTop: '40px' }}>
        <Carte titre="Total facturé" valeur={formatMontant(stats.revenu_total)} />
        <Carte titre="Total encaissé" valeur={formatMontant(stats.total_encaisse)} />
        <Carte
          titre="Dépenses hors taxes"
          valeur={formatMontant(stats.total_depenses_ht)}
          aide="Le montant de vos achats avant taxes. C'est cette valeur qui constitue une charge : les taxes payées sont récupérables."
        />
        {/* Le violet ne distinguait pas un bénéfice d'une perte. La seconde
            marque est déjà là, et gratuite : en français canadien, `Intl` écrit
            un montant négatif avec son signe. */}
        <Carte
          titre="Bénéfice net"
          valeur={formatMontant(beneficeNet)}
          alerte={beneficeNet < 0}
          aide="Total encaissé moins les dépenses hors taxes."
        />
        <Carte titre="Reste à percevoir" valeur={formatMontant(stats.solde_a_percevoir)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '20px', marginTop: '40px' }}>
        <div className="glass-panel" style={{ padding: '20px' }}>
          <h3 style={{ marginTop: 0, color: 'var(--text-main)' }}>Répartition des statuts</h3>
          {stats.statusDistribution && stats.statusDistribution.length > 0 ? (
            <div style={{ width: '100%', height: 300 }}>
              <ResponsiveContainer>
                <PieChart>
                  {/* Le nom du statut était écrit au bout d'une ligne de rappel,
                      hors du camembert : « Partiellement payée » dépassait du
                      panneau et se lisait coupé. Le pourcentage tient dans
                      l'arc, où sa largeur est bornée, et les noms descendent
                      dans la légende, qui a celle du panneau. */}
                  <Pie
                    data={stats.statusDistribution}
                    cx="50%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={5}
                    dataKey="value"
                    labelLine={false}
                    label={EtiquettePart}
                  >
                    {stats.statusDistribution.map((entry, index) => (
                      <Cell key={entry.name} fill={COULEURS_STATUT[entry.name] || COULEURS_DEFAUT[index % COULEURS_DEFAUT.length]} />
                    ))}
                  </Pie>
                  {/* Le carré garde la couleur du statut, qui est la clé de
                      lecture du camembert ; le libellé prend celle du texte.
                      Laissés à `recharts`, les libellés héritaient de la
                      couleur de leur part : « Partiellement payée » en ambre
                      sur un panneau clair tombait à 2,09:1, sous le seuil de
                      4,5:1 exigé du texte courant. */}
                  <Legend
                    verticalAlign="bottom" height={36}
                    wrapperStyle={{ fontSize: '0.85rem' }}
                    formatter={(valeur) => <span style={{ color: 'var(--text-main)' }}>{valeur}</span>}
                  />
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
                <BarChart data={stats.topClients} layout="vertical" margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                  <XAxis type="number" stroke="var(--text-muted)" />
                  {/* Cent dix pixels ne suffisaient pas à un nom d'entreprise :
                      il chevauchait le départ de sa barre. La largeur seule ne
                      tiendrait pas non plus, un nom pouvant être long sans
                      limite : elle est accompagnée d'une coupe. */}
                  <YAxis
                    dataKey="name" type="category" stroke="var(--text-muted)" width={150}
                    tick={<TickClient />}
                  />
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
          {/* Le titre en rouge et le contour rouge du panneau signalent déjà :
              l'émoji d'avertissement n'ajoutait rien qu'une couleur que nous
              ne dessinons pas. */}
          <h3 style={{ margin: '0 0 15px 0', color: 'var(--status-danger)' }}>
            Alertes de trésorerie : factures en retard
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {stats.lateInvoices.map((invoice) => (
              <div key={invoice.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '20px', padding: '15px', background: 'var(--status-danger-bg)', borderRadius: '8px' }}>
                <div>
                  <strong style={{ color: 'var(--text-main)' }}>{invoice.numero_facture}</strong>, {invoice.client}
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
            Rapport de taxes
            <InfoTooltip text="CTI / RTI : crédit ou remboursement de la taxe sur les intrants. Vous récupérez les taxes payées sur vos achats." />
          </h3>
          {/* La période se choisit en tête de page, pour toute la page. */}
          <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>{libellePeriode(periode)}</span>
        </div>

        {taxStats ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '20px', marginBottom: '25px' }}>
              <div style={{ padding: '15px', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: '8px' }}>
                <p style={{ margin: '0 0 5px 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Taxes facturées</p>
                <h4 style={{ margin: 0, fontSize: '1.4rem', color: 'var(--text-main)' }}>{formatMontant(taxStats.taxes_facturees)}</h4>
              </div>
              <div style={{ padding: '15px', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: '8px' }}>
                <p style={{ margin: '0 0 5px 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Taxes payées (CTI)
                  <InfoTooltip text="La somme des taxes payées sur vos dépenses de la période." />
                </p>
                <h4 style={{ margin: 0, fontSize: '1.4rem', color: 'var(--text-main)' }}>{formatMontant(taxStats.taxes_payees)}</h4>
              </div>
              <div style={{ padding: '15px', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: '8px' }}>
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
