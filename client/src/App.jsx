import React, { useState, useEffect } from 'react';
import InvoiceList from './components/InvoiceList';
import ClientList from './components/ClientList';
import ReportDashboard from './components/ReportDashboard';
import Settings from './components/Settings';
import DevisList from './components/DevisList';
import Login from './components/Login';
import Setup from './components/Setup';
import CatalogueList from './components/CatalogueList';
import Dashboard from './components/Dashboard';
import ExpenseList from './components/ExpenseList';
import BankReconciliation from './components/BankReconciliation';
import SubscriptionList from './components/SubscriptionList';
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
  Repeat
} from 'lucide-react';
function App() {
  const [currentView, setCurrentView] = useState('dashboard');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => localStorage.getItem('theme') === 'dark');

  const getNavStyle = (view) => {
    const baseStyle = { display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 15px', textDecoration: 'none', cursor: 'pointer', borderRadius: '10px' };
    if (currentView === view) {
      return { ...baseStyle, color: 'var(--text-main)', fontWeight: '600', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' };
    }
    return { ...baseStyle, color: 'var(--text-muted)', fontWeight: '500', transition: 'color 0.2s', border: '1px solid transparent' };
  };

  const renderContent = () => {
    switch (currentView) {
      case 'dashboard': return <Dashboard />;
      case 'factures': return <InvoiceList />;
      case 'devis': return <DevisList />;
      case 'clients': return <ClientList />;
      case 'catalogue': return <CatalogueList />;
      case 'depenses': return <ExpenseList />;
      case 'rapports': return <ReportDashboard />;
      case 'parametres': return <Settings />;
      case 'banque': return <BankReconciliation />;
      case 'abonnements': return <SubscriptionList />;
      default: return <InvoiceList />;
    }
  };

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
        const setupRes = await fetch('/api/auth/setup-status');
        if (setupRes.ok) {
          const setupData = await setupRes.json();
          setSetupRequired(setupData.setupRequired);
          
          if (!setupData.setupRequired) {
            const authRes = await fetch('/api/auth/check');
            if (authRes.ok) {
              const authData = await authRes.json();
              setIsAuthenticated(authData.authenticated);
              if (authData.authenticated) {
                setUser({ username: authData.username, role: authData.role });
              }
            }
          }
        }
      } catch (err) {
        console.error('Erreur lors de la vérification initiale', err);
      } finally {
        setIsCheckingAuth(false);
      }
    };
    checkStatus();
  }, []);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setIsAuthenticated(false);
  };

  const getHeaderTitle = () => {
    switch (currentView) {
      case 'dashboard': return { title: 'Tableau de bord', subtitle: "Aperçu de vos performances financières" };
      case 'factures': return { title: 'Factures', subtitle: "Gérez vos factures et suivez les paiements" };
      case 'devis': return { title: 'Gestion des devis', subtitle: "Vos propositions commerciales" };
      case 'clients': return { title: 'Répertoire Clients', subtitle: "Gérez vos contacts et entreprises" };
      case 'catalogue': return { title: 'Catalogue de Services', subtitle: "Vos produits et services fréquents" };
      case 'depenses': return { title: 'Dépenses & Achats', subtitle: "Suivez vos charges et taxes payées" };
      case 'rapports': return { title: 'Tableau de Bord', subtitle: "Statistiques et performances financières" };
      case 'parametres': return { title: 'Paramètres', subtitle: "Configuration de l'entreprise et des taxes" };
      case 'banque': return { title: 'Rapprochement Bancaire', subtitle: "Importation et liaison des transactions" };
      case 'abonnements': return { title: 'Facturation Récurrente', subtitle: "Gestion des abonnements et factures automatiques" };
      default: return { title: '', subtitle: '' };
    }
  };

  const headerInfo = getHeaderTitle();

  if (isCheckingAuth) {
    return <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', color: 'var(--text-main)' }}>Chargement...</div>;
  }

  if (setupRequired) {
    return <Setup onSetupComplete={() => { setSetupRequired(false); setIsAuthenticated(true); }} />;
  }

  if (!isAuthenticated) {
    return <Login onLogin={() => setIsAuthenticated(true)} />;
  }

  return (
    <>
      {/* Arrière-plan animé Light Aurora */}
      <div className="aurora-bg-container">
        <div className="aurora-blob aurora-blob-1"></div>
        <div className="aurora-blob aurora-blob-2"></div>
        <div className="aurora-blob aurora-blob-3"></div>
      </div>

      <div style={{ display: 'flex', height: '100vh', backgroundColor: 'transparent', color: 'var(--text-main)', fontFamily: 'Inter, sans-serif' }}>
        
        {/* Sidebar Navigation (Flottante en verre) */}
        <aside className="glass-panel" style={{ width: '260px', margin: '20px', padding: '30px 20px', display: 'flex', flexDirection: 'column', zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '40px', justifyContent: 'center' }}>
          <img 
            src="/images/logo.png" 
            alt="Safehill Logo" 
            style={{ width: '64px', height: '64px', objectFit: 'contain', backgroundColor: 'white', padding: '6px', borderRadius: '12px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }} 
            onError={(e) => { 
              e.target.style.display = 'none'; 
              e.target.nextSibling.style.display = 'flex'; 
            }} 
          />
          <div style={{ display: 'none', width: '36px', height: '36px', background: 'var(--gradient-brand)', borderRadius: '10px', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '1.2rem', color: 'white', boxShadow: '0 4px 10px rgba(0, 196, 180, 0.3)' }}>
            C
          </div>
          <h1 style={{ fontSize: '1.5rem', margin: 0, fontWeight: '800' }}>
            <span className="gradient-text">Clora</span>
          </h1>
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div onClick={() => setCurrentView('dashboard')} style={getNavStyle('dashboard')}>
            <LayoutDashboard size={20} /> Tableau de bord
          </div>
          <div onClick={() => setCurrentView('factures')} style={getNavStyle('factures')}>
            <Receipt size={20} /> Factures
          </div>
          <div onClick={() => setCurrentView('devis')} style={getNavStyle('devis')}>
            <FileSignature size={20} /> Devis
          </div>
          <div onClick={() => setCurrentView('clients')} style={getNavStyle('clients')}>
            <Users size={20} /> Clients
          </div>
          <div onClick={() => setCurrentView('catalogue')} style={getNavStyle('catalogue')}>
            <Package size={20} /> Catalogue
          </div>
          {user && user.role !== 'employe' && (
            <div onClick={() => setCurrentView('abonnements')} style={getNavStyle('abonnements')}>
              <Repeat size={20} /> Abonnements
            </div>
          )}
          {user && user.role !== 'employe' && (
            <div onClick={() => setCurrentView('banque')} style={getNavStyle('banque')}>
              <Landmark size={20} /> Banque
            </div>
          )}
          {user && user.role !== 'employe' && (
            <div onClick={() => setCurrentView('depenses')} style={getNavStyle('depenses')}>
              <CreditCard size={20} /> Dépenses
            </div>
          )}
          {user && user.role !== 'employe' && (
            <div onClick={() => setCurrentView('rapports')} style={getNavStyle('rapports')}>
              <BarChart3 size={20} /> Rapports
            </div>
          )}
          {user && user.role === 'admin' && (
            <div onClick={() => setCurrentView('parametres')} style={getNavStyle('parametres')}>
              <SettingsIcon size={20} /> Paramètres
            </div>
          )}
        </nav>
        <div style={{ marginTop: 'auto', padding: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button onClick={() => setIsDarkMode(!isDarkMode)} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '100%', borderColor: 'transparent', color: 'var(--text-muted)', background: 'var(--glass-card-bg)' }}>
            {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
            {isDarkMode ? 'Mode Clair' : 'Mode Sombre'}
          </button>
          <button onClick={handleLogout} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '100%', borderColor: 'transparent', color: 'var(--text-muted)' }}>
            <LogOut size={18} />
            Quitter
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main style={{ flex: 1, padding: '20px 40px 20px 20px', overflowY: 'auto' }}>
        <header style={{ marginBottom: '40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '2.2rem', fontWeight: '700', color: 'var(--text-main)', marginBottom: '5px' }}>{headerInfo.title}</h2>
            <p style={{ color: 'var(--text-muted)', margin: 0 }}>{headerInfo.subtitle}</p>
          </div>
          <div style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', padding: '10px 20px', borderRadius: '30px', fontSize: '0.95rem', fontWeight: '600', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: user?.role === 'admin' ? '#10b981' : (user?.role === 'comptable' ? '#3b82f6' : '#f59e0b') }}></span>
            {user ? `${user.username} (${user.role})` : 'Profil'}
          </div>
        </header>

        {/* Contenu dynamique basé sur currentView */}
        <div style={{ position: 'relative', zIndex: 10 }}>
          {renderContent()}
        </div>
      </main>
    </div>
    </>
  );
}

export default App;
