import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './style.css'
import App from './App'
import { ConfirmDialogProvider } from './components/ConfirmDialogProvider'
import { RootErrorBoundary } from './RootErrorBoundary'

/** База из Vite (`vite.config` → `base`), без завершающего «/». Для деплоя в подкаталог. */
function routerBasename(): string | undefined {
  const raw = import.meta.env.BASE_URL ?? '/'
  if (raw === '/' || raw === './') return undefined
  return raw.endsWith('/') ? raw.slice(0, -1) : raw
}

const rootEl = document.getElementById('root')
if (!rootEl) {
  document.body.innerHTML =
    '<p style="font-family:system-ui;padding:24px">Не найден элемент #root в index.html.</p>'
} else {
  createRoot(rootEl).render(
    <StrictMode>
      <RootErrorBoundary>
        <BrowserRouter basename={routerBasename()}>
          <ConfirmDialogProvider>
            <App />
          </ConfirmDialogProvider>
        </BrowserRouter>
      </RootErrorBoundary>
    </StrictMode>,
  )
}
