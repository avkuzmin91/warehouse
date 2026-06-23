import { useCallback, useEffect, useState } from 'react'
import { listShipments, SHIPMENT_STATUS_LABELS, type ShipmentListItem } from '../../api/shipmentsApi'
import { AppBar } from '../../components/AppBar'
import { Icon } from '../../components/Icon'
import { PullToRefresh } from '../../components/PullToRefresh'

function fmtDate(d: string | null): string {
  if (!d) return ''
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return ''
  return dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const STATUS_TONE: Record<string, string> = {
  draft: '',
  packing: 'info',
  on_packing: 'warning',
  relocating: 'warning',
  awaiting_trip: 'warning',
  partially_shipped: 'warning',
  shipped: 'success',
  completed_no_goods: 'success',
  cancelled: 'danger',
}

export function PackingListScreen() {
  const [items, setItems] = useState<ShipmentListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback((signal?: AbortSignal, silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    return listShipments({ limit: 50 }, signal)
      .then((res) => setItems(res.items))
      .catch((err) => {
        if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить задачи упаковки')
      })
      .finally(() => {
        if (!signal?.aborted) setLoading(false)
      })
  }, [])

  useEffect(() => {
    const ac = new AbortController()
    load(ac.signal)
    return () => ac.abort()
  }, [load])

  return (
    <div className="screen">
      <AppBar title="Упаковка" sub="Задачи упаковки" />
      <PullToRefresh className="scroll pad-nav" onRefresh={() => load(undefined, true)}>
        {error && (
          <div className="alert">
            <Icon name="alert" size={15} />
            {error}
          </div>
        )}
        {loading ? (
          <div className="center">
            <div className="spin" />
            <div>Загрузка…</div>
          </div>
        ) : items.length === 0 ? (
          <div className="center">
            <div className="center-ico">
              <Icon name="box" size={26} />
            </div>
            <div>Нет задач упаковки</div>
          </div>
        ) : (
          <>
            <div className="sec">
              Все задачи
              <span className="sec-count">{items.length}</span>
            </div>
            {items.map((s) => {
              const urgent = s.priority_rank != null && s.priority_rank > 0
              const tone = STATUS_TONE[s.status] ?? ''
              const eta = fmtDate(s.ship_date)
              return (
                <div key={s.id} className="tile">
                  <div className={`tile-ico${s.cargo_type === 'defect' ? ' gray' : ''}`}>
                    <Icon name={s.cargo_type === 'defect' ? 'refresh' : 'box'} size={21} />
                  </div>
                  <div className="tile-body">
                    <div className="tile-title">
                      {s.doc_number}
                      {s.client_name ? ` · ${s.client_name}` : ''}
                    </div>
                    <div className="tile-meta">
                      {SHIPMENT_STATUS_LABELS[s.status]} · {s.total_qty} шт
                      {s.cargo_type === 'defect' ? ' · брак' : ''}
                      {eta ? ` · ${eta}` : ''}
                    </div>
                  </div>
                  {urgent ? (
                    <span className="badge danger">
                      <span className="dot" />
                      Срочно
                    </span>
                  ) : (
                    tone && (
                      <span className={`badge ${tone}`}>
                        <span className="dot" />
                        {SHIPMENT_STATUS_LABELS[s.status]}
                      </span>
                    )
                  )}
                </div>
              )
            })}
          </>
        )}
      </PullToRefresh>
    </div>
  )
}
