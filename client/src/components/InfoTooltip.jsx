import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

/** Largeur au-delà de laquelle le texte revient à la ligne. */
const LARGEUR_MAX = 260;

/** Espace gardé entre la bulle, son icône et les bords de la fenêtre. */
const MARGE = 8;

/**
 * Hauteur au-delà de laquelle la bulle s'ouvre vers le bas plutôt que vers le
 * haut. Quatre lignes du texte le plus long, plus les marges intérieures.
 */
const HAUTEUR_ESTIMEE = 110;

/**
 * Bulle d'aide attachée à un libellé.
 *
 * Elle n'était qu'un `<span>` écoutant le survol de la souris, ce qui la rendait
 * inatteignable de quatre façons : au clavier, faute d'être focalisable ; pour
 * un lecteur d'écran, faute de nom et de rôle ; au doigt, faute de survol ; et
 * même à la souris sur trois de ses emplacements, la bulle étant rognée par le
 * conteneur de défilement du tableau des dépenses.
 *
 * Le déclencheur est donc un bouton, qui reçoit au passage l'anneau de focus que
 * la feuille de style donne à tous les boutons, et la bulle passe par un portail
 * vers `document.body`.
 *
 * Le portail n'est pas un luxe : `position: fixed` seul ne suffirait pas, car
 * `.glass-card:hover` applique une transformation, et une transformation devient
 * le bloc conteneur d'un élément fixe. Or la carte d'indicateur des rapports est
 * une `.glass-card` et contient une bulle d'aide : survoler l'icône survole la
 * carte, et la bulle se placerait par rapport à la carte au lieu du cadre.
 * Hors de tout ancêtre transformé, les coordonnées de `getBoundingClientRect`,
 * qui tiennent déjà compte des transformations, sont justes.
 *
 * `useModale` n'est pas réemployé : il piège le focus, cycle sur `Tab` et pose
 * `aria-modal`, ce qu'une bulle d'aide ne doit surtout pas faire.
 */
function InfoTooltip({ text }) {
  const [ancre, setAncre] = useState(null);
  const [fleche, setFleche] = useState(null);
  const declencheurRef = useRef(null);
  const bulleRef = useRef(null);
  const id = useId();

  const ouvrir = () => {
    const el = declencheurRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const centre = r.left + r.width / 2;
    setAncre({
      centre,
      // Vers le haut par défaut ; vers le bas s'il n'y a pas la place au-dessus.
      versLeHaut: r.top > HAUTEUR_ESTIMEE + MARGE,
      haut: r.top - MARGE,
      bas: r.bottom + MARGE,
      // La bulle reste dans le cadre, quitte à ne plus être centrée sur l'icône.
      gauche: Math.min(
        Math.max(centre, MARGE + LARGEUR_MAX / 2),
        Math.max(MARGE + LARGEUR_MAX / 2, window.innerWidth - MARGE - LARGEUR_MAX / 2)
      )
    });
  };

  const fermer = () => { setAncre(null); setFleche(null); };

  /** La flèche se pose sous l'icône, non au milieu d'une bulle décalée. */
  useLayoutEffect(() => {
    if (!ancre || !bulleRef.current) return;
    const b = bulleRef.current.getBoundingClientRect();
    const x = ancre.centre - b.left;
    setFleche(Math.min(Math.max(x, 12), Math.max(12, b.width - 12)));
  }, [ancre]);

  useEffect(() => {
    if (!ancre) return;

    // En phase de capture, donc avant `useModale`, qui écoute sur `document`
    // en phase de remontée : une première pression ferme la bulle sans fermer
    // la fenêtre qui la contient, une seconde ferme la fenêtre.
    const surTouche = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      fermer();
    };
    // Un défilement déplace l'icône, pas la bulle, qui est fixée au cadre.
    document.addEventListener('keydown', surTouche, true);
    window.addEventListener('scroll', fermer, true);
    window.addEventListener('resize', fermer);
    return () => {
      document.removeEventListener('keydown', surTouche, true);
      window.removeEventListener('scroll', fermer, true);
      window.removeEventListener('resize', fermer);
    };
  }, [ancre]);

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: '4px' }}>
      <button
        ref={declencheurRef}
        type="button"
        aria-label="Aide"
        aria-expanded={ancre !== null}
        aria-describedby={ancre ? id : undefined}
        onMouseEnter={ouvrir}
        onMouseLeave={fermer}
        onFocus={ouvrir}
        onBlur={fermer}
        onClick={() => (ancre ? fermer() : ouvrir())}
        style={{
          display: 'inline-flex', alignItems: 'center', padding: 0,
          background: 'none', border: 'none', cursor: 'help',
          color: 'var(--icone-aide)'
        }}
      >
        <Info size={14} aria-hidden="true" />
      </button>

      {ancre && createPortal(
        <div
          ref={bulleRef}
          id={id}
          role="tooltip"
          style={{
            position: 'fixed',
            left: ancre.gauche,
            top: ancre.versLeHaut ? ancre.haut : ancre.bas,
            transform: ancre.versLeHaut ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
            maxWidth: `${LARGEUR_MAX}px`,
            width: 'max-content',
            padding: '8px 12px',
            backgroundColor: '#1e293b',
            // Sur le fond du thème sombre, la bulle ne mesurait que 1,22:1 :
            // son texte se lisait, mais elle flottait sans aucun bord.
            border: '1px solid var(--glass-border)',
            color: '#f8fafc',
            fontSize: '0.8rem',
            lineHeight: 1.45,
            textAlign: 'left',
            borderRadius: '6px',
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.25)',
            zIndex: 10001,
            fontWeight: 'normal',
            pointerEvents: 'none'
          }}
        >
          {text}
          {fleche !== null && (
            <span
              style={{
                position: 'absolute',
                [ancre.versLeHaut ? 'top' : 'bottom']: '100%',
                left: fleche,
                marginLeft: '-5px',
                borderWidth: '5px',
                borderStyle: 'solid',
                borderColor: ancre.versLeHaut
                  ? '#1e293b transparent transparent transparent'
                  : 'transparent transparent #1e293b transparent'
              }}
            />
          )}
        </div>,
        document.body
      )}
    </span>
  );
}

export default InfoTooltip;
