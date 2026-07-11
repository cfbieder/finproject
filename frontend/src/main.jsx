import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from './contexts'
import PWAUpdatePrompt from './components/PWAUpdatePrompt'
import './index.css'
import App from './App.jsx'

// Shared TanStack Query client (CR043 Phase 3.1). Conservative defaults for a
// personal-finance app: don't refetch on window focus (avoids surprise reloads
// while reviewing numbers), one retry, and a short stale window so slow-moving
// reference data (chart of accounts) is shared across consumers instead of
// refetched per-mount.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
})

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
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <App />
        <PWAUpdatePrompt />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
)
