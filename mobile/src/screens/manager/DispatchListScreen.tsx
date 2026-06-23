import { useCallback, useEffect, useState } from 'react'
import { useNav } from '../../nav/NavContext'
import {
  getDispatches,
  DISPATCH_STATUS_LABELS,
  dispatchStatusTone,
  type DispatchListItem,
} from '../../api/dispatchApi'
import { AppBar } from '../../components/AppBar'
import { Icon } from '../../components/Icon'
import { PullToRefresh } from '../../components/PullToRefresh'

function fmtDate(d: string | null): string {
  if (!d) return ''
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return ''
  return dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function DispatchListScreen() {
  const { openDispatchNew } = useNav()
  const [items, setItems] = useState<DispatchListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback((signal?: AbortSignal, silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    return getDispatches({ limit: 50 }, signal)
      .then((res) => setItems(res.items))
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
      <AppBar title="Отгрузки" sub="Документы отгрузки" />
      <PullToRefresh className="scroll pad-nav" onRefresh={() => load(undefined, true)}>
        <button className="btn" style={{ width: '100%', marginBottom: 12 }} onClick={openDispatchNew}>
          <Icon name="plus" size={16} /> Новая отгрузка
        </button>
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
              <Icon name="truckOut" size={26} />
            </div>
            <div>Нет отгрузок</div>
          </div>
        ) : (
          <>
            <div className="sec">
              Все документы
              <span className="sec-count">{items.length}</span>
            </div>
            {items.map((d) => {
              const urgent = d.priority_rank != null && d.priority_rank > 0
              const tone = dispatchStatusTone(d.status)
              const eta = fmtDate(d.ship_date)
              return (
                <div key={d.id} className="tile">
                  <div className={`tile-ico${d.cargo_type === 'defect' ? ' gray' : ''}`}>
                    <Icon name="truckOut" size={21} />
                  </div>
                  <div className="tile-body">
                    <div className="tile-title">
                      {d.doc_number}
                      {d.client_name ? ` · ${d.client_name}` : ''}
                    </div>
                    <div className="tile-meta">
                      {DISPATCH_STATUS_LABELS[d.status]} · {d.total_qty} шт
                      {d.cargo_type === 'defect' ? ' · брак' : ''}
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
                        {DISPATCH_STATUS_LABELS[d.status]}
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
