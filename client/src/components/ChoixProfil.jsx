import { PROFILS } from '../profils';

/**
 * Choix du profil d'un dossier, en trois cartes.
 *
 * Le profil règle des valeurs de départ et l'ordre des premiers pas. Il ne
 * retire aucun écran : un travailleur autonome qui embauche trouve les rôles
 * là où ils sont, sans rien débloquer. Le texte sous les cartes le dit, pour
 * que personne ne croie choisir une version amputée du logiciel.
 *
 * @param {string} valeur profil retenu
 * @param {Function} onChange reçoit la valeur du profil choisi
 */
function ChoixProfil({ valeur, onChange, nom = 'profil' }) {
  return (
    <fieldset style={{ border: 'none', padding: 0, margin: 0, minWidth: 0 }}>
      <legend style={{ fontSize: '0.9rem', fontWeight: 500, marginBottom: '8px', color: 'var(--text-main)', padding: 0 }}>
        Quel profil décrit le mieux cette entreprise&nbsp;?
      </legend>
      <div style={{ display: 'grid', gap: '8px' }}>
        {PROFILS.map((p) => {
          const actif = valeur === p.valeur;
          return (
            <label
              key={p.valeur}
              style={{
                display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '12px 14px',
                borderRadius: '10px', cursor: 'pointer', textAlign: 'left',
                border: `1px solid ${actif ? 'var(--safehill-blue)' : 'var(--glass-border)'}`,
                background: actif ? 'var(--hover-subtle)' : 'var(--card-bg)'
              }}
            >
              <input
                type="radio" name={nom} value={p.valeur} checked={actif}
                onChange={() => onChange(p.valeur)} style={{ marginTop: '3px', flexShrink: 0 }}
              />
              <span>
                <span style={{ display: 'block', fontWeight: 600, color: 'var(--text-main)' }}>{p.libelle}</span>
                <span style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  {p.description}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      <p style={{ margin: '10px 0 0', fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'left' }}>
        Le profil règle des valeurs de départ et l'ordre des premiers pas. Il ne retire
        aucune fonction, et se change à tout moment dans Paramètres.
      </p>
    </fieldset>
  );
}

export default ChoixProfil;
