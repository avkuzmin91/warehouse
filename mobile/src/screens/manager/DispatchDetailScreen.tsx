import { useCallback, useEffect, useState } from 'react'
import { useNav } from '../../nav/NavContext'
import { useAuth } from '../../auth/AuthContext'
import {
  cancelDispatch,
  returnDispatchToDraft,
  dispatchPriorityLabel,
  dispatchPriorityTone,
  getDispatch,
  getDispatchReservations,
  updateDispatchPriority,
  DISPATCH_STATUS_LABELS,
  dispatchStatusTone,
  type DispatchDetail,
  type DispatchStatus,
} from '../../api/dispatchApi'
import { getPlannableItems, type PlannableItem } from '../../api/balancesApi'
import { AppBar } from '../../components/AppBar'
import { ConfirmAction } from '../../components/ConfirmAction'
import { LineFiles } from '../../components/LineFiles'
import { PrioritySheet } from '../../components/PrioritySheet'
import { Icon } from '../../components/Icon'
import { CollapsibleSection } from '../../components/CollapsibleSection'
import { canCreateDocuments } from '../../utils/access'
import { balanceKey } from '../../utils/balanceKey'
import { lineStockChips } from '../../utils/stockChips'
import { fmtDate, fmtDateTime } from '../../utils/format'

// Зеркало DISPATCH_CANCELLABLE_STATUSES (config.py): пока ничего не уехало.
const CANCELLABLE = new Set<DispatchStatus>(['draft', 'preparing', 'awaiting_trip'])
// Зеркало DISPATCH_RETURNABLE_STATUSES (config.py): возврат в черновик до первого рейса.
const RETURNABLE = new Set<DispatchStatus>(['awaiting_packing', 'preparing', 'awaiting_trip'])
const PRIORITY_FINAL = new Set<DispatchStatus>(['shipped', 'partially_shipped', 'cancelled'])

export function DispatchDetailScreen({ docId }: { docId: string }) {
  const { back, openDispatchEdit, openDispatchPrepare } = useNav()
  const { user } = useAuth()
  const canEdit = canCreateDocuments(user?.role)
  const [doc, setDoc] = useState<DispatchDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Доступность под строкой (свободно/резерв/склад/в пути) — только в черновике.
  const [plannable, setPlannable] = useState<PlannableItem[]>([])
  const [reservedMap, setReservedMap] = useState<Record<string, number>>({})
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [confirmReturn, setConfirmReturn] = useState(false)
  const [priorityOpen, setPriorityOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [actionErr, setActionErr] = useState('')

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

  const showAvail = doc?.status === 'draft'
  useEffect(() => {
    if (!doc || !showAvail || !doc.client_id) { setPlannable([]); setReservedMap({}); return }
    const ac = new AbortController()
    Promise.all([
      getPlannableItems({ client_id: doc.client_id, cargo_type: doc.cargo_type, limit: 500 }, ac.signal),
      getDispatchReservations({ client_id: doc.client_id, cargo_type: doc.cargo_type }, ac.signal).catch(() => ({ items: [] })),
    ])
      .then(([pl, rv]) => {
        if (ac.signal.aborted) return
        setPlannable(pl.items)
        const m: Record<string, number> = {}
        for (const r of rv.items) m[balanceKey(r)] = r.reserved
        setReservedMap(m)
      })
      .catch(() => {})
    return () => ac.abort()
  }, [doc, showAvail])

  async function runAction(fn: () => Promise<unknown>) {
    if (saving) return
    setSaving(true)
    setActionErr('')
    setConfirmCancel(false)
    setConfirmReturn(false)
    try {
      await fn()
      load()
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : 'Не удалось выполнить действие')
    } finally {
      setSaving(false)
    }
  }

  const tone = doc ? dispatchStatusTone(doc.status) : ''
  const plannableByKey = new Map(plannable.map((p) => [balanceKey(p), p]))
  const cancellable = doc ? CANCELLABLE.has(doc.status) : false
  const returnable = doc ? RETURNABLE.has(doc.status) : false
  const priorityEditable = doc ? !PRIORITY_FINAL.has(doc.status) : false
  const priorityTone = doc ? dispatchPriorityTone(doc.priority_rank) : ''

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
              <div className="kv"><span className="k">Приоритет</span>
                <span className="v" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  {priorityTone
                    ? <span className={`badge ${priorityTone}`}><span className="dot" />{dispatchPriorityLabel(doc.priority_rank)}</span>
                    : dispatchPriorityLabel(doc.priority_rank)}
                  {canEdit && priorityEditable && (
                    <button className="btn ghost sm auto" aria-label="Изменить приоритет" onClick={() => setPriorityOpen(true)}>
                      <Icon name="edit" size={13} />
                    </button>
                  )}
                </span>
              </div>
              <div className="kv"><span className="k">Отгрузка (план)</span><span className="v">{fmtDate(doc.ship_date)}</span></div>
              <div className="kv"><span className="k">Отгрузка (факт)</span><span className="v">{fmtDate(doc.actual_ship_date)}</span></div>
              {doc.logistics_cost != null && (
                <div className="kv"><span className="k">Логистика</span><span className="v mono">{doc.logistics_cost} ₽</span></div>
              )}
              {doc.trips.length > 0 && (
                <div className="kv"><span className="k">Рейсы</span><span className="v">{doc.trips.map((t) => t.number).join(', ')}</span></div>
              )}
              {doc.comment && (<div className="kv"><span className="k">Тех. задание</span><span className="v">{doc.comment}</span></div>)}
            </div>

            <div className="sec">Строки<span className="sec-count">{doc.lines.length}</span></div>
            <div className="line" style={{ padding: '2px 14px' }}>
              {doc.lines.map((l) => (
                <div key={l.id} className="docline">
                  <div className="docline-main">
                    <div className="tile-title" style={{ fontSize: 14 }}>{l.product_name}</div>
                    <div className="tile-meta">{[l.product_sku, l.color_name, l.size_name].filter(Boolean).join(' · ')}{l.store_name ? ` · ${l.store_name}` : ''}</div>
                    {showAvail && (
                      <div className="stock-row">
                        {lineStockChips(plannableByKey.get(balanceKey(l)), { source: 'dispatch', cargoType: doc.cargo_type, reserved: reservedMap[balanceKey(l)] ?? 0 }).map((c) => (
                          <span key={c.label} className={`badge ${c.tone}`}>{c.label} <b>{c.value}</b></span>
                        ))}
                      </div>
                    )}
                    <LineFiles files={l.files} onError={setActionErr} />
                  </div>
                  <div className="docline-qty">
                    <div className="big">{l.qty} шт</div>
                    {l.shipped_qty > 0 && <div className="small">отгружено {l.shipped_qty}</div>}
                  </div>
                </div>
              ))}
            </div>

            {doc.status === 'draft' && canEdit && (
              <button className="btn" style={{ marginTop: 16 }} onClick={() => openDispatchEdit(doc.id)}>
                <Icon name="edit" size={15} /> Редактировать черновик
              </button>
            )}

            {doc.status === 'preparing' && canEdit && (
              <button className="btn" style={{ marginTop: 16 }} onClick={() => openDispatchPrepare(doc.id)}>
                <Icon name="forklift" size={15} /> Собрать отгрузку
              </button>
            )}

            {canEdit && (cancellable || returnable) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
                {actionErr && (
                  <div className="alert"><Icon name="alert" size={15} />{actionErr}</div>
                )}
                {returnable && (
                  <ConfirmAction
                    label={<><Icon name="arrowLeft" size={16} /> Вернуть на корректировку</>}
                    prompt={doc.status === 'awaiting_trip'
                      ? 'Отгрузка вернётся в черновик, подготовка отменится: товар вернётся на исходные места. Состав и файлы сохранятся.'
                      : 'Отгрузка вернётся в черновик для правки состава. Задача у склада будет снята.'}
                    confirmLabel="Да, вернуть"
                    saving={saving}
                    open={confirmReturn}
                    onOpen={() => setConfirmReturn(true)}
                    onClose={() => setConfirmReturn(false)}
                    onConfirm={() => void runAction(() => returnDispatchToDraft(doc.id))}
                  />
                )}
                {cancellable && <ConfirmAction
                  danger
                  label={<><Icon name="x" size={16} /> Аннулировать отгрузку</>}
                  prompt={doc.status === 'awaiting_trip'
                    ? 'Подготовленный товар вернётся на исходные места, отгрузка будет аннулирована. Продолжить?'
                    : 'Аннулировать отгрузку? Действие необратимо.'}
                  confirmLabel="Да, аннулировать"
                  saving={saving}
                  open={confirmCancel}
                  onOpen={() => setConfirmCancel(true)}
                  onClose={() => setConfirmCancel(false)}
                  onConfirm={() => void runAction(() => cancelDispatch(doc.id))}
                />}
              </div>
            )}

            {doc.ops.length > 0 && (
              <CollapsibleSection title="История" count={doc.ops.length} style={{ marginTop: 16 }}>
                <div className="line" style={{ padding: '2px 14px' }}>
                  {doc.ops.map((op) => (
                    <div key={op.id} className="oprow">
                      <div className="oprow-t">{op.comment ?? op.op_type}</div>
                      <div className="oprow-m">{fmtDateTime(op.created_at)}{op.created_by_email ? ` · ${op.created_by_email}` : ''}</div>
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            )}
          </>
        )}
      </div>

      {priorityOpen && doc && (
        <PrioritySheet
          current={doc.priority_rank}
          onClose={() => setPriorityOpen(false)}
          onSave={async (rank) => {
            await updateDispatchPriority(doc.id, rank)
            setPriorityOpen(false)
            load()
          }}
        />
      )}
    </div>
  )
}
