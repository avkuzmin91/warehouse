/** Fallback для React.Suspense при ленивой подгрузке маршрутов. */
export function RouteLoadingFallback() {
  return (
    <div className="auth-shell">
      <div className="page" style={{ padding: 24 }}>
        <p className="auth-card__subtitle" role="status" aria-live="polite">
          Загрузка…
        </p>
      </div>
    </div>
  )
}
