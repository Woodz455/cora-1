import { useState, useEffect } from 'react';
import { Pencil } from 'lucide-react';
import { api, CONDITIONS } from '../api';
import { useUser } from '../UserContext';
import { useFeedback } from '../FeedbackContext';
import { PROFILS } from '../profils';
import { useLangue } from '../i18n.js';

const TAILLE_MAX_LOGO = 2 * 1024 * 1024;

const ROLES = [
  { valeur: 'employe', libelle: 'Employé : factures, devis, clients, catalogue' },
  { valeur: 'comptable', libelle: 'Comptable : encaissements, dépenses, rapports, banque' },
  { valeur: 'admin', libelle: 'Administrateur : accès complet' }
];

// Les fonds étaient écrits en dur : ils ne suivaient pas le thème sombre, où
// les teintes de statut sont éclaircies.
const COULEURS_ROLE = {
  admin: { fond: 'var(--status-paid-bg)', texte: 'var(--status-paid)' },
  comptable: { fond: 'var(--status-pending-bg)', texte: 'var(--status-pending)' },
  employe: { fond: 'var(--status-partial-bg)', texte: 'var(--status-partial)' }
};

/**
 * Message d'état. Le type est passé explicitement plutôt que deviné à partir du
 * texte : la version précédente cherchait le mot « Erreur » dans le message et
 * affichait en vert tout échec formulé autrement.
 */
function Message({ contenu }) {
  if (!contenu) return null;
  const estErreur = contenu.type === 'error';
  return (
    <p className={`alert alert-${estErreur ? 'error' : 'success'}`} role={estErreur ? 'alert' : 'status'}>
      {contenu.texte}
    </p>
  );
}

function Settings({ ancre }) {
  const utilisateurCourant = useUser();
  const { notifier, confirmer } = useFeedback();
  const { langue, t, tp, montant: formatMontant } = useLangue();
  const locale = langue === 'en' ? 'en-CA' : 'fr-CA';

  const [settings, setSettings] = useState({
    entreprise_nom: '', entreprise_adresse: '', entreprise_email: '',
    taxe_1_nom: '', taxe_1_taux: 0, taxe_1_numero: '',
    taxe_2_nom: '', taxe_2_taux: 0, taxe_2_numero: '',
    payment_instructions: '', payment_instructions_en: '', entreprise_logo: '',
    relances_actives: 0, relances_paliers: '7,15,30',
    sauvegarde_active: 1, sauvegarde_dossier: '', sauvegarde_retention: 30,
    verifier_maj: 1,
    smtp_host: '', smtp_port: '', smtp_user: '', smtp_pass_defini: false,
    stripe_actif: 0, stripe_cle_definie: false, stripe_mode: ''
  });
  // Le mot de passe d'envoi n'entre jamais dans `settings` : l'API ne le renvoie
  // pas, et l'y mêler ferait réenregistrer une valeur vide à chaque sauvegarde.
  const [motDePasseSmtp, setMotDePasseSmtp] = useState('');
  const [testEnCours, setTestEnCours] = useState(false);
  const [testMessage, setTestMessage] = useState(null);

  // Même régime pour la clé Stripe, pour la même raison.
  const [cleStripe, setCleStripe] = useState('');
  const [testStripeEnCours, setTestStripeEnCours] = useState(false);
  const [testStripeMessage, setTestStripeMessage] = useState(null);
  const [releveEnCours, setReleveEnCours] = useState(false);
  const [enSouffrance, setEnSouffrance] = useState([]);

  const [licence, setLicence] = useState(null);
  const [tauxKm, setTauxKm] = useState([]);
  // Aucune valeur n'est proposée d'office : l'ARC révise ces taux chaque année,
  // et un chiffre inscrit ici par le logiciel serait pris pour argent comptant
  // longtemps après avoir cessé d'être exact.
  const [nouveauTaux, setNouveauTaux] = useState({
    annee: new Date().getFullYear(), taux_1: '', taux_2: '', seuil_km: 5000
  });
  const [savingTaux, setSavingTaux] = useState(false);
  const [tauxMessage, setTauxMessage] = useState(null);
  const [infoSauvegardes, setInfoSauvegardes] = useState(null);
  const [sauvegardeEnCours, setSauvegardeEnCours] = useState(false);
  const [relancesDues, setRelancesDues] = useState(null);
  const [relanceMessage, setRelanceMessage] = useState(null); // { texte, erreur }
  const [relanceEnCours, setRelanceEnCours] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const [securityData, setSecurityData] = useState({ currentPassword: '', newUsername: '', newPassword: '' });
  const [savingSec, setSavingSec] = useState(false);
  const [secMessage, setSecMessage] = useState(null);

  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'employe' });
  const [usersMessage, setUsersMessage] = useState(null);
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [minLength, setMinLength] = useState(8);

  useEffect(() => {
    api.get('/api/settings')
      .then((data) => setSettings((prev) => ({ ...prev, ...data })))
      .catch((err) => setMessage({ type: 'error', texte: err.message }))
      .finally(() => setLoading(false));

    api.get('/api/users').then(setUsers).catch(() => setUsers([]));
    api.get('/api/relances/dues').then(setRelancesDues).catch(() => setRelancesDues(null));
    api.get('/api/sauvegardes').then(setInfoSauvegardes).catch(() => setInfoSauvegardes(null));
    api.get('/api/paiements-en-ligne/en-souffrance')
      .then((r) => setEnSouffrance(r.encaissements || []))
      .catch(() => setEnSouffrance([]));
    api.get('/api/licence').then(setLicence).catch(() => setLicence(null));
    api.get('/api/settings/taux-kilometriques').then(setTauxKm).catch(() => setTauxKm([]));
    api.get('/api/auth/setup-status')
      .then((data) => { if (data.minPasswordLength) setMinLength(data.minPasswordLength); })
      .catch(() => {});
  }, []);

  // Ouverte depuis les premiers pas du tableau de bord : la page défile jusqu'à
  // la section visée, plutôt que de laisser chercher parmi une douzaine.
  useEffect(() => {
    if (loading || !ancre) return;
    const cible = document.getElementById(ancre);
    if (cible) cible.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [ancre, loading]);

  const handleChange = (e) => {
    const { name, value, type } = e.target;
    setSettings((prev) => ({ ...prev, [name]: type === 'number' ? parseFloat(value) : value }));
  };

  /**
   * Enregistre les taux d'une année, puis relit la liste.
   *
   * Le serveur réajuste les indemnités de l'année dans la foulée : c'est
   * pourquoi le message le dit, plutôt que de laisser croire que seul un
   * réglage a changé.
   */
  const handleTauxKm = async (e) => {
    e.preventDefault();
    setSavingTaux(true);
    setTauxMessage(null);
    try {
      const { message: texte } = await api.put('/api/settings/taux-kilometriques', {
        annee: Number(nouveauTaux.annee),
        taux_1: parseFloat(nouveauTaux.taux_1),
        taux_2: parseFloat(nouveauTaux.taux_2),
        seuil_km: parseFloat(nouveauTaux.seuil_km)
      });
      setTauxKm(await api.get('/api/settings/taux-kilometriques'));
      setTauxMessage({ type: 'success', texte });
    } catch (err) {
      setTauxMessage({ type: 'error', texte: err.message });
    } finally {
      setSavingTaux(false);
    }
  };

  /** Recharge une année existante dans le formulaire, pour la corriger. */
  const modifierTaux = (taux) => {
    setNouveauTaux({ annee: taux.annee, taux_1: taux.taux_1, taux_2: taux.taux_2, seuil_km: taux.seuil_km });
    setTauxMessage(null);
  };

  const rafraichirSauvegardes = () => (
    api.get('/api/sauvegardes').then(setInfoSauvegardes).catch(() => {})
  );

  /** Sélecteur de dossier natif, disponible seulement dans l'application de bureau. */
  const choisirDossier = async () => {
    try {
      const { dossier } = await api.post('/api/sauvegardes/dossier');
      if (dossier) setSettings((prev) => ({ ...prev, sauvegarde_dossier: dossier }));
    } catch (err) {
      notifier(err.message, 'erreur');
    }
  };

  const sauvegarderMaintenant = async () => {
    setSauvegardeEnCours(true);
    try {
      const r = await api.post('/api/sauvegardes');
      notifier(t('Sauvegarde créée ({taille} Ko).', { taille: Math.round(r.taille / 1024) }));
      await rafraichirSauvegardes();
    } catch (err) {
      notifier(err.message, 'erreur');
    } finally {
      setSauvegardeEnCours(false);
    }
  };

  /**
   * La restauration écrase les données en place : on demande une confirmation
   * explicite, et on annonce le redémarrage qui la rendra effective.
   */
  const restaurer = async (sauvegarde) => {
    const quand = new Date(sauvegarde.date).toLocaleString(locale);
    const accepte = await confirmer({
      titre: t('Restaurer cette sauvegarde ?'),
      message: t('Toute la comptabilité sera ramenée à son état du {quand}. '
        + 'Ce qui a été saisi depuis sera perdu. La base actuelle est conservée à côté, '
        + "et l'application redémarrera pour appliquer la restauration.", { quand }),
      libelleConfirmer: t('Restaurer'),
      danger: true
    });
    if (!accepte) return;

    try {
      const r = await api.post('/api/sauvegardes/restaurer', { nom: sauvegarde.nom });
      notifier(r.message);
    } catch (err) {
      notifier(err.message, 'erreur');
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > TAILLE_MAX_LOGO) {
      setMessage({ type: 'error', texte: t("L'image dépasse la taille maximale de 2 Mo.") });
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => setSettings((prev) => ({ ...prev, entreprise_logo: reader.result }));
    reader.onerror = () => setMessage({ type: 'error', texte: t("L'image n'a pas pu être lue.") });
    reader.readAsDataURL(file);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      // Le mot de passe d'envoi voyage à part et n'est transmis que s'il vient
      // d'être saisi : le serveur conserve l'existant quand le champ est vide.
      const enregistres = await api.put('/api/settings', { ...settings, smtp_pass: motDePasseSmtp });
      // Il n'est jamais réaffiché — on vide le champ et on retient seulement
      // qu'un mot de passe existe.
      setMotDePasseSmtp('');
      if (enregistres && enregistres.settings) setSettings(enregistres.settings);
      notifier(t('Paramètres enregistrés.'));
    } catch (err) {
      setMessage({ type: 'error', texte: err.message });
    } finally {
      setSaving(false);
    }
  };

  /**
   * Envoie un courriel de contrôle.
   *
   * Enregistre d'abord : tester une configuration qui n'est pas encore dans la
   * base éprouverait l'ancienne, et le message de succès porterait sur un
   * serveur que l'utilisateur vient justement de remplacer.
   */
  const envoyerCourrielTest = async () => {
    setTestEnCours(true);
    setTestMessage(null);
    try {
      const enregistres = await api.put('/api/settings', { ...settings, smtp_pass: motDePasseSmtp });
      setMotDePasseSmtp('');
      if (enregistres && enregistres.settings) setSettings(enregistres.settings);

      const r = await api.post('/api/settings/smtp/test', {});
      setTestMessage({ type: 'success', texte: r.message });
    } catch (err) {
      setTestMessage({ type: 'error', texte: err.message });
    } finally {
      setTestEnCours(false);
    }
  };

  /**
   * Enregistre la clé Stripe puis éprouve la connexion.
   *
   * Comme pour le courriel : tester avant d'enregistrer éprouverait la clé
   * précédente, et annoncerait un succès portant sur une configuration que
   * l'utilisateur vient justement de remplacer.
   */
  const testerStripe = async () => {
    setTestStripeEnCours(true);
    setTestStripeMessage(null);
    try {
      const enregistres = await api.put('/api/settings', { ...settings, stripe_cle: cleStripe });
      setCleStripe('');
      if (enregistres && enregistres.settings) setSettings(enregistres.settings);

      const r = await api.post('/api/settings/stripe/test', {});
      setTestStripeMessage({ type: r.mode === 'test' ? 'avertissement' : 'success', texte: r.message });
    } catch (err) {
      setTestStripeMessage({ type: 'error', texte: err.message });
    } finally {
      setTestStripeEnCours(false);
    }
  };

  const retirerCleStripe = async () => {
    const accepte = await confirmer({
      titre: t('Retirer la clé Stripe ?'),
      message: t('Le paiement en ligne sera désactivé et les factures cesseront de porter un lien. '
        + 'Les encaissements déjà inscrits sont conservés.'),
      libelleConfirmer: t('Retirer la clé'),
      danger: true
    });
    if (!accepte) return;

    try {
      const enregistres = await api.put('/api/settings', { ...settings, stripe_cle_effacer: true });
      if (enregistres && enregistres.settings) setSettings(enregistres.settings);
      setTestStripeMessage(null);
      notifier(t('Clé Stripe retirée.'));
    } catch (err) {
      setTestStripeMessage({ type: 'error', texte: err.message });
    }
  };

  /** Relève immédiatement les règlements, sans attendre le passage horaire. */
  const releverMaintenant = async () => {
    setReleveEnCours(true);
    try {
      const bilan = await api.post('/api/paiements-en-ligne/relever', {});
      notifier(bilan.inscrits > 0
        ? tp(bilan.inscrits, '{n} encaissement(s) inscrit(s).', '{n} encaissement(s) inscrit(s).|pluriel')
        : t('Aucun nouveau règlement reçu.'));
      const r = await api.get('/api/paiements-en-ligne/en-souffrance');
      setEnSouffrance(r.encaissements || []);
    } catch (err) {
      notifier(err.message, 'erreur');
    } finally {
      setReleveEnCours(false);
    }
  };

  const handleSecuritySave = async (e) => {
    e.preventDefault();
    setSavingSec(true);
    setSecMessage(null);
    try {
      await api.put('/api/auth/credentials', securityData);
      setSecMessage({ type: 'success', texte: t('Identifiants modifiés. Vous allez être déconnecté.') });
      setSecurityData({ currentPassword: '', newUsername: '', newPassword: '' });
      // La session est invalidée côté serveur : un rechargement ramène à l'écran de connexion.
      setTimeout(() => window.location.reload(), 2000);
    } catch (err) {
      setSecMessage({ type: 'error', texte: err.message });
      setSavingSec(false);
    }
  };

  const handleAddUser = async (e) => {
    e.preventDefault();
    setUsersMessage(null);
    try {
      const cree = await api.post('/api/users', newUser);
      setUsers((prev) => [...prev, cree]);
      setNewUser({ username: '', password: '', role: 'employe' });
      setIsAddingUser(false);
      notifier(t('Compte « {nom} » ajouté.', { nom: cree.username }));
    } catch (err) {
      setUsersMessage({ type: 'error', texte: err.message });
    }
  };

  const handleDeleteUser = async (utilisateur) => {
    const accepte = await confirmer({
      titre: t('Supprimer le compte « {nom} » ?', { nom: utilisateur.username }),
      message: t("La personne perdra immédiatement l'accès à Clora. Les documents "
        + "qu'elle a créés sont conservés."),
      libelleConfirmer: t('Supprimer le compte'),
      danger: true
    });
    if (!accepte) return;
    setUsersMessage(null);
    try {
      await api.del(`/api/users/${utilisateur.id}`);
      setUsers((prev) => prev.filter((u) => u.id !== utilisateur.id));
      notifier(t('Compte « {nom} » supprimé.', { nom: utilisateur.username }));
    } catch (err) {
      setUsersMessage({ type: 'error', texte: err.message });
    }
  };

  if (loading) return <p style={{ color: 'var(--text-muted)' }}>{t('Chargement des paramètres…')}</p>;

  return (
    <div style={{ maxWidth: '820px', margin: '0 auto' }}>
      <h2 style={{ color: 'var(--text-main)', marginBottom: '20px' }}>{t("Paramètres de l'entreprise")}</h2>

      <Message contenu={message} />

      <form onSubmit={handleSave} className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
        <div>
          <h3 style={{ margin: '0 0 16px 0', borderBottom: '1px solid var(--glass-border)', paddingBottom: '8px' }}>{t('Identité visuelle')}</h3>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
            {t('Ce logo apparaît en haut de vos factures et devis. Taille maximale : 2 Mo.')}
          </p>
          <div className="form-group">
            <label htmlFor="logo">{t("Logo de l'entreprise")}</label>
            <input id="logo" type="file" accept="image/*" onChange={handleImageUpload} className="form-control" style={{ padding: '8px' }} />
          </div>
          {settings.entreprise_logo && (
            <div style={{ marginTop: '8px' }}>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('Aperçu :')}</p>
              <img src={settings.entreprise_logo} alt={t('Aperçu du logo')} style={{ maxHeight: '100px', maxWidth: '100%', border: '1px solid var(--glass-border)', borderRadius: '4px', padding: '4px' }} />
              <button
                type="button" className="btn-secondary"
                style={{ marginTop: '8px', display: 'block', padding: '4px 8px', fontSize: '0.8rem' }}
                onClick={() => setSettings((prev) => ({ ...prev, entreprise_logo: '' }))}
              >
                {t('Supprimer le logo')}
              </button>
            </div>
          )}
        </div>

        <div>
          <h3 id="section-entreprise" style={{ margin: '0 0 16px 0', borderBottom: '1px solid var(--glass-border)', paddingBottom: '8px' }}>{t('Informations générales')}</h3>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
            {t('Ce nom identifie votre entreprise sur les documents et comme expéditeur de vos courriels.')}
          </p>
          <div className="form-group">
            <label htmlFor="entreprise_nom">{t("Nom de l'entreprise *")}</label>
            <input id="entreprise_nom" type="text" className="form-control" name="entreprise_nom" value={settings.entreprise_nom || ''} onChange={handleChange} required />
          </div>
          <div className="form-group">
            <label htmlFor="entreprise_email">{t('Courriel de contact')}</label>
            <input id="entreprise_email" type="email" className="form-control" name="entreprise_email" value={settings.entreprise_email || ''} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label htmlFor="entreprise_adresse">{t('Adresse complète')}</label>
            <textarea id="entreprise_adresse" className="form-control" name="entreprise_adresse" value={settings.entreprise_adresse || ''} onChange={handleChange} rows="3"></textarea>
          </div>
          <div className="form-group">
            <label htmlFor="profil">{t('Profil du dossier')}</label>
            <select id="profil" className="form-control" name="profil" value={settings.profil || ''} onChange={handleChange}>
              {/* Un dossier antérieur au choix de profil n'en a pas ; la mention
                  disparaît dès qu'un profil est retenu. */}
              {!settings.profil && <option value="">{t('Non précisé')}</option>}
              {PROFILS.map((p) => <option key={p.valeur} value={p.valeur}>{t(p.libelle)}</option>)}
            </select>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
              {t("Le profil règle l'ordre des premiers pas sur le tableau de bord. Il ne retire aucune fonction.")}
            </p>
          </div>
          <div className="form-group">
            <label htmlFor="conditions_defaut">{t('Conditions de paiement proposées aux nouveaux clients')}</label>
            <select id="conditions_defaut" className="form-control" name="conditions_defaut" value={settings.conditions_defaut || 'net30'} onChange={handleChange}>
              {CONDITIONS.map((c) => <option key={c.valeur} value={c.valeur}>{t(c.libelle)}</option>)}
            </select>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
              {t("Proposées à la création d'une fiche client ; chaque fiche garde son propre terme.")}
            </p>
          </div>
        </div>

        <div>
          <h3 style={{ margin: '0 0 16px 0', borderBottom: '1px solid var(--glass-border)', paddingBottom: '8px' }}>{t('Paiement')}</h3>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
            {t("Ces instructions s'affichent au bas de chaque facture (virement Interac, lien de paiement…), "
              + 'dans la langue du client. Sans texte anglais, les clients anglophones reçoivent le texte français.')}
          </p>
          <div className="form-group">
            <label htmlFor="payment_instructions">{t('Pour les clients francophones')}</label>
            <textarea id="payment_instructions" className="form-control" name="payment_instructions" value={settings.payment_instructions || ''} onChange={handleChange} rows="4" placeholder={t("Ex. : virement Interac à comptabilite@exemple.ca, ou paiement en ligne à l'adresse…")}></textarea>
          </div>
          <div className="form-group">
            <label htmlFor="payment_instructions_en">{t('Pour les clients anglophones')}</label>
            <textarea id="payment_instructions_en" className="form-control" name="payment_instructions_en" value={settings.payment_instructions_en || ''} onChange={handleChange} rows="4" placeholder={t('E.g. Interac e-Transfer to accounting@example.ca, or pay online at…')}></textarea>
          </div>
        </div>

        <div>
          <h3 id="section-stripe" style={{ margin: '0 0 16px 0', borderBottom: '1px solid var(--glass-border)', paddingBottom: '8px' }}>
            {t('Paiement en ligne (Stripe)')}
          </h3>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
            {t('Chaque facture porte alors un lien de paiement. Votre client règle par carte ou par '
              + "débit bancaire, sans créer de compte, et Clora inscrit l'encaissement tout seul dans "
              + "l'heure qui suit.")}
          </p>

          {/* L'argent ne transite jamais par Clora : le dire explicitement évite
              la question, et c'est aussi ce qui distingue un logiciel de
              facturation d'un service de paiement. */}
          <p className="alert alert-info">
            {t("L'argent est versé ")}<strong>{t('directement sur votre compte Stripe')}</strong>
            {t(', puis à votre compte bancaire. Clora ne perçoit rien au passage. Ouvrez un compte sur stripe.com, '
              + 'puis copiez ci-dessous une ')}<strong>{t('clé restreinte')}</strong>
            {t(" (Développeurs → Clés d'API → Créer une clé restreinte) avec les droits d'écriture sur « Prix », "
              + '« Produits » et « Liens de paiement », et de lecture sur « Sessions de paiement ».')}
          </p>

          <div className="form-group">
            <label htmlFor="stripe_cle">{t("Clé d'API Stripe")}</label>
            <input
              id="stripe_cle" type="password" className="form-control"
              value={cleStripe}
              onChange={(e) => setCleStripe(e.target.value)}
              placeholder={settings.stripe_cle_definie ? t('•••••••• (enregistrée)') : 'rk_live_…'}
              autoComplete="new-password"
            />
            <small style={{ color: 'var(--text-muted)' }}>
              {settings.stripe_cle_definie
                ? t('Une clé est enregistrée. Laissez ce champ vide pour la conserver.')
                : t('Une clé restreinte (« rk_… ») limite les dégâts en cas de vol : elle ne '
                  + "permet ni de virer de l'argent, ni de lire vos clients.")}
            </small>
          </div>

          {settings.stripe_cle_definie && settings.stripe_cle_restreinte === false && (
            <p style={{ fontSize: '0.85rem', color: 'var(--status-warning)', marginBottom: '16px' }}>
              {t('Cette clé est une clé secrète complète : elle donne tous les droits sur votre compte '
                + 'Stripe. Remplacez-la par une clé restreinte dès que possible.')}
            </p>
          )}

          {settings.stripe_cle_illisible && (
            <p style={{ fontSize: '0.85rem', color: 'var(--status-danger)', marginBottom: '16px' }}>
              {t("La clé enregistrée n'est plus déchiffrable sur cette machine : la base vient sans "
                + "doute d'une sauvegarde restaurée ailleurs. Saisissez-la de nouveau.")}
            </p>
          )}

          {settings.stripe_cle_definie && settings.coffre_disponible === false && (
            <p style={{ fontSize: '0.85rem', color: 'var(--status-warning)', marginBottom: '16px' }}>
              {t("Le coffre-fort de Windows n'est pas accessible : cette clé est enregistrée sans "
                + "chiffrement. Évitez d'envoyer vos sauvegardes vers un dossier partagé tant que "
                + "c'est le cas.")}
            </p>
          )}

          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={Boolean(settings.stripe_actif)}
                onChange={(e) => setSettings((prev) => ({ ...prev, stripe_actif: e.target.checked ? 1 : 0 }))}
                style={{ width: 'auto' }}
              />
              <span>{t('Ajouter un lien de paiement sur mes factures')}</span>
            </label>
          </div>

          {/* Le mode test se voit ici et sur la facture elle-même : une
              installation restée en mode test encaisserait de l'argent fictif
              sans que rien ne le signale. */}
          {/* `stripe_actif` vaut 0 ou 1 : laissé seul, le 0 s'affichait sous la case. */}
          {Boolean(settings.stripe_actif) && settings.stripe_mode === 'test' && (
            <p className="alert alert-warning" role="status">
              {t('Compte Stripe en ')}<strong>{t('mode test')}</strong>
              {t(" : les liens envoyés n'encaissent pas d'argent réel. Parfait pour vos essais ; "
                + 'pensez à passer en clé « live » avant de facturer un vrai client.')}
            </p>
          )}

          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
            <button
              type="button" className="btn-secondary"
              disabled={testStripeEnCours || (!cleStripe && !settings.stripe_cle_definie)}
              onClick={testerStripe}
            >
              {testStripeEnCours ? t('Vérification…') : t('Enregistrer et vérifier la connexion')}
            </button>
            {settings.stripe_cle_definie && (
              <>
                <button
                  type="button" className="btn-secondary"
                  disabled={releveEnCours || !settings.stripe_actif}
                  onClick={releverMaintenant}
                >
                  {releveEnCours ? t('Relevé en cours…') : t('Relever les paiements maintenant')}
                </button>
                <button type="button" className="btn-secondary" onClick={retirerCleStripe}>
                  {t('Retirer la clé')}
                </button>
              </>
            )}
          </div>

          {testStripeMessage && (
            <p
              style={{
                fontSize: '0.9rem',
                color: testStripeMessage.type === 'error' ? 'var(--status-danger)'
                  : testStripeMessage.type === 'avertissement' ? 'var(--status-warning)'
                    : 'var(--status-paid)',
                margin: 0
              }}
            >
              {testStripeMessage.texte}
            </p>
          )}

          {/* De l'argent réellement reçu qui n'a pas pu être imputé : c'est le
              seul défaut de ce mécanisme qu'on ne peut pas laisser silencieux. */}
          {enSouffrance.length > 0 && (
            <div style={{ marginTop: '20px' }}>
              <p className="alert alert-error" role="alert">
                {tp(enSouffrance.length,
                  "{n} règlement(s) reçu(s) chez Stripe n'ont pas pu être portés à une facture. Vérifiez-les, puis saisissez-les à la main si nécessaire.",
                  "{n} règlement(s) reçu(s) chez Stripe n'ont pas pu être portés à une facture. Vérifiez-les, puis saisissez-les à la main si nécessaire.|pluriel")}
              </p>
              <ul style={{ margin: 0, paddingLeft: '20px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                {enSouffrance.map((e) => (
                  <li key={e.id} style={{ marginBottom: '4px' }}>
                    {e.recu_le}, {formatMontant(e.montant, e.devise)}
                    {e.numero_facture ? t(', facture {numero}', { numero: e.numero_facture }) : ''}{t(' : ')}{e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div>
          <h3 style={{ margin: '0 0 16px 0', borderBottom: '1px solid var(--glass-border)', paddingBottom: '8px' }}>
            {t('Relances automatiques')}
          </h3>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
            {t("Un rappel de paiement est envoyé au client dès qu'une facture impayée dépasse l'un des "
              + "paliers ci-dessous. Chaque palier ne part qu'une fois par facture, et plus rien n'est "
              + 'envoyé dès que la facture est réglée ou créditée.')}
          </p>

          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={Boolean(settings.relances_actives)}
                onChange={(e) => setSettings((prev) => ({ ...prev, relances_actives: e.target.checked ? 1 : 0 }))}
                style={{ width: '18px', height: '18px' }}
              />
              {t("Activer l'envoi automatique des rappels")}
            </label>
          </div>

          <div className="form-group">
            <label htmlFor="relances_paliers">{t("Paliers, en jours après l'échéance")}</label>
            <input
              id="relances_paliers" type="text" className="form-control" name="relances_paliers"
              value={settings.relances_paliers || ''} onChange={handleChange}
              placeholder={t('7, 15, 30')}
            />
          </div>

          {/* Le rappel automatique part en texte : le PDF est produit par le
              navigateur au moment de l'impression et n'existe pas côté serveur. */}
          <p className="alert alert-info">
            {t('Le rappel automatique est un courriel texte reprenant le numéro, le solde dû et '
              + "l'échéance. Pour envoyer la facture en pièce jointe, utilisez le bouton « Relancer » "
              + 'depuis la liste des factures.')}
          </p>

          {relancesDues && (
            <div style={{ marginTop: '16px' }}>
              {relanceMessage && (
                <p
                  className={`alert ${relanceMessage.erreur ? 'alert-error' : 'alert-success'}`}
                  role={relanceMessage.erreur ? 'alert' : 'status'}
                >
                  {relanceMessage.texte}
                </p>
              )}
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                {relancesDues.factures.length === 0
                  ? t("Aucune facture n'atteint actuellement un palier de relance.")
                  : tp(relancesDues.factures.length,
                    '{n} facture(s) atteignent un palier et seraient relancées au prochain passage :',
                    '{n} facture(s) atteignent un palier et seraient relancées au prochain passage :|pluriel')}
              </p>
              {relancesDues.factures.length > 0 && (
                <ul style={{ color: 'var(--text-muted)', fontSize: '0.9rem', paddingLeft: '20px' }}>
                  {relancesDues.factures.slice(0, 8).map((f) => (
                    <li key={f.id}>
                      {f.numero_facture}, {f.client} ({t('{retard} jours de retard, palier {palier}', { retard: f.retard, palier: f.palier })})
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button" className="btn-secondary"
                disabled={relanceEnCours || relancesDues.factures.length === 0}
                onClick={async () => {
                  setRelanceMessage(null);
                  setRelanceEnCours(true);
                  try {
                    const r = await api.post('/api/relances/envoyer');
                    setRelanceMessage({
                      texte: t('{envoyees} rappel(s) envoyé(s), {erreurs} en échec.', { envoyees: r.envoyees, erreurs: r.erreurs }),
                      erreur: r.erreurs > 0
                    });
                    setRelancesDues(await api.get('/api/relances/dues'));
                  } catch (err) {
                    setRelanceMessage({ texte: err.message, erreur: true });
                  } finally {
                    setRelanceEnCours(false);
                  }
                }}
              >
                {relanceEnCours ? t('Envoi en cours…') : t('Envoyer maintenant')}
              </button>
            </div>
          )}
        </div>

        <div>
          <h3 id="section-sauvegardes" style={{ margin: '0 0 16px 0', borderBottom: '1px solid var(--glass-border)', paddingBottom: '8px' }}>
            {t('Sauvegardes')}
          </h3>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
            {t("Une copie complète de votre comptabilité est enregistrée chaque jour, ainsi qu'à la "
              + "fermeture de l'application. Choisissez un dossier synchronisé (OneDrive, Dropbox, "
              + "Google Drive) pour que la copie quitte cet ordinateur : c'est ce qui vous protège "
              + "d'un disque en panne ou d'un vol.")}
          </p>

          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={Boolean(settings.sauvegarde_active)}
                onChange={(e) => setSettings((prev) => ({ ...prev, sauvegarde_active: e.target.checked ? 1 : 0 }))}
                style={{ width: '18px', height: '18px' }}
              />
              {t('Sauvegarder automatiquement')}
            </label>
          </div>

          <div className="form-group">
            <label htmlFor="sauvegarde_dossier">{t('Dossier de destination')}</label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
              <input
                id="sauvegarde_dossier" type="text" className="form-control" name="sauvegarde_dossier"
                value={settings.sauvegarde_dossier || ''} onChange={handleChange}
                placeholder={infoSauvegardes ? infoSauvegardes.dossier_par_defaut : t("Dossier par défaut de l'application")}
              />
              {infoSauvegardes && infoSauvegardes.selecteur_disponible && (
                <button type="button" className="btn-secondary" style={{ whiteSpace: 'nowrap' }} onClick={choisirDossier}>
                  {t('Parcourir…')}
                </button>
              )}
            </div>
            <small style={{ color: 'var(--text-muted)' }}>
              {t("Laissez vide pour conserver les sauvegardes dans le dossier de l'application.")}
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="sauvegarde_retention">{t('Nombre de sauvegardes conservées')}</label>
            <input
              id="sauvegarde_retention" type="number" min="1" max="365" className="form-control"
              name="sauvegarde_retention"
              value={settings.sauvegarde_retention ?? 30} onChange={handleChange}
            />
            <small style={{ color: 'var(--text-muted)' }}>
              {t('Au-delà, les plus anciennes sont supprimées automatiquement.')}
            </small>
          </div>

          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={Boolean(settings.verifier_maj)}
                onChange={(e) => setSettings((prev) => ({ ...prev, verifier_maj: e.target.checked ? 1 : 0 }))}
                style={{ width: '18px', height: '18px' }}
              />
              {t("M'avertir quand une nouvelle version de Clora existe")}
            </label>
            <small style={{ color: 'var(--text-muted)' }}>
              {t("C'est le seul moment où Clora se connecte à Internet. Rien n'est téléchargé ni "
                + 'installé automatiquement : vous décidez.')}
            </small>
          </div>

          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <button type="button" className="btn-secondary" disabled={sauvegardeEnCours} onClick={sauvegarderMaintenant}>
              {sauvegardeEnCours ? t('Sauvegarde en cours…') : t('Sauvegarder maintenant')}
            </button>
          </div>

          {infoSauvegardes && (
            infoSauvegardes.sauvegardes.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                {t("Aucune sauvegarde pour l'instant. La première sera créée automatiquement.")}
              </p>
            ) : (
              <>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  {tp(infoSauvegardes.sauvegardes.length, '{n} sauvegarde(s) disponible(s) :', '{n} sauvegarde(s) disponible(s) :|pluriel')}
                </p>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: '220px', overflowY: 'auto' }}>
                  {infoSauvegardes.sauvegardes.map((s) => (
                    <li
                      key={s.nom}
                      style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        gap: '8px', padding: '8px 0', borderBottom: '1px solid var(--glass-border)'
                      }}
                    >
                      <span style={{ fontSize: '0.9rem' }}>
                        {new Date(s.date).toLocaleString(locale)}
                        <span style={{ color: 'var(--text-muted)' }}>, {t('{taille} Ko', { taille: Math.round(s.taille / 1024) })}</span>
                      </span>
                      <button type="button" className="btn-secondary" onClick={() => restaurer(s)}>
                        {t('Restaurer')}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )
          )}
        </div>

        {/* La section n'apparaît que si l'éditeur a configuré une clé publique :
            sur une version dont le contrôle est inerte, parler de licence
            n'apprendrait rien et inquiéterait pour rien. */}
        {licence && licence.etat !== 'desactive' && (
          <div>
            <h3 style={{ margin: '0 0 16px 0', borderBottom: '1px solid var(--glass-border)', paddingBottom: '8px' }}>
              {t('Licence')}
            </h3>
            {licence.etat === 'activee' ? (
              <>
                <p style={{ margin: '0 0 .4rem' }}>
                  {t('Licence au nom de ')}<strong>{licence.titulaire}</strong>.
                </p>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', margin: 0 }}>
                  {t("Maintenance jusqu'au ")}<strong>{licence.maintenance_jusqu_au}</strong>
                  {t('. Passé cette date, Clora continue de fonctionner\u00a0: seules les versions publiées ensuite '
                    + 'ne pourront plus être installées.')}
                </p>
              </>
            ) : (
              <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', margin: 0 }}>
                {t("Version d'essai : ")}<strong>{tp(licence.jours_restants, '{n} jour(s)', '{n} jour(s)|pluriel')}</strong>{tp(licence.jours_restants, ' restant(s).', ' restant(s).|pluriel')}
              </p>
            )}
          </div>
        )}

        <div>
          <h3 style={{ margin: '0 0 16px 0', borderBottom: '1px solid var(--glass-border)', paddingBottom: '8px' }}>
            {t('Courriel')}
          </h3>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
            {t('Nécessaire pour transmettre vos factures et vos devis depuis Clora, et pour les '
              + 'relances automatiques. Ces renseignements vous sont fournis par votre service de '
              + 'messagerie.')}
          </p>

          <div className="form-group">
            <label htmlFor="smtp_host">{t("Serveur d'envoi (SMTP)")}</label>
            <input
              id="smtp_host" type="text" className="form-control" name="smtp_host"
              value={settings.smtp_host || ''} onChange={handleChange}
              placeholder={t('smtp.gmail.com')}
              autoComplete="off"
            />
          </div>

          <div className="form-group">
            <label htmlFor="smtp_port">{t('Port')}</label>
            <input
              id="smtp_port" type="number" min="1" max="65535" className="form-control"
              name="smtp_port"
              value={settings.smtp_port ?? ''} onChange={handleChange}
              placeholder={t('587')}
            />
            <small style={{ color: 'var(--text-muted)' }}>
              {t('Laissez vide pour 587, accepté par la quasi-totalité des fournisseurs.')}
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="smtp_user">{t("Adresse d'envoi")}</label>
            <input
              id="smtp_user" type="email" className="form-control" name="smtp_user"
              value={settings.smtp_user || ''} onChange={handleChange}
              placeholder={t('facturation@votreentreprise.ca')}
              autoComplete="off"
            />
            <small style={{ color: 'var(--text-muted)' }}>
              {t("C'est l'adresse qui apparaîtra comme expéditeur chez vos clients.")}
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="smtp_pass">{t('Mot de passe')}</label>
            <input
              id="smtp_pass" type="password" className="form-control"
              value={motDePasseSmtp}
              onChange={(e) => setMotDePasseSmtp(e.target.value)}
              placeholder={settings.smtp_pass_defini ? t('•••••••• (enregistré)') : ''}
              autoComplete="new-password"
            />
            <small style={{ color: 'var(--text-muted)' }}>
              {settings.smtp_pass_defini
                ? t('Un mot de passe est enregistré. Laissez ce champ vide pour le conserver.')
                : t('Gmail, Outlook et la plupart des fournisseurs exigent un « mot de passe '
                  + "d'application », à créer dans les réglages de sécurité de votre compte. "
                  + 'Votre mot de passe habituel sera refusé.')}
            </small>
          </div>

          {/* Hors Electron — serveur lancé seul — le coffre du système n'existe
              pas. Le taire laisserait croire à une protection absente. */}
          {settings.smtp_pass_defini && settings.coffre_disponible === false && (
            <p style={{ fontSize: '0.85rem', color: 'var(--status-warning)', marginBottom: '16px' }}>
              {t("Le coffre-fort de Windows n'est pas accessible : ce mot de passe est enregistré "
                + "sans chiffrement. Évitez d'envoyer vos sauvegardes vers un dossier partagé tant "
                + "que c'est le cas.")}
            </p>
          )}

          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <button
              type="button" className="btn-secondary"
              disabled={testEnCours || !settings.smtp_host}
              onClick={envoyerCourrielTest}
            >
              {testEnCours ? t('Envoi en cours…') : t('Enregistrer et envoyer un courriel de test')}
            </button>
          </div>

          {testMessage && (
            <p
              style={{
                fontSize: '0.9rem',
                color: testMessage.type === 'error' ? 'var(--status-danger)' : 'var(--status-paid)',
                margin: 0
              }}
            >
              {testMessage.texte}
            </p>
          )}
        </div>

        <div>
          <h3 style={{ margin: '0 0 16px 0', borderBottom: '1px solid var(--glass-border)', paddingBottom: '8px' }}>{t('Numéros de taxes')}</h3>
          {/* Les taux appliqués aux documents proviennent de la province du
              client. Ces champs ne servent qu'à l'affichage des numéros
              d'enregistrement au bas des factures. */}
          <p className="alert alert-info">
            {t('Les taux de taxe sont déterminés automatiquement par la province de chaque client '
              + '(TPS et TVQ au Québec, TVH en Ontario, etc.). Ces champs servent uniquement à faire '
              + "figurer vos numéros d'enregistrement sur les documents.")}
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
            <div style={{ padding: '16px', background: 'var(--hover-subtle)', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
              <div className="form-group">
                <label htmlFor="taxe_1_nom">{t('Nom de la taxe 1 (ex. : TPS)')}</label>
                <input id="taxe_1_nom" type="text" className="form-control" name="taxe_1_nom" value={settings.taxe_1_nom || ''} onChange={handleChange} />
              </div>
              <div className="form-group">
                <label htmlFor="taxe_1_numero">{t("Numéro d'enregistrement")}</label>
                <input id="taxe_1_numero" type="text" className="form-control" name="taxe_1_numero" value={settings.taxe_1_numero || ''} onChange={handleChange} />
              </div>
            </div>

            <div style={{ padding: '16px', background: 'var(--hover-subtle)', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
              <div className="form-group">
                <label htmlFor="taxe_2_nom">{t('Nom de la taxe 2 (ex. : TVQ)')}</label>
                <input id="taxe_2_nom" type="text" className="form-control" name="taxe_2_nom" value={settings.taxe_2_nom || ''} onChange={handleChange} />
              </div>
              <div className="form-group">
                <label htmlFor="taxe_2_numero">{t("Numéro d'enregistrement")}</label>
                <input id="taxe_2_numero" type="text" className="form-control" name="taxe_2_numero" value={settings.taxe_2_numero || ''} onChange={handleChange} />
              </div>
            </div>
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? t('Sauvegarde…') : t('Enregistrer les paramètres')}
          </button>
        </div>
      </form>

      <h2 id="section-kilometrage" style={{ color: 'var(--text-main)', marginTop: '48px', marginBottom: '20px' }}>{t('Indemnité kilométrique')}</h2>
      <Message contenu={tauxMessage} />

      <div className="glass-panel" style={{ padding: '20px' }}>
        <p className="alert alert-info">
          {t("Le taux s'applique aux déplacements inscrits dans l'écran Dépenses : les premiers "
            + "kilomètres de l'année à un taux, le reste à un taux moindre. ")}
          <strong>{t("Vérifiez le taux en vigueur auprès de l'Agence du revenu du Canada et de Revenu Québec")}</strong>
          {t(". Il est révisé chaque année, et Clora n'en propose aucun de "
            + 'lui-même pour ne pas vous en faire hériter un périmé.')}
        </p>

        {/* La méthode du taux au kilomètre est celle de l'indemnité. Un
            travailleur autonome non incorporé doit proratiser ses coûts réels :
            le dire ici évite qu'un montant calculé soit pris pour une déduction
            que le fisc n'accepterait pas sous cette forme. */}
        <p className="alert alert-warning">
          {t("Cette méthode est celle de l'")}<strong>{t('indemnité')}</strong>
          {t(' : elle convient à un employé indemnisé ou à un actionnaire qui se verse une allocation de sa société. '
            + 'Un travailleur autonome non incorporé doit plutôt proratiser ses coûts réels de véhicule selon son '
            + "usage d'affaires ; le montant calculé ici n'est alors qu'une estimation.")}
        </p>

        <form onSubmit={handleTauxKm} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '16px', alignItems: 'end' }}>
          <div className="form-group">
            <label htmlFor="km-annee">{t('Année')}</label>
            <input id="km-annee" type="number" min="2000" max="2100" step="1" className="form-control" value={nouveauTaux.annee} onChange={(e) => setNouveauTaux({ ...nouveauTaux, annee: e.target.value })} required />
          </div>
          <div className="form-group">
            <label htmlFor="km-taux-1">{t("Taux jusqu'au seuil ($/km)")}</label>
            <input id="km-taux-1" type="number" step="0.001" min="0.001" max="10" className="form-control" placeholder={t('0.70')} value={nouveauTaux.taux_1} onChange={(e) => setNouveauTaux({ ...nouveauTaux, taux_1: e.target.value })} required />
          </div>
          <div className="form-group">
            <label htmlFor="km-taux-2">{t('Taux au-delà ($/km)')}</label>
            <input id="km-taux-2" type="number" step="0.001" min="0.001" max="10" className="form-control" placeholder={t('0.64')} value={nouveauTaux.taux_2} onChange={(e) => setNouveauTaux({ ...nouveauTaux, taux_2: e.target.value })} required />
          </div>
          <div className="form-group">
            <label htmlFor="km-seuil">{t('Seuil (km)')}</label>
            <input id="km-seuil" type="number" step="1" min="1" className="form-control" value={nouveauTaux.seuil_km} onChange={(e) => setNouveauTaux({ ...nouveauTaux, seuil_km: e.target.value })} required />
          </div>
          <div className="form-group">
            <button type="submit" className="btn-primary" disabled={savingTaux} style={{ width: '100%' }}>
              {savingTaux ? t('Enregistrement…') : t('Enregistrer')}
            </button>
          </div>
        </form>

        {tauxKm.length > 0 && (
          <div className="table-scroll" style={{ marginTop: '20px' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('Année')}</th>
                  <th className="numeric">{t("Jusqu'au seuil")}</th>
                  <th className="numeric">{t('Au-delà')}</th>
                  <th className="numeric">{t('Seuil')}</th>
                  <th style={{ textAlign: 'right' }}>{t('Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {tauxKm.map((taux) => (
                  <tr key={taux.annee}>
                    <td style={{ fontWeight: '500' }}>{taux.annee}</td>
                    <td className="numeric">{formatMontant(taux.taux_1)} / km</td>
                    <td className="numeric">{formatMontant(taux.taux_2)} / km</td>
                    <td className="numeric">{taux.seuil_km.toLocaleString(locale)} km</td>
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className="btn-icon" onClick={() => modifierTaux(taux)} aria-label={t('Modifier les taux de {annee}', { annee: taux.annee })}><Pencil size={16} aria-hidden="true" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '8px' }}>
              {t("Modifier un taux réajuste aussitôt les indemnités de l'année concernée, et le "
                + "changement est consigné au journal d'audit. Les autres années ne bougent pas.")}
            </p>
          </div>
        )}
      </div>

      <h2 style={{ color: 'var(--text-main)', marginTop: '48px', marginBottom: '20px' }}>{t('Mes identifiants')}</h2>
      <Message contenu={secMessage} />

      <form onSubmit={handleSecuritySave} className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div className="form-group">
          <label htmlFor="sec-actuel">{t('Mot de passe actuel')}</label>
          <input id="sec-actuel" type="password" autoComplete="current-password" className="form-control" value={securityData.currentPassword} onChange={(e) => setSecurityData({ ...securityData, currentPassword: e.target.value })} required />
        </div>
        <div className="form-group">
          <label htmlFor="sec-nom">{t("Nouveau nom d'utilisateur")}</label>
          <input id="sec-nom" type="text" autoComplete="username" className="form-control" value={securityData.newUsername} onChange={(e) => setSecurityData({ ...securityData, newUsername: e.target.value })} required minLength={3} />
        </div>
        <div className="form-group">
          <label htmlFor="sec-mdp">{t('Nouveau mot de passe (au moins {n} caractères)', { n: minLength })}</label>
          <input id="sec-mdp" type="password" autoComplete="new-password" className="form-control" value={securityData.newPassword} onChange={(e) => setSecurityData({ ...securityData, newPassword: e.target.value })} required minLength={minLength} />
        </div>
        <div style={{ textAlign: 'right' }}>
          <button type="submit" className="btn-secondary" disabled={savingSec}>
            {savingSec ? t('Modification…') : t('Modifier mes identifiants')}
          </button>
        </div>
      </form>

      <h2 id="section-comptes" style={{ color: 'var(--text-main)', marginTop: '48px', marginBottom: '20px' }}>{t('Gestion des utilisateurs')}</h2>
      <Message contenu={usersMessage} />

      <div className="glass-panel" style={{ padding: '20px' }}>
        <div className="toolbar">
          <h3 style={{ margin: 0 }}>{t('Comptes')}</h3>
          <button type="button" className="btn-primary" onClick={() => setIsAddingUser(!isAddingUser)}>
            {isAddingUser ? t('Annuler') : t('+ Nouvel utilisateur')}
          </button>
        </div>

        {isAddingUser && (
          <form onSubmit={handleAddUser} style={{ background: 'var(--glass-card-bg)', padding: '20px', borderRadius: '8px', marginBottom: '20px', border: '1px solid var(--glass-border)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
              <div className="form-group">
                <label htmlFor="nouvel-utilisateur">{t("Nom d'utilisateur")}</label>
                <input id="nouvel-utilisateur" type="text" className="form-control" value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} required minLength={3} />
              </div>
              <div className="form-group">
                <label htmlFor="nouveau-mdp">{t('Mot de passe (au moins {n} caractères)', { n: minLength })}</label>
                <input id="nouveau-mdp" type="password" autoComplete="new-password" className="form-control" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} required minLength={minLength} />
              </div>
              <div className="form-group">
                <label htmlFor="nouveau-role">{t('Rôle')}</label>
                <select id="nouveau-role" className="form-control" value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
                  {ROLES.map((r) => <option key={r.valeur} value={r.valeur}>{t(r.libelle)}</option>)}
                </select>
              </div>
            </div>
            <div style={{ textAlign: 'right', marginTop: '16px' }}>
              <button type="submit" className="btn-primary">{t("Créer l'utilisateur")}</button>
            </div>
          </form>
        )}

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("Nom d'utilisateur")}</th>
                <th>{t('Rôle')}</th>
                <th style={{ textAlign: 'right' }}>{t('Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const couleurs = COULEURS_ROLE[user.role] || COULEURS_ROLE.employe;
                const estMoi = utilisateurCourant && user.username === utilisateurCourant.username;
                return (
                  <tr key={user.id}>
                    <td style={{ fontWeight: '500' }}>
                      {user.username}
                      {estMoi && <span style={{ color: 'var(--text-muted)', fontWeight: 'normal' }}>{t(' (vous)')}</span>}
                    </td>
                    <td>
                      <span style={{ padding: '4px 8px', borderRadius: '12px', fontSize: '0.85rem', fontWeight: 'bold', background: couleurs.fond, color: couleurs.texte }}>
                        {t(user.role)}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {/* Supprimer son propre compte est refusé par le serveur :
                          autant ne pas proposer l'action. */}
                      <button
                        type="button" className="btn-danger"
                        onClick={() => handleDeleteUser(user)}
                        disabled={estMoi}
                        title={estMoi ? t('Vous ne pouvez pas supprimer votre propre compte.') : undefined}
                      >
                        {t('Supprimer')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default Settings;
