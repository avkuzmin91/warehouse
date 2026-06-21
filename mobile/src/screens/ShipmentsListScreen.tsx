import { useCallback, useEffect, useState } from 'react'
import { useNav } from '../nav/NavContext'
import { getShipments, SHIPMENT_STATUS_LABELS, type ShipmentListItem } from '../api/shipmentsApi'
import { AppBar } from '../components/AppBar'
import { Icon } from '../components/Icon'
import { PullToRefresh } from '../components/PullToRefresh'

// Тон бейджа статуса в очереди кладовщика.
const STATUS_TONE: Record<string, string> = {
  packing: 'warning',
  relocating: 'info',
}

export function ShipmentsListScreen() {
  const { openShipment } = useNav()
  const [items, setItems] = useState<ShipmentListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback((signal?: AbortSignal, silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    // Очередь кладовщика: «В плане» (передать на упаковку) + «Перемещение» (разложить).
    return Promise.all([getShipments('packing', 50, signal), getShipments('relocating', 50, signal)])
      .then(([a, b]) => {
        const merged = [...a.items, ...b.items]
        merged.sort((x, y) => (x.priority_rank ?? 9) - (y.priority_rank ?? 9))
        setItems(merged)
      })
      .catch((err) => {
        if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить отгрузки')
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
      <AppBar title="Отгрузки" sub="Упаковка и раскладка" />
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
            <div>Нет отгрузок в работе</div>
          </div>
        ) : (
          <>
            <div className="sec">
              В работе
              <span className="sec-count">{items.length}</span>
            </div>
            {items.map((s) => {
              const urgent = s.priority_rank != null && s.priority_rank > 0
              const tone = STATUS_TONE[s.status] ?? ''
              return (
                <button key={s.id} className="tile" onClick={() => openShipment(s.id)}>
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
                  <span className="tile-chev">
                    <Icon name="chev" size={18} />
                  </span>
                </button>
              )
            })}
          </>
        )}
      </PullToRefresh>
    </div>
  )
}
