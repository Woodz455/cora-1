import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
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
