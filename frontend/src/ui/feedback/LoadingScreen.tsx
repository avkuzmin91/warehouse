import { useEffect, useState } from 'react'

/** Полноэкранное состояние загрузки: бренд-марка со спиннером.
 *  Если загрузка затянулась (медленная сеть), показывает подсказку. */

const SLOW_HINT_DELAY_MS = 4000

function BrandHeart() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
        fill="white"
        fillOpacity="0.9"
      />
    </svg>
  )
}

export function LoadingScreen({ label = 'Загрузка…' }: { label?: string }) {
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), SLOW_HINT_DELAY_MS)
    return () => window.clearTimeout(t)
  }, [])

  return (
    <div className="load-screen" role="status" aria-live="polite">
      <div className="load-screen-mark" aria-hidden="true">
        <div className="load-screen-ring" />
        <div className="load-screen-logo">
          <BrandHeart />
        </div>
      </div>
      <div className="load-screen-label">{label}</div>
      <div className={`load-screen-hint${slow ? ' visible' : ''}`}>
        Загрузка занимает дольше обычного.
        <br />
        Проверьте подключение к интернету.
      </div>
    </div>
  )
}
