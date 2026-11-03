import { useState, useEffect, useRef, useCallback } from 'react';
import { useLangue } from '../i18n.js';
import { useModale } from '../useModale';

/** Marge autour de l'élément éclairé, et entre lui et la bulle. */
const MARGE = 8;
const ECART = 16;
const LARGEUR_BULLE = 340;

/** Repère un élément de l'écran par son attribut `data-visite`. */
const cibleDe = (nom) => (nom ? document.querySelector(`[data-visite="${nom}"]`) : null);

/**
 * Place la bulle à côté de l'élément éclairé : à droite s'il est dans le menu,
 * sinon dessous, ou dessus faute de place. Elle reste toujours dans la fenêtre.
 */
function positionBulle(rect, hauteurBulle) {
  const largeur = window.innerWidth;
  const hauteur = window.innerHeight;
  const borner = (valeur, min, max) => Math.max(min, Math.min(valeur, max));

  if (!rect) {
    return { left: (largeur - LARGEUR_BULLE) / 2, top: Math.max(ECART, (hauteur - hauteurBulle) / 2) };
  }
  if (rect.right + ECART + LARGEUR_BULLE <= largeur - ECART && rect.left < largeur / 3) {
    return {
      left: rect.right + MARGE + ECART,
      top: borner(rect.top, ECART, hauteur - hauteurBulle - ECART)
    };
  }
  const left = borner(rect.right - LARGEUR_BULLE, ECART, largeur - LARGEUR_BULLE - ECART);
  const dessous = rect.bottom + MARGE + ECART;
  if (dessous + hauteurBulle <= hauteur - ECART) return { left, top: dessous };
  return { left, top: Math.max(ECART, rect.top - MARGE - ECART - hauteurBulle) };
}

/**
 * Visite guidée de l'écran principal.
 *
 * Une bulle à la fois, posée à côté de l'élément qu'elle présente, le reste
 * de l'écran assombri. Elle se passe d'un clic ou par Échap, et ne bloque rien
 * au-delà de sa propre durée. Une étape dont l'élément n'est pas à l'écran
 * (rôle, liste masquée) est simplement omise.
 *
 * @param {{etapes: {cible: ?string, titre: string, texte: string}[], onFermer: Function}} props
 *   Les textes sont en français et traduits ici.
 */
function VisiteGuidee({ etapes, onFermer }) {
  const { t } = useLangue();
  // Les étapes présentes à l'écran, retenues à l'ouverture pour que le compte
  // « 2 sur 6 » ne change pas en cours de route.
  const [presentes] = useState(() => etapes.filter((e) => !e.cible || cibleDe(e.cible)));
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const [position, setPosition] = useState(null);
  const bulle = useRef(null);
  const principal = useRef(null);

  const etape = presentes[index];
  const derniere = index === presentes.length - 1;

  /**
   * Mesure l'élément éclairé et place la bulle. La hauteur de la bulle dépend
   * du texte de l'étape : elle se lit une fois celle-ci dessinée.
   */
  const mesurer = useCallback(() => {
    const element = etape ? cibleDe(etape.cible) : null;
    const zone = element ? element.getBoundingClientRect() : null;
    setRect(zone);
    if (bulle.current) setPosition(positionBulle(zone, bulle.current.offsetHeight));
  }, [etape]);

  useEffect(() => {
    const element = etape ? cibleDe(etape.cible) : null;
    // Un grand élément (la liste des premiers pas) est amené en haut : la bulle
    // trouve alors sa place dessous au lieu de le chevaucher.
    if (element) {
      const grand = element.getBoundingClientRect().height > window.innerHeight / 3;
      element.scrollIntoView({ block: grand ? 'start' : 'nearest' });
    }
    const image = requestAnimationFrame(mesurer);
    return () => cancelAnimationFrame(image);
  }, [etape, mesurer]);

  useEffect(() => {
    window.addEventListener('resize', mesurer);
    // Le contenu défile dans <main>, pas dans la fenêtre : on écoute en capture.
    window.addEventListener('scroll', mesurer, true);
    return () => {
      window.removeEventListener('resize', mesurer);
      window.removeEventListener('scroll', mesurer, true);
    };
  }, [mesurer]);

  useEffect(() => {
    if (principal.current) principal.current.focus();
  }, [index]);

  // Échap, tabulation qui boucle dans la bulle, focus rendu à la fermeture :
  // le crochet commun des fenêtres. Appelé après l'effet ci-dessus, pour que le
  // focus aille d'abord au bouton Suivant plutôt qu'à « Passer la visite ».
  const conteneur = useModale(onFermer);

  // Aucune étape à montrer : rien à afficher, la visite est réputée vue.
  useEffect(() => {
    if (presentes.length === 0) onFermer();
  }, [presentes, onFermer]);

  if (!etape) return null;

  const suivant = () => (derniere ? onFermer() : setIndex((i) => i + 1));

  return (
    <div ref={conteneur} className="modal-overlay visite">
      {/* Le voile intercepte les clics : la visite se quitte par ses boutons. */}
      <div className="visite-voile" aria-hidden="true" style={rect ? { background: 'transparent' } : undefined} />
      {rect && (
        <div
          className="visite-eclairage"
          aria-hidden="true"
          style={{
            top: rect.top - MARGE,
            left: rect.left - MARGE,
            width: rect.width + MARGE * 2,
            height: rect.height + MARGE * 2
          }}
        />
      )}
      <div
        ref={bulle}
        className="visite-bulle"
        role="dialog"
        aria-modal="true"
        aria-labelledby="visite-titre"
        aria-describedby="visite-texte"
        style={{
          width: LARGEUR_BULLE,
          top: position ? position.top : 0,
          left: position ? position.left : 0,
          // Transparente, et non cachée, le temps d'être placée : un élément
          // caché ne peut pas recevoir le focus.
          opacity: position ? 1 : 0
        }}
      >
        <p className="visite-compte">
          {t('{n} sur {total}', { n: index + 1, total: presentes.length })}
        </p>
        <h3 id="visite-titre">{t(etape.titre)}</h3>
        <p id="visite-texte">{t(etape.texte)}</p>
        <div className="visite-actions">
          {!derniere ? (
            <button type="button" className="visite-passer" onClick={onFermer}>{t('Passer la visite')}</button>
          ) : <span />}
          <span style={{ display: 'flex', gap: '8px' }}>
            {index > 0 && (
              <button type="button" className="btn-secondary" onClick={() => setIndex((i) => i - 1)}>{t('Précédent')}</button>
            )}
            <button ref={principal} type="button" className="btn-primary" onClick={suivant}>
              {derniere ? t('Terminer') : t('Suivant')}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

export default VisiteGuidee;
