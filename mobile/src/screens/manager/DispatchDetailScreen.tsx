import { useCallback, useEffect, useState } from 'react'
import { useNav } from '../../nav/NavContext'
import { getDispatch, DISPATCH_STATUS_LABELS, dispatchStatusTone, type DispatchDetail } from '../../api/dispatchApi'
import { AppBar } from '../../components/AppBar'
import { Icon } from '../../components/Icon'

function fmtDate(d: string | null): string {
  if (!d) return '—'
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return d
  return dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function fmtDateTime(d: string): string {
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return d
  return dt.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function DispatchDetailScreen({ docId }: { docId: string }) {
  const { back } = useNav()
  const [doc, setDoc] = useState<DispatchDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback((signal?: AbortSignal) => {
    setLoading(true)
    setError('')
    getDispatch(docId, signal)
      .then((d) => { if (!signal?.aborted) setDoc(d) })
      .catch((err) => { if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить документ') })
      .finally(() => { if (!signal?.aborted) setLoading(false) })
  }, [docId])

  useEffect(() => {
    const ac = new AbortController()
    load(ac.signal)
    return () => ac.abort()
  }, [load])

  const tone = doc ? dispatchStatusTone(doc.status) : ''

  return (
    <div className="screen">
      <AppBar title={doc ? doc.doc_number : 'Отгрузка'} sub={doc ? DISPATCH_STATUS_LABELS[doc.status] : ''} onBack={back} noProfile />
      <div className="scroll pad-nav">
        {error && (<div className="alert"><Icon name="alert" size={15} />{error}</div>)}
        {loading || !doc ? (
          !error && <div className="center" style={{ padding: '32px 0' }}><div className="spin" /></div>
        ) : (
          <>
            <div className="summary" style={{ marginBottom: 16 }}>
              <div className="kv"><span className="k">Статус</span>
                <span className="v">{tone ? <span className={`badge ${tone}`}><span className="dot" />{DISPATCH_STATUS_LABELS[doc.status]}</span> : DISPATCH_STATUS_LABELS[doc.status]}</span>
              </div>
              <div className="kv"><span className="k">Клиент</span><span className="v">{doc.client_name ?? '—'}</span></div>
              {doc.cargo_type === 'defect' && <div className="kv"><span className="k">Тип</span><span className="v">Брак</span></div>}
              <div className="kv"><span className="k">Отгрузка (план)</span><span className="v">{fmtDate(doc.ship_date)}</span></div>
              <div className="kv"><span className="k">Отгрузка (факт)</span><span className="v">{fmtDate(doc.actual_ship_date)}</span></div>
              {doc.logistics_cost != null && (
                <div className="kv"><span className="k">Логистика</span><span className="v mono">{doc.logistics_cost} ₽</span></div>
              )}
              {doc.trips.length > 0 && (
                <div className="kv"><span className="k">Рейсы</span><span className="v">{doc.trips.map((t) => t.number).join(', ')}</span></div>
              )}
              {doc.comment && (<div className="kv"><span className="k">Комментарий</span><span className="v">{doc.comment}</span></div>)}
            </div>

            <div className="sec">Строки<span className="sec-count">{doc.lines.length}</span></div>
            {doc.lines.map((l) => (
              <div key={l.id} className="line-row" style={{ marginTop: 0, padding: '8px 0', borderBottom: '1px solid var(--c-border)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="tile-title" style={{ fontSize: 14 }}>{l.product_name}</div>
                  <div className="tile-meta">{[l.product_sku, l.color_name, l.size_name].filter(Boolean).join(' · ')}{l.store_name ? ` · ${l.store_name}` : ''}</div>
                </div>
                <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <div className="mono">{l.qty} шт</div>
                  {l.shipped_qty > 0 && <div className="tile-meta mono">отгружено {l.shipped_qty}</div>}
                </div>
              </div>
            ))}

            {doc.ops.length > 0 && (
              <>
                <div className="sec" style={{ marginTop: 16 }}>История<span className="sec-count">{doc.ops.length}</span></div>
                {doc.ops.map((op) => (
                  <div key={op.id} style={{ padding: '7px 0', borderBottom: '1px solid var(--c-border)' }}>
                    <div style={{ fontSize: 13 }}>{op.comment ?? op.op_type}</div>
                    <div className="tile-meta">{fmtDateTime(op.created_at)}{op.created_by_email ? ` · ${op.created_by_email}` : ''}</div>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
