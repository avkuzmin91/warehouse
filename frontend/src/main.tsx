import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './style.css'
import App from './App'
import { ConfirmDialogProvider } from './components/ConfirmDialogProvider'
import { RootErrorBoundary } from './RootErrorBoundary'

/** Заголовок вкладки: `VITE_APP_TITLE` при сборке (prod/test) или pack-men - dev в `npm run dev`. */
function applyDocumentTitle(): void {
  const raw = import.meta.env.VITE_APP_TITLE
  if (typeof raw === 'string' && raw.trim() !== '') {
    document.title = raw.trim()
    return
  }
  document.title = import.meta.env.DEV ? 'pack-men - dev' : 'pack-men - prod'
}

applyDocumentTitle()

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
