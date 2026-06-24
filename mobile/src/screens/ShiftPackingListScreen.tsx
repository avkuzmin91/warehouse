import { useCallback, useEffect, useState } from 'react'
import { useNav } from '../nav/NavContext'
import { listShipments, SHIPMENT_STATUS_LABELS, type ShipmentListItem, type ShipmentStatus } from '../api/shipmentsApi'
import { AppBar } from '../components/AppBar'
import { Icon } from '../components/Icon'
import { PullToRefresh } from '../components/PullToRefresh'
import { fmtDate } from '../utils/format'

// Активные стадии упаковки, видимые начальнику смены. Внесение годного/брака
// доступно только на on_packing — остальные показаны для контекста (read-only).
const ACTIVE_STATUSES: ShipmentStatus[] = ['packing', 'on_packing', 'relocating']

// Сортировка: сначала «На упаковке» (действие начальника смены), затем остальные.
const STATUS_ORDER: Record<string, number> = { on_packing: 0, packing: 1, relocating: 2 }

const STATUS_TONE: Record<string, string> = {
  packing: 'info',
  on_packing: 'warning',
  relocating: 'info',
}

export function ShiftPackingListScreen() {
  const { openPackDoc } = useNav()
  const [items, setItems] = useState<ShipmentListItem[]>([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback((signal?: AbortSignal, silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    return listShipments({ limit: 100 }, signal)
      .then((res) => {
        if (signal?.aborted) return
        const active = res.items
          .filter((s) => ACTIVE_STATUSES.includes(s.status))
          .sort((a, b) => {
            const o = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)
            if (o !== 0) return o
            return (a.ship_date ?? '').localeCompare(b.ship_date ?? '')
          })
        setItems(active)
        // Активные стадии фильтруются из первой страницы; за её пределами могут быть ещё.
        setTruncated(res.items.length < res.total)
      })
      .catch((err) => {
        if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить упаковку')
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
            <div className="center-ico green">
              <Icon name="check" size={26} />
            </div>
            <div>Нет задач на упаковке</div>
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
              const eta = fmtDate(s.ship_date, '')
              const ready = s.status === 'on_packing'
              return (
                <button key={s.id} className="tile" onClick={() => openPackDoc(s.id)}>
                  <div className={`tile-ico${s.cargo_type === 'defect' ? ' gray' : ''}`}>
                    <Icon name={s.cargo_type === 'defect' ? 'refresh' : 'box'} size={21} />
                  </div>
                  <div className="tile-body">
                    <div className="tile-title">
                      {s.doc_number}
                      {s.client_name ? ` · ${s.client_name}` : ''}
                    </div>
                    <div className="tile-meta">
                      {s.total_qty} шт
                      {s.cargo_type === 'defect' ? ' · брак' : ''}
                      {eta ? ` · ${eta}` : ''}
                    </div>
                  </div>
                  {urgent && (
                    <span className="badge danger">
                      <span className="dot" />
                      Срочно
                    </span>
                  )}
                  {!urgent && tone && (
                    <span className={`badge ${tone}`}>
                      <span className="dot" />
                      {ready ? 'Внести' : SHIPMENT_STATUS_LABELS[s.status]}
                    </span>
                  )}
                  <span className="tile-chev"><Icon name="chev" size={18} /></span>
                </button>
              )
            })}
            {truncated && (
              <div className="line-sub" style={{ textAlign: 'center', padding: '12px 0' }}>
                Показаны не все задачи — уточните через «Упаковка» в меню
              </div>
            )}
          </>
        )}
      </PullToRefresh>
    </div>
  )
}
