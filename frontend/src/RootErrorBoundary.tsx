import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }

type State = { error: Error | null }

/** Ловит необработанные ошибки рендера, чтобы не оставлять пустой #root. */
export class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
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
