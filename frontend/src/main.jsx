import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ToastProvider } from './contexts'
import PWAUpdatePrompt from './components/PWAUpdatePrompt'
import './index.css'
import App from './App.jsx'

// Set browser tab color based on environment
const isDev = import.meta.env.VITE_APP_MODE === 'dev';
const themeColor = isDev ? '#f59e0b' : '#1a1f36'; // Yellow/amber for dev, dark blue for prod
document.getElementById('theme-color-meta')?.setAttribute('content', themeColor);

// Also update page title to indicate environment
if (isDev) {
  document.title = 'FI [DEV]';
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ToastProvider>
      <App />
      <PWAUpdatePrompt />
    </ToastProvider>
  </StrictMode>,
)
