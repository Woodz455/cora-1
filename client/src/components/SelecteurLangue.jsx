import { useLangue } from '../i18n.js';
import { api } from '../api';

/**
 * Bascule FR | EN.
 *
 * Chaque libellé est écrit dans sa propre langue : quelqu'un qui ne lit pas
 * l'interface en cours doit pouvoir trouver la sienne.
 *
 * @param {boolean} [enregistrer] connecté : la langue est enregistrée sur le
 *   compte, et suit l'utilisateur sur ses autres postes.
 * @param {Function} [onChange] prévenu après chaque changement.
 */
function SelecteurLangue({ enregistrer = false, onChange }) {
  const { langue, changerLangue, t } = useLangue();

  const choisir = (nouvelle) => {
    if (nouvelle === langue) return;
    changerLangue(nouvelle);
    if (enregistrer) {
      // Un échec n'annule pas le changement à l'écran : la langue resterait
      // seulement à rechoisir à la prochaine connexion.
      api.put('/api/auth/langue', { langue: nouvelle }).catch(() => {});
    }
    if (onChange) onChange(nouvelle);
  };

  const bouton = (code, libelle, nom) => (
    <button
      type="button"
      lang={code}
      aria-pressed={langue === code}
      aria-label={nom}
      onClick={() => choisir(code)}
      style={{
        padding: '4px 12px', border: 'none', cursor: 'pointer', font: 'inherit',
        fontSize: '.8rem', fontWeight: 600, borderRadius: '6px',
        background: langue === code ? 'var(--safehill-blue)' : 'transparent',
        color: langue === code ? '#fff' : 'var(--text-muted)'
      }}
    >
      {libelle}
    </button>
  );

  return (
    <div
      role="group"
      aria-label={t("Langue de l'interface")}
      style={{
        display: 'inline-flex', gap: '2px', padding: '2px', borderRadius: '8px',
        border: '1px solid var(--glass-border)', background: 'var(--glass-bg)'
      }}
    >
      {bouton('fr', 'FR', 'Français')}
      {bouton('en', 'EN', 'English')}
    </div>
  );
}

export default SelecteurLangue;
