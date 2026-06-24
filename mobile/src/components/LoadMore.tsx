import { Icon } from './Icon'

/** Футер постраничного списка: «показано N из M» + кнопка догрузки. */
export function LoadMore({
  shown,
  total,
  hasMore,
  loadingMore,
  onMore,
}: {
  shown: number
  total: number
  hasMore: boolean
  loadingMore: boolean
  onMore: () => void
}) {
  if (!hasMore) return null
  return (
    <div style={{ padding: '12px 0', textAlign: 'center' }}>
      <button className="btn ghost" style={{ width: '100%' }} disabled={loadingMore} onClick={onMore}>
        {loadingMore ? (
          <>
            <span className="spin spin-sm" /> Загрузка…
          </>
        ) : (
          <>
            <Icon name="chevDown" size={16} /> Показать ещё
          </>
        )}
      </button>
      <div className="line-sub" style={{ marginTop: 6 }}>
        Показано {shown} из {total}
      </div>
    </div>
  )
}
