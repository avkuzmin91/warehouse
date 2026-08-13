import { useEffect, useState } from 'react'
import { getScanContext, type ScanContextDoc } from '../api/scanApi'
import { getTasks } from '../api/tasksApi'
import { RECEIPT_STATUS_LABELS, type ReceiptStatus } from '../api/receiptsApi'
import { SHIPMENT_STATUS_LABELS, type ShipmentStatus } from '../api/shipmentsApi'
import { DISPATCH_STATUS_LABELS, type DispatchStatus } from '../api/dispatchApi'
import { useAuth } from '../auth/AuthContext'
import { useNav, type PackFocus } from '../nav/NavContext'
import { canRecordPacking } from '../utils/access'
import { Icon } from './Icon'

// Блок «Участие в живых документах» для справочника скана (товар и место). В основном
// read-only: показывает, в каких незавершённых документах задействован объект, и
// подсвечивает совпадения с личной очередью (/tasks) бейджем «Моя задача». Единственный
// переход — задача упаковки «На упаковке» для упаковочных ролей: тап открывает карточку
// внесения годного/брака (со скана товара — сразу к его строке через packFocus).

const GROUP_TITLE: Record<ScanContextDoc['doc_type'], string> = {
  receipt: 'Поступления',
  shipment: 'Задачи упаковки',
  dispatch: 'Отгрузки',
}
const GROUP_ORDER: ScanContextDoc['doc_type'][] = ['receipt', 'shipment', 'dispatch']

function statusLabel(d: ScanContextDoc): string {
  if (d.doc_type === 'receipt') return RECEIPT_STATUS_LABELS[d.status as ReceiptStatus] ?? d.status
  if (d.doc_type === 'shipment') return SHIPMENT_STATUS_LABELS[d.status as ShipmentStatus] ?? d.status
  return DISPATCH_STATUS_LABELS[d.status as DispatchStatus] ?? d.status
}

function qtyLabel(d: ScanContextDoc): string {
  if (d.planned_qty == null) return ''
  if (d.doc_type === 'receipt') return `План ${d.planned_qty} · принято ${d.done_qty ?? 0} шт`
  const done = d.done_qty ?? 0
  return done > 0 ? `${d.planned_qty} шт · отгружено ${done}` : `${d.planned_qty} шт`
}

export function ScanDocsBlock({
  variantId,
  locationId,
  packFocus,
}: {
  variantId?: string
  locationId?: string
  packFocus?: PackFocus
}) {
  const { user } = useAuth()
  const { openPackDoc } = useNav()
  const packer = canRecordPacking(user?.role)
  const [docs, setDocs] = useState<ScanContextDoc[]>([])
  const [mine, setMine] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!variantId && !locationId) return
    const ac = new AbortController()
    setLoading(true)
    setError('')
    Promise.all([
      getScanContext({ variantId, locationId }, ac.signal),
      getTasks({ limit: 100 }, ac.signal).catch(() => ({ items: [], total: 0 })),
    ])
      .then(([ctx, tasks]) => {
        if (ac.signal.aborted) return
        setDocs(ctx.documents)
        setMine(new Set(tasks.items.map((t) => t.doc_id)))
      })
      .catch((err) => {
        if (!ac.signal.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить документы')
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false)
      })
    return () => ac.abort()
  }, [variantId, locationId])

  return (
    <>
      <div className="sec">Участие в документах</div>

      {error && (
        <div className="alert">
          <Icon name="alert" size={15} />
          {error}
        </div>
      )}

      {loading ? (
        <div className="line-sub" style={{ padding: '8px 2px' }}>Загрузка…</div>
      ) : docs.length === 0 && !error ? (
        <div className="line-sub" style={{ padding: '8px 2px' }}>Нет активных документов</div>
      ) : (
        GROUP_ORDER.map((type) => {
          const group = docs.filter((d) => d.doc_type === type)
          if (group.length === 0) return null
          return (
            <div key={type}>
              <div className="line-sub" style={{ margin: '10px 2px 4px', fontWeight: 600 }}>
                {GROUP_TITLE[type]}
              </div>
              {group.map((d) => {
                const qty = qtyLabel(d)
                const packable = packer && d.doc_type === 'shipment' && d.status === 'on_packing'
                const body = (
                  <>
                    <div className="line-name mono">{d.doc_number}</div>
                    <div className="pills">
                      <span className="pill">{statusLabel(d)}</span>
                      {d.cargo_type === 'defect' && <span className="pill defect">Брак</span>}
                      {mine.has(d.doc_id) && (
                        <span className="badge">
                          <span className="dot" />
                          Моя задача
                        </span>
                      )}
                      {packable && (
                        <span className="badge warning">
                          <span className="dot" />
                          Внести
                        </span>
                      )}
                    </div>
                    {qty && <div className="line-sub">{qty}</div>}
                  </>
                )
                if (packable) {
                  return (
                    <button
                      className="line"
                      key={d.doc_id}
                      style={{ width: '100%', textAlign: 'left' }}
                      onClick={() => openPackDoc(d.doc_id, packFocus)}
                    >
                      {body}
                    </button>
                  )
                }
                return (
                  <div className="line" key={d.doc_id}>
                    {body}
                  </div>
                )
              })}
            </div>
          )
        })
      )}
    </>
  )
}
