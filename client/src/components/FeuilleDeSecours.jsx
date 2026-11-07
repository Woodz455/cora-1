import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, Copy } from 'lucide-react';
import { useModale } from '../useModale';
import { useLangue } from '../i18n.js';

/**
 * Un code de secours, à imprimer : la clé des sauvegardes ou le code de
 * récupération du mot de passe.
 *
 * Clora ne garde de ces codes qu'une empreinte, ou un exemplaire que seul ce
 * poste sait lire : la feuille imprimée est ce qui servira le jour où
 * l'ordinateur est perdu ou le mot de passe oublié. Elle dit donc, en plus du
 * code, à quoi il sert et comment s'en servir, pour être comprise des mois
 * plus tard par quelqu'un qui n'a pas cet écran sous les yeux.
 *
 * La fenêtre et la feuille sont rendues directement dans `body`. La fenêtre
 * s'ouvre parfois depuis un panneau flouté (création du compte, connexion) :
 * un parent qui porte `backdrop-filter` devient le cadre de tout ce qu'il
 * contient, et la fenêtre y restait enfermée au lieu de couvrir l'écran. La
 * feuille, elle, est seule imprimée : l'application ne l'est pas.
 *
 * @param {{nature: 'cle'|'recuperation', code: string, sujet: string,
 *   titre: string, onFermer?: Function, children?: any}} props `sujet` : le
 *   dossier pour une clé, le compte pour un code ; `children` : ce qui suit le
 *   code (confirmation, boutons).
 */
function FeuilleDeSecours({ nature, code, sujet, titre, onFermer, children }) {
  const { t, langue } = useLangue();
  const conteneur = useModale(onFermer || (() => {}));
  const [copie, setCopie] = useState(false);

  const cle = nature === 'cle';
  const explication = cle
    ? t("Cette clé ouvre les sauvegardes chiffrées de ce dossier. Sans elle, personne ne peut les lire, pas même Safehill : imprimez-la et rangez la feuille à l'écart de l'ordinateur.")
    : t("Ce code vous rend l'accès à Clora si vous oubliez votre mot de passe. Il ne sert qu'une fois : imprimez-le et rangez la feuille à l'écart de l'ordinateur.");
  const etapes = cle
    ? [
      t('Installez Clora sur le nouvel ordinateur et créez votre compte.'),
      t('Dans Paramètres, section Sauvegardes, choisissez le même dossier de sauvegarde qu\'avant.'),
      t('Cliquez sur Restaurer à côté de la sauvegarde la plus récente, puis saisissez cette clé.')
    ]
    : [
      t("À l'écran de connexion, choisissez « Mot de passe oublié ? »."),
      t("Saisissez votre nom d'utilisateur, ce code et un nouveau mot de passe."),
      t('Notez le nouveau code que Clora vous donne aussitôt : celui-ci ne servira plus.')
    ];

  const imprimer = () => {
    // Seule la feuille s'imprime : la règle d'impression masque l'application
    // tant que cette classe est posée. `window.print` rend la main une fois la
    // boîte d'impression fermée.
    document.body.classList.add('impression-feuille');
    try {
      window.print();
    } finally {
      document.body.classList.remove('impression-feuille');
    }
  };

  const copier = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopie(true);
    } catch {
      // Presse-papiers refusé : le code reste lisible à l'écran.
    }
  };

  return createPortal(
    <>
    <div
      ref={conteneur}
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="feuille-titre"
      aria-describedby="feuille-explication"
    >
      <div className="modal-content glass-panel" style={{ maxWidth: '520px' }}>
        <h3 id="feuille-titre" style={{ marginTop: 0 }}>{titre}</h3>
        <p id="feuille-explication" style={{ color: 'var(--text-muted)', lineHeight: 1.55 }}>{explication}</p>
        <p className="code-secours" aria-label={t('Code : {code}', { code: code.split('').join(' ') })}>{code}</p>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button type="button" className="btn-secondary" onClick={imprimer}>
            <Printer size={16} aria-hidden="true" /> {t('Imprimer la feuille de secours')}
          </button>
          <button type="button" className="btn-secondary" onClick={copier}>
            <Copy size={16} aria-hidden="true" /> {copie ? t('Copié') : t('Copier')}
          </button>
        </div>
        {children}
      </div>
    </div>

        <div className="feuille-imprimable" aria-hidden="true">
          <h1>{t('Feuille de secours Clora')}</h1>
          <p>
            {cle
              ? t('Clé des sauvegardes du dossier « {sujet} »', { sujet })
              : t('Code de récupération du compte « {sujet} »', { sujet })}
          </p>
          <p className="feuille-code">{code}</p>
          <p>{t('Établie le {date}.', { date: new Date().toLocaleDateString(langue === 'en' ? 'en-CA' : 'fr-CA') })}</p>
          <h2>{t('À quoi elle sert')}</h2>
          <p>{explication}</p>
          <h2>{t('Comment s\'en servir')}</h2>
          <ol>
            {etapes.map((etape) => <li key={etape}>{etape}</li>)}
          </ol>
          <p>
            {cle
              ? t('Quiconque a cette feuille en main peut ouvrir vos sauvegardes : gardez-la comme un chèque signé.')
              : t('Quiconque a cette feuille en main peut entrer dans votre compte : gardez-la comme un chèque signé.')}
          </p>
        </div>
    </>,
    document.body
  );
}

export default FeuilleDeSecours;
