import { useState, useMemo } from 'react';
import { User, Mail, MapPin, Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import ClientModal from './ClientModal';
import ImportModal from './ImportModal';
import { api } from '../api';
import { useApiResource } from '../useApiResource';
import { usePagination } from '../usePagination';
import Pagination from './Pagination';
import { useUser } from '../UserContext';
import { useFeedback } from '../FeedbackContext';
import { useLangue } from '../i18n.js';

const PAR_PAGE = 24;

function ClientList() {
  const { data: clients, loading, error, refresh } = useApiResource('/api/clients', []);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [clientToEdit, setClientToEdit] = useState(null);
  const [importOuvert, setImportOuvert] = useState(false);
  const [recherche, setRecherche] = useState('');
  // Les clients archivés restent rangés à part : on ne les voit que sur demande.
  const [voirArchives, setVoirArchives] = useState(false);
  const { t, tp } = useLangue();
  const user = useUser();
  const { notifier, confirmer } = useFeedback();
  const estAdmin = user?.role === 'admin';
  const gereArchives = user?.role === 'admin' || user?.role === 'comptable';
  const nbArchives = clients.filter((c) => c.archive_le).length;

  const archiver = async (client, archive) => {
    if (archive) {
      const accepte = await confirmer({
        titre: t('Archiver « {nom} » ?', { nom: client.nom_entreprise }),
        message: t('Le client ne sera plus proposé pour une nouvelle facture, un devis ou un abonnement. '
          + 'Ses documents passés restent intacts, et vous pourrez le réactiver.'),
        libelleConfirmer: t('Archiver')
      });
      if (!accepte) return;
    }
    try {
      const r = await api.put(`/api/clients/${client.id}/archive`, { archive });
      notifier(r.message);
      refresh();
    } catch (err) {
      notifier(err.message, 'erreur');
    }
  };

  const supprimer = async (client) => {
    const accepte = await confirmer({
      titre: t('Supprimer « {nom} » ?', { nom: client.nom_entreprise }),
      message: t('Cette fiche ne porte aucun document : elle sera supprimée définitivement.'),
      libelleConfirmer: t('Supprimer'),
      danger: true
    });
    if (!accepte) return;
    try {
      const r = await api.del(`/api/clients/${client.id}`);
      notifier(r.message);
      refresh();
    } catch (err) {
      notifier(err.message, 'erreur');
    }
  };

  // La pagination repart à la première page dès que la recherche change.
  const changerRecherche = (valeur) => {
    setRecherche(valeur);
    setPage(1);
  };

  const clientsFiltres = useMemo(() => {
    const terme = recherche.trim().toLowerCase();
    const visibles = clients.filter((c) => Boolean(c.archive_le) === voirArchives);
    if (!terme) return visibles;
    return visibles.filter((c) => [c.nom_entreprise, c.nom_contact, c.email]
      .some((champ) => (champ || '').toLowerCase().includes(terme)));
  }, [clients, recherche, voirArchives]);

  const { setPage, affiches, pagination } = usePagination(clientsFiltres, PAR_PAGE);

  return (
    <div>
      {error && <p className="alert alert-error" role="alert">{error}</p>}

      <div className="toolbar">
        <div className="toolbar-group">
          <input
            type="search"
            className="search-input"
            placeholder={t('Rechercher un client…')}
            aria-label={t('Rechercher un client')}
            value={recherche}
            onChange={(e) => changerRecherche(e.target.value)}
          />
          <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            {tp(clientsFiltres.length, '{n} client', '{n} clients')}
          </span>
          {(nbArchives > 0 || voirArchives) && (
            <button type="button" className="btn-secondary" onClick={() => { setVoirArchives(!voirArchives); setPage(1); }}>
              {voirArchives ? t('Revenir aux clients actifs') : tp(nbArchives, 'Voir le client archivé ({n})', 'Voir les clients archivés ({n})')}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" className="btn-secondary" onClick={() => setImportOuvert(true)}>
            {t('Importer')}
          </button>
          <button type="button" className="btn-primary" onClick={() => { setClientToEdit(null); setIsModalOpen(true); }}>
            {t('+ Nouveau client')}
          </button>
        </div>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>{t('Chargement des clients…')}</p>
      ) : affiches.length === 0 ? (
        <div className="glass-panel empty-state">
          {clients.length === 0 ? t('Aucun client pour le moment.')
            : voirArchives && !recherche ? t('Aucun client archivé.')
              : t('Aucun client ne correspond à votre recherche.')}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
          {affiches.map((client) => (
            <div key={client.id} className="glass-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '8px' }}>
                <h3 style={{ margin: 0, color: 'var(--text-main)', fontSize: '1.2rem' }}>{client.nom_entreprise}</h3>
                <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                  <button
                    type="button"
                    className="btn-icon"
                    style={{ padding: '4px 8px', fontSize: '0.85rem' }}
                    onClick={() => { setClientToEdit(client); setIsModalOpen(true); }}
                  >
                    {t('Éditer')}
                  </button>
                  {gereArchives && (
                    <button
                      type="button" className="btn-icon" style={{ padding: '4px 8px' }}
                      onClick={() => archiver(client, !client.archive_le)}
                      aria-label={client.archive_le ? t('Réactiver « {nom} »', { nom: client.nom_entreprise }) : t('Archiver « {nom} »', { nom: client.nom_entreprise })}
                      title={client.archive_le ? t('Réactiver') : t('Archiver')}
                    >
                      {client.archive_le ? <ArchiveRestore size={16} aria-hidden="true" /> : <Archive size={16} aria-hidden="true" />}
                    </button>
                  )}
                  {/* Seule une fiche sans document se supprime : les autres
                      s'archivent, leurs factures devant garder leur destinataire. */}
                  {estAdmin && client.documents === 0 && (
                    <button
                      type="button" className="btn-danger" style={{ padding: '4px 8px' }}
                      onClick={() => supprimer(client)}
                      aria-label={t('Supprimer « {nom} »', { nom: client.nom_entreprise })} title={t('Supprimer')}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
              {/* Trois rangées, et non trois émojis en tête de ligne : une
                  adresse sur deux lignes revenait sous son pictogramme au lieu
                  de s'aligner sur le texte. Le motif est celui des rangées de
                  `ChoixEntreprise`. */}
              <p style={{ margin: '0 0 4px 0', color: 'var(--text-muted)', display: 'flex', gap: '.5rem', alignItems: 'flex-start' }}>
                <User size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: '.15rem', opacity: .7 }} />
                <span>{client.nom_contact || t('Non spécifié')}</span>
              </p>
              <p style={{ margin: '0 0 4px 0', color: 'var(--text-muted)', display: 'flex', gap: '.5rem', alignItems: 'flex-start' }}>
                <Mail size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: '.15rem', opacity: .7 }} />
                <span>{client.email}</span>
              </p>
              {client.adresse && (
                <p style={{ margin: '0 0 4px 0', color: 'var(--text-muted)', display: 'flex', gap: '.5rem', alignItems: 'flex-start' }}>
                  <MapPin size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: '.15rem', opacity: .7 }} />
                  <span>{client.adresse}</span>
                </p>
              )}
              {/* La province détermine les taxes appliquées : elle mérite d'être visible. */}
              <p style={{ margin: '8px 0 0 0' }}>
                <span className="status-badge pending">{client.province || '-'}</span>
                {' '}
                <span className="status-badge">{client.langue === 'en' ? t('Anglais') : t('Français')}</span>
              </p>
            </div>
          ))}
        </div>
      )}

      <Pagination {...pagination} />

      {importOuvert && (
        <ImportModal
          modele="clients"
          titre={t('Importer des clients')}
          onFerme={() => setImportOuvert(false)}
          onTermine={refresh}
        />
      )}

      {isModalOpen && (
        <ClientModal
          clientToEdit={clientToEdit}
          onClose={() => setIsModalOpen(false)}
          onSuccess={() => { setIsModalOpen(false); refresh(); }}
        />
      )}
    </div>
  );
}

export default ClientList;
