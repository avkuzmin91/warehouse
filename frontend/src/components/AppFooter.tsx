import { useEffect, useState } from 'react'
import { fetchSystemVersion } from '../api'

/**
 * Футер: версия и окружение с бэкенда (ТЗ «Версия системы»). Публичный GET /version.
 */
export function AppFooter() {
  const [line, setLine] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchSystemVersion()
      .then((info) => {
        if (!cancelled) {
          const env = String(info.environment).trim().toLowerCase()
          setLine(
            env === 'prod'
              ? `v${info.version}`
              : `v${info.version} (${env})`,
          )
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLine(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <footer className="app-footer" role="contentinfo" aria-label="Версия системы">
      {line ? <span className="app-footer__version">{line}</span> : <span className="app-footer__version app-footer__version--muted">…</span>}
    </footer>
  )
}
