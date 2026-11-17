import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { LanguageProvider } from '../shared/i18n'
import PopupApp from './PopupApp'
import '../styles/extension.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider>
      <PopupApp />
    </LanguageProvider>
  </StrictMode>,
)
