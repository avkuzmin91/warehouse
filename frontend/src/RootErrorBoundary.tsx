import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }

type State = { error: Error | null }

const CHUNK_RELOAD_KEY = 'wms:chunk-reload-attempted'

function isDynamicImportError(error: Error): boolean {
  const message = String(error?.message ?? '')
  const name = String(error?.name ?? '')
  return (
    name === 'ChunkLoadError' ||
    message.includes('Failed to fetch dynamically imported module') ||
    message.includes('Importing a module script failed') ||
    message.includes('error loading dynamically imported module') ||
    message.includes('Unable to preload CSS')
  )
}

/** Ловит необработанные ошибки рендера, чтобы не оставлять пустой #root. */
export class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null }
  private clearReloadMarkerTimer: number | undefined

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidMount() {
    this.clearReloadMarkerTimer = window.setTimeout(() => {
      sessionStorage.removeItem(CHUNK_RELOAD_KEY)
    }, 10000)
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
    if (isDynamicImportError(error) && sessionStorage.getItem(CHUNK_RELOAD_KEY) !== '1') {
      sessionStorage.setItem(CHUNK_RELOAD_KEY, '1')
      window.location.reload()
    }
  }

  componentWillUnmount() {
    if (this.clearReloadMarkerTimer !== undefined) {
      window.clearTimeout(this.clearReloadMarkerTimer)
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div
          className="app-error-fallback"
          style={{
            minHeight: '100vh',
            boxSizing: 'border-box',
            padding: '28px 20px',
            maxWidth: 720,
            margin: '0 auto',
            fontFamily: 'system-ui, Segoe UI, Roboto, sans-serif',
            color: '#1a1a1a',
            background: '#f6f4fb',
          }}
        >
          <h1 style={{ fontSize: '1.35rem', margin: '0 0 12px' }}>Ошибка загрузки интерфейса</h1>
          <p style={{ margin: '0 0 16px', lineHeight: 1.5 }}>
            Обновите страницу. Если после обновления снова пусто — откройте консоль браузера (F12) и
            пришлите текст ошибки разработчику.
          </p>
          <pre
            style={{
              margin: 0,
              padding: 14,
              borderRadius: 10,
              background: '#fff',
              border: '1px solid #ddd',
              overflow: 'auto',
              fontSize: 13,
            }}
          >
            {this.state.error.message}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}
