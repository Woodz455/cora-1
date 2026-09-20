import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Les deux polices du produit, embarquées dans l'exécutable.
//
// Elles étaient nommées dans la feuille de style sans être chargées nulle part :
// un poste Windows affichait donc Segoe UI à leur place, et le produit n'avait
// pas la typographie qu'il croyait avoir. L'import Google Fonts d'origine avait
// été retiré pour la bonne raison, un logiciel de bureau devant fonctionner
// hors ligne, mais rien ne l'avait remplacé.
//
// Les fichiers passent par le paquet `@fontsource-variable`, donc par le même
// gestionnaire de dépendances que le reste, et Vite les émet dans `client/dist`,
// qu'`electron-builder` empaquette déjà. Aucune requête réseau au démarrage.
//
// La variante `wght` porte le seul axe que l'application emploie, la graisse,
// de 400 à 700. Une police variable couvre ces quatre graisses en un fichier
// par alphabet, là où des fichiers fixes en auraient demandé quatre.
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/outfit/wght.css';

import './index.css'
import App from './App.jsx'
import FeedbackProvider from './components/FeedbackProvider.jsx'

// Le fil des messages et la fenêtre de confirmation sont montés une seule fois,
// au-dessus de l'application : ils survivent aux changements d'écran, et
// l'écran de connexion en dispose comme les autres.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <FeedbackProvider>
      <App />
    </FeedbackProvider>
  </StrictMode>,
)
