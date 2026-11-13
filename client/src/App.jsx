import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import InvoiceList from './components/InvoiceList';
import ClientList from './components/ClientList';
import Settings from './components/Settings';
import DevisList from './components/DevisList';
import Login from './components/Login';
import Setup from './components/Setup';
import ChoixEntreprise from './components/ChoixEntreprise';
import Licence from './components/Licence';
import CatalogueList from './components/CatalogueList';
import ExpenseList from './components/ExpenseList';
import BankReconciliation from './components/BankReconciliation';
import SubscriptionList from './components/SubscriptionList';
import AuditLog from './components/AuditLog';
import { UserContext } from './UserContext';
import { useLangue } from './i18n.js';
import SelecteurLangue from './components/SelecteurLangue';
import VisiteGuidee from './components/VisiteGuidee';

// Ces deux écrans embarquent la bibliothèque de graphiques : ils sont chargés à
// la demande pour alléger le démarrage de l'application.
const Dashboard = lazy(() => import('./components/Dashboard'));
const ReportDashboard = lazy(() => import('./components/ReportDashboard'));
import { api } from './api';
import {
  LayoutDashboard,
  Receipt,
  FileSignature,
  Users,
  Package,
  BarChart3,
  Settings as SettingsIcon,
  Sun,
  Moon,
  LogOut,
  CreditCard,
  Landmark,
  Repeat,
  ScrollText,
  CircleHelp
} from 'lucide-react';

/**
 * Description de la navigation.
 *
 * Regrouper libellé, icône, en-tête et rôles autorisés en un seul endroit évite
 * que le menu, le titre de page et le rendu du contenu divergent : ils étaient
 * décrits par trois `switch` distincts qu'il fallait penser à modifier ensemble.
 * Les rôles ne servent qu'à masquer ce qui serait de toute façon refusé par le
 * serveur, seul garant des permissions.
 *
 * Les textes sont écrits en français et traduits à l'affichage : ce sont les
 * clés du dictionnaire.
 */
const VUES = [
  {
    id: 'dashboard',
    libelle: 'Tableau de bord',
    icone: LayoutDashboard,
    titre: 'Tableau de bord',
    sousTitre: 'Aperçu de vos performances financières',
    composant: Dashboard
  },
  {
    id: 'factures',
    libelle: 'Factures',
    icone: Receipt,
    titre: 'Factures',
    sousTitre: 'Gérez vos factures et suivez les paiements',
    composant: InvoiceList
  },
  {
    id: 'devis',
    libelle: 'Devis',
    icone: FileSignature,
    titre: 'Gestion des devis',
    sousTitre: 'Vos propositions commerciales',
    composant: DevisList
  },
  {
    id: 'clients',
    libelle: 'Clients',
    icone: Users,
    titre: 'Répertoire clients',
    sousTitre: 'Gérez vos contacts et entreprises',
    composant: ClientList
  },
  {
    id: 'catalogue',
    libelle: 'Catalogue',
    icone: Package,
    titre: 'Catalogue de services',
    sousTitre: 'Vos produits et services fréquents',
    composant: CatalogueList
  },
  {
    id: 'abonnements',
    libelle: 'Abonnements',
    icone: Repeat,
    titre: 'Facturation récurrente',
    sousTitre: 'Gestion des abonnements et factures automatiques',
    composant: SubscriptionList,
    roles: ['admin', 'comptable']
  },
  {
    id: 'banque',
    libelle: 'Banque',
    icone: Landmark,
    titre: 'Rapprochement bancaire',
    sousTitre: 'Importation et liaison des transactions',
    composant: BankReconciliation,
    roles: ['admin', 'comptable']
  },
  {
    id: 'depenses',
    libelle: 'Dépenses',
    icone: CreditCard,
    titre: 'Dépenses et achats',
    sousTitre: 'Suivez vos charges et taxes payées',
    composant: ExpenseList,
    roles: ['admin', 'comptable']
  },
  {
    id: 'rapports',
    libelle: 'Rapports',
    icone: BarChart3,
    titre: 'Rapports',
    sousTitre: 'Statistiques et performances financières',
    composant: ReportDashboard,
    roles: ['admin', 'comptable']
  },
  {
    id: 'audit',
    libelle: 'Journal',
    icone: ScrollText,
    titre: "Journal d'audit",
    sousTitre: 'Qui a fait quoi, et quand',
    composant: AuditLog,
    roles: ['admin', 'comptable']
  },
  {
    id: 'parametres',
    libelle: 'Paramètres',
    icone: SettingsIcon,
    titre: 'Paramètres',
    sousTitre: "Configuration de l'entreprise et des taxes",
    composant: Settings,
    roles: ['admin']
  }
];

/**
 * Étapes de la visite guidée, dans l'ordre de l'écran : d'abord où l'on est,
 * puis où aller, puis ce qui se règle. `cible` désigne l'attribut
 * `data-visite` de l'élément présenté ; sans cible, la bulle se centre.
 */
const VISITE = [
  {
    cible: null,
    titre: 'Bienvenue dans Clora',
    texte: "Quelques bulles pour vous montrer où se trouve chaque chose. Vous pouvez passer la visite à tout moment et la revoir plus tard."
  },
  {
    cible: 'dossier',
    titre: 'Le dossier ouvert',
    texte: "Le nom affiché ici est celui de l'entreprise dont vous tenez la comptabilité. Le lien en dessous mène à vos autres dossiers, ou en crée un nouveau."
  },
  {
    cible: 'menu',
    titre: 'Le menu',
    texte: 'Chaque écran de Clora est ici : factures, devis, clients, dépenses, rapports. Ce que votre rôle ne permet pas de faire n\'y figure pas.'
  },
  {
    cible: 'vue-factures',
    titre: 'Vos factures',
    texte: 'Créez une facture, envoyez-la par courriel, puis inscrivez les paiements reçus : son statut se met à jour de lui-même.'
  },
  {
    cible: 'premiers-pas',
    titre: 'Pour commencer',
    texte: "Cette liste suit l'ordre de votre profil et se coche d'elle-même. Chaque étape mène à l'écran où elle se fait."
  },
  {
    cible: 'vue-parametres',
    titre: 'Paramètres',
    texte: 'Votre entreprise, vos taxes, le paiement en ligne et les sauvegardes. Les premiers pas, une fois masqués, se rouvrent aussi depuis ici.'
  },
  {
    cible: 'compte',
    titre: 'Langue et compte',
    texte: 'Passez du français à l\'anglais à tout moment : la langue est retenue pour votre compte. Le mode sombre se règle en bas du menu.'
  },
  {
    cible: 'aide',
    titre: 'Revoir la visite',
    texte: 'Ce bouton relance cette visite quand vous le voulez.'
  }
];

const COULEUR_ROLE = { admin: '#10b981', comptable: '#3b82f6', employe: '#f59e0b' };

function App() {
  const [currentView, setCurrentView] = useState('dashboard');
  // Paramètres transmis à la vue ciblée : le tableau de bord ouvre la liste des
  // factures déjà filtrée, plutôt que d'afficher un chiffre sans issue.
  const [parametresVue, setParametresVue] = useState(null);
  const [user, setUser] = useState(null);
  const [majDisponible, setMajDisponible] = useState(null);
  // Dossiers accessibles et dossier ouvert. `ouvert` à null avec plusieurs
  // dossiers signifie qu'un choix reste à faire.
  const [entreprises, setEntreprises] = useState([]);
  const [ouvert, setOuvert] = useState(null);
  const [changementDossier, setChangementDossier] = useState(false);
  // État de la licence. `null` tant qu'il n'est pas connu : on n'affiche
  // surtout pas un écran de blocage avant d'avoir la réponse du serveur.
  const [licence, setLicence] = useState(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => localStorage.getItem('theme') === 'dark');
  const [visiteOuverte, setVisiteOuverte] = useState(false);
  const { t, changerLangue } = useLangue();

  const isAuthenticated = Boolean(user);

  const vuesVisibles = useMemo(
    () => VUES.filter((vue) => !vue.roles || (user && vue.roles.includes(user.role))),
    [user]
  );

  // Un employé qui atteindrait une vue restreinte est ramené au tableau de bord.
  const vueActive = vuesVisibles.find((v) => v.id === currentView) || vuesVisibles[0];

  // Vérification une fois par session, après connexion. Elle échoue en silence :
  // hors ligne ou derrière un pare-feu, l'application ne signale rien.
  useEffect(() => {
    if (!isAuthenticated || !ouvert) return undefined;

    let annule = false;
    api.get('/api/version')
      .then((info) => { if (!annule && info.disponible) setMajDisponible(info); })
      .catch(() => {});
    return () => { annule = true; };
  }, [isAuthenticated, ouvert]);

  // La visite se lance d'elle-même la première fois qu'un compte ouvre un
  // dossier, sur le tableau de bord. Le court délai laisse l'écran se dessiner
  // et la liste des premiers pas arriver : la visite la présente.
  const visiteAFaire = Boolean(user && ouvert && !changementDossier && user.visite_vue === false);
  useEffect(() => {
    if (!visiteAFaire) return undefined;
    const minuterie = setTimeout(() => setVisiteOuverte(true), 900);
    return () => clearTimeout(minuterie);
  }, [visiteAFaire]);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  useEffect(() => {
    const checkStatus = async () => {
      try {
        // La licence passe avant : un essai expiré bloque tout le reste, et
        // interroger l'état de configuration donnerait un 402 déroutant.
        const etatLicence = await api.get('/api/licence').catch(() => null);
        setLicence(etatLicence);
        if (etatLicence && etatLicence.utilisable === false) {
          setIsCheckingAuth(false);
          return;
        }

        const setupData = await api.get('/api/auth/setup-status');
        setSetupRequired(setupData.setupRequired);

        if (!setupData.setupRequired) {
          try {
            const authData = await api.get('/api/auth/check');
            if (authData.authenticated) {
              // La langue du compte l'emporte sur celle du poste.
              if (authData.langue) changerLangue(authData.langue);
              setUser({ username: authData.username, role: authData.role, visite_vue: authData.visite_vue });
              setEntreprises(authData.entreprises || []);
              setOuvert(authData.ouvert || null);
            }
          } catch {
            // 401 attendu tant que l'utilisateur n'est pas connecté.
          }
        }
      } catch (err) {
        console.error('Erreur lors de la vérification initiale', err);
      } finally {
        setIsCheckingAuth(false);
      }
    };
    checkStatus();
    // Une seule vérification, au démarrage. `changerLangue` est stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogout = async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      setUser(null);
      setVisiteOuverte(false);
      setCurrentView('dashboard');
    }
  };

  if (isCheckingAuth) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', color: 'var(--text-main)' }}>
        {t('Chargement…')}
      </div>
    );
  }

  // Avant Setup et Login : sans licence valable, il n'y a pas lieu de créer un
  // compte ni de se connecter.
  if (licence && licence.utilisable === false) {
    return (
      <Licence
        etat={licence}
        onActive={(nouvel) => { setLicence(nouvel); setIsCheckingAuth(true); window.location.reload(); }}
      />
    );
  }

  if (setupRequired) {
    return (
      <Setup
        onSetupComplete={({ entreprises: liste, ouvert: actif, ...compte }) => {
          setSetupRequired(false);
          setUser(compte);
          setEntreprises(liste || []);
          setOuvert(actif || null);
        }}
      />
    );
  }

  if (!isAuthenticated) {
    return (
      <Login
        onLogin={({ entreprises: liste, ouvert: actif, ...compte }) => {
          setUser(compte);
          setEntreprises(liste || []);
          setOuvert(actif || null);
        }}
      />
    );
  }

  /** Applique le dossier retourné par l'écran de choix. */
  const ouvrirDossier = (dossier) => {
    setOuvert(dossier);
    setUser((prev) => ({ ...prev, role: dossier.role }));
    setChangementDossier(false);
    setCurrentView('dashboard');
    // Les listes affichées appartiennent au dossier précédent : les laisser en
    // place ferait croire un instant que la comptabilité d'un client vient de
    // se déverser dans celle d'un autre.
    setParametresVue(null);

    // La liste est relue plutôt que devinée : un dossier qui vient d'être créé
    // n'y figure pas encore, et sans cela il resterait invisible jusqu'à la
    // prochaine connexion — y compris depuis l'écran censé le proposer.
    api.get('/api/entreprises')
      .then((r) => setEntreprises(r.entreprises || []))
      .catch(() => {});
  };

  /** Un dossier renommé, ici ou dans Paramètres : la liste et l'en-tête suivent. */
  const renommerDossier = ({ id, nom }) => {
    setEntreprises((liste) => liste.map((e) => (e.id === id ? { ...e, nom } : e)));
    setOuvert((actuel) => (actuel && actuel.id === id ? { ...actuel, nom } : actuel));
  };

  // Aucun dossier ouvert, ou bascule demandée : le choix passe avant tout le
  // reste. Une facture saisie dans le mauvais dossier se répare mal.
  if (!ouvert || changementDossier) {
    return (
      <ChoixEntreprise
        entreprises={entreprises}
        ouvertId={ouvert ? ouvert.id : null}
        onOuvert={ouvrirDossier}
        onListe={(liste) => {
          setEntreprises(liste);
          // Le dossier ouvert a pu être renommé depuis cet écran.
          setOuvert((actuel) => {
            const trouve = actuel && liste.find((e) => e.id === actuel.id);
            return trouve ? { ...actuel, nom: trouve.nom } : actuel;
          });
        }}
        onAnnuler={changementDossier ? () => setChangementDossier(false) : null}
      />
    );
  }

  const ContenuActif = vueActive.composant;

  /**
   * Fin de la visite, terminée ou passée. Elle est retenue pour le compte dans
   * les deux cas : qui l'a passée l'a choisi, et le bouton de l'en-tête la
   * rouvre.
   */
  const fermerVisite = () => {
    setVisiteOuverte(false);
    if (user.visite_vue === false) {
      setUser((prev) => ({ ...prev, visite_vue: true }));
      api.put('/api/auth/visite', {}).catch(() => {});
    }
  };

  const relancerVisite = () => {
    setCurrentView('dashboard');
    setParametresVue(null);
    // Le tableau de bord doit être à l'écran avant que la visite ne cherche
    // ses éléments.
    setTimeout(() => setVisiteOuverte(true), 300);
  };

  /** Change de vue, en lui passant éventuellement un état initial. */
  const naviguer = (id, parametres = null) => {
    setCurrentView(id);
    setParametresVue(parametres);
  };

  return (
    <UserContext.Provider value={user}>
      {/* Arrière-plan animé */}
      <div className="aurora-bg-container" aria-hidden="true">
        <div className="aurora-blob aurora-blob-1"></div>
        <div className="aurora-blob aurora-blob-2"></div>
        <div className="aurora-blob aurora-blob-3"></div>
      </div>

      <div style={{ display: 'flex', height: '100vh', backgroundColor: 'transparent', color: 'var(--text-main)' }}>
        <aside className="glass-panel" style={{ width: '260px', margin: '20px', padding: '32px 20px', display: 'flex', flexDirection: 'column', zIndex: 10, minHeight: 0 }}>
          {/* Le logotype écrit déjà « CLORA » : le doubler d'un titre textuel
              affichait le nom deux fois, et l'écraser dans une vignette carrée
              le rendait illisible. Il s'affiche donc à sa proportion propre. */}
          <div style={{ marginBottom: '40px', padding: '0 8px' }}>
            <h1 style={{ margin: 0, fontSize: 0, lineHeight: 0 }}>
              {/* Le logotype est en bleu marine : sur le panneau sombre il
                  disparaîtrait. Une variante éclaircie prend le relais. */}
              <img
                src={isDarkMode ? '/images/logotype-sombre.png' : '/images/logotype.png'}
                alt="Clora"
                style={{ width: '100%', height: 'auto', display: 'block' }}
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            </h1>
          </div>

          {/* Le dossier ouvert, affiché en permanence.

              C'est le repère le plus important d'un logiciel multi-dossier :
              saisir une facture chez le mauvais client se répare mal, et
              l'ambiguïté sur « chez qui suis-je » est le premier risque. Le
              bouton n'apparaît que s'il y a réellement ailleurs où aller. */}
          <div data-visite="dossier" style={{ marginBottom: '24px', padding: '0 8px' }}>
            <p style={{ margin: 0, fontSize: '.7rem', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              {t('Dossier')}
            </p>
            <p style={{ margin: '.15rem 0 0', fontWeight: 600, lineHeight: 1.3 }}>
              {ouvert.nom}
            </p>
            {/* Toujours affiché, même avec un seul dossier : c'est le seul
                chemin pour en créer un second. Le conditionner au nombre de
                dossiers existants enfermait l'utilisateur dans une boucle — le
                bouton de création vivant dans l'écran auquel ce bouton mène. */}
            <button
              type="button"
              onClick={() => setChangementDossier(true)}
              style={{
                marginTop: '.35rem', padding: 0, background: 'none', border: 'none',
                color: 'var(--safehill-teal)', cursor: 'pointer', font: 'inherit', fontSize: '.8rem'
              }}
            >
              {entreprises.length > 1 ? t('Changer de dossier') : t('Ajouter une entreprise')}
            </button>
          </div>

          {/* Des <button> et non des <div> : la navigation était inatteignable
              au clavier et invisible pour un lecteur d'écran. */}
          {/* La liste défile quand la fenêtre est trop basse pour elle : à la
              taille d'ouverture, elle poussait « Se déconnecter » sous le bas
              du panneau, hors d'atteinte. */}
          <nav data-visite="menu" aria-label={t('Navigation principale')} style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
            {vuesVisibles.map((vue) => {
              const Icone = vue.icone;
              return (
                <button
                  key={vue.id}
                  type="button"
                  className="nav-item"
                  data-visite={`vue-${vue.id}`}
                  aria-current={vueActive.id === vue.id ? 'page' : undefined}
                  onClick={() => naviguer(vue.id)}
                >
                  <Icone size={20} aria-hidden="true" /> {t(vue.libelle)}
                </button>
              );
            })}
          </nav>

          <div style={{ marginTop: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="btn-secondary"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '100%' }}
            >
              {isDarkMode ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
              {isDarkMode ? t('Mode clair') : t('Mode sombre')}
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="btn-secondary"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '100%' }}
            >
              <LogOut size={18} aria-hidden="true" />
              {t('Se déconnecter')}
            </button>
          </div>
        </aside>

        <main style={{ flex: 1, padding: '20px 40px 20px 20px', overflowY: 'auto' }}>
          <header style={{ marginBottom: '40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '20px' }}>
            <div>
              <h2 style={{ fontSize: '2.2rem', fontWeight: '700', color: 'var(--text-main)', marginBottom: '4px' }}>{t(vueActive.titre)}</h2>
              <p style={{ color: 'var(--text-muted)', margin: 0 }}>{t(vueActive.sousTitre)}</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              type="button"
              className="btn-secondary"
              data-visite="aide"
              onClick={relancerVisite}
              aria-label={t('Visite guidée')}
              title={t('Visite guidée')}
              style={{ display: 'inline-flex', alignItems: 'center', padding: '8px' }}
            >
              <CircleHelp size={18} aria-hidden="true" />
            </button>
            <div data-visite="compte" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <SelecteurLangue enregistrer />
            <div style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', padding: '8px 20px', borderRadius: '30px', fontSize: '0.95rem', fontWeight: '600', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}>
              <span aria-hidden="true" style={{ width: '8px', height: '8px', borderRadius: '50%', background: COULEUR_ROLE[user.role] || '#94a3b8' }}></span>
              {`${user.username} (${t(user.role)})`}
            </div>
            </div>
            </div>
          </header>

          {majDisponible && (
            <div
              className="alert alert-info"
              role="status"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}
            >
              <span>
                {t('Clora {derniere} est disponible. Vous utilisez la {courante}.', {
                  derniere: majDisponible.derniere, courante: majDisponible.courante
                })}
              </span>
              <span style={{ display: 'flex', gap: '12px', whiteSpace: 'nowrap' }}>
                {/* Le lien s'ouvre dans le navigateur du système : rien n'est
                    téléchargé ni installé par l'application elle-même. */}
                <a href={majDisponible.page} target="_blank" rel="noreferrer">{t('Voir la version')}</a>
                <button
                  type="button"
                  onClick={() => setMajDisponible(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0 }}
                  aria-label={t("Masquer l'avis de mise à jour")}
                >
                  ✕
                </button>
              </span>
            </div>
          )}

          <div style={{ position: 'relative', zIndex: 10 }}>
            <Suspense fallback={<p style={{ color: 'var(--text-muted)' }}>{t('Chargement…')}</p>}>
              <ContenuActif naviguer={naviguer} renommerDossier={renommerDossier} {...(parametresVue || {})} />
            </Suspense>
          </div>
        </main>
      </div>
      {visiteOuverte && <VisiteGuidee etapes={VISITE} onFermer={fermerVisite} />}
    </UserContext.Provider>
  );
}

export default App;
