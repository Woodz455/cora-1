import { useCallback, useMemo, useState } from 'react';
import {
  LangueContext, langueCourante, definirLangueCourante, traduire, traduirePluriel
} from '../i18n.js';
import { formatMontant } from '../api';

/**
 * Fournit la langue à toute l'application, et la fait changer d'un coup :
 * chaque composant qui lit `useLangue()` se redessine dans la nouvelle.
 */
function LangueProvider({ children }) {
  const [langue, setLangue] = useState(langueCourante);

  const changerLangue = useCallback((nouvelle) => {
    if (definirLangueCourante(nouvelle)) setLangue(nouvelle);
  }, []);

  const valeur = useMemo(() => ({
    langue,
    changerLangue,
    t: (texte, valeurs) => traduire(texte, valeurs, langue),
    tp: (n, singulier, pluriel, valeurs) => traduirePluriel(n, singulier, pluriel, valeurs, langue),
    // Les montants de l'interface suivent la langue de l'utilisateur :
    // « 1 149,75 $ » en français, « $1,149.75 » en anglais.
    montant: (valeur, devise) => formatMontant(valeur, devise, langue)
  }), [langue, changerLangue]);

  return <LangueContext.Provider value={valeur}>{children}</LangueContext.Provider>;
}

export default LangueProvider;
