import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { RootErrorBoundary } from './RootErrorBoundary'
import { routerBasename } from './utils/routerBase'
import { App } from './ui/App'
import './ui/fonts.css'
import './ui/theme.css'

/** Заголовок вкладки: `VITE_APP_TITLE` при сборке (prod/test) или pack-men - dev в `npm run dev`. */
function applyDocumentTitle(): void {
  const raw = import.meta.env.VITE_APP_TITLE
  if (typeof raw === 'string' && raw.trim() !== '') {
    document.title = raw.trim()
    return
  }
  document.title = import.meta.env.DEV ? 'pack-men - dev' : 'Pack-men'
}

applyDocumentTitle()

const rootEl = document.getElementById('root')
if (!rootEl) {
  const p = document.createElement('p')
  p.style.fontFamily = 'system-ui'
  p.style.padding = '24px'
  p.textContent = 'Не найден элемент #root в index.html.'
  document.body.appendChild(p)
} else {
  createRoot(rootEl).render(
    <StrictMode>
      <RootErrorBoundary>
        <BrowserRouter basename={routerBasename()}>
          <App />
        </BrowserRouter>
      </RootErrorBoundary>
    </StrictMode>,
  )
}
