import { useCallback, useEffect, useState } from 'react'
import { useNav } from '../../nav/NavContext'
import { useAuth } from '../../auth/AuthContext'
import {
  cancelShipment,
  getShipment,
  returnShipmentToPacking,
  shipmentPriorityLabel,
  shipmentPriorityTone,
  updateShipmentPriority,
  SHIPMENT_REPACK_KIND_LABELS,
  SHIPMENT_STATUS_LABELS,
  type ReturnToPackingPayload,
  type ShipmentDetail,
  type ShipmentStatus,
} from '../../api/shipmentsApi'
import { getPlannableItems, type PlannableItem } from '../../api/balancesApi'
import { AppBar } from '../../components/AppBar'
import { ConfirmAction } from '../../components/ConfirmAction'
import { LineFiles } from '../../components/LineFiles'
import { PrioritySheet } from '../../components/PrioritySheet'
import { ReturnToPackingSheet } from '../../components/ReturnToPackingSheet'
import { Icon } from '../../components/Icon'
import { canCreateDocuments } from '../../utils/access'
import { balanceKey } from '../../utils/balanceKey'
import { lineStockChips } from '../../utils/stockChips'
import { fmtDate } from '../../utils/format'

const STATUS_TONE: Record<string, string> = {
  draft: '', packing: 'info', on_packing: 'warning', relocating: 'warning',
  completed_no_goods: 'success', cancelled: 'danger',
}

// Зеркала гейтов бэка (config.py): где документ ещё можно аннулировать / вернуть на
// упаковку / поменять приоритет. Финальную проверку всегда делает сервер.
const CANCELLABLE_GOOD = new Set<ShipmentStatus>(['draft', 'packing', 'on_packing'])
const CANCELLABLE_DEFECT = new Set<ShipmentStatus>(['draft', 'relocating'])
const RETURN_TO_PACKING = new Set<ShipmentStatus>(['relocating', 'packed'])
const PRIORITY_FINAL = new Set<ShipmentStatus>(['completed_no_goods', 'cancelled'])

export function PackingDetailScreen({ docId }: { docId: string }) {
  const { back, openPackingEdit } = useNav()
  const { user } = useAuth()
  const canEdit = canCreateDocuments(user?.role)
  const [doc, setDoc] = useState<ShipmentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Остаток «склад»/«в пути» под строкой — только в черновике (пока планируем).
  const [plannable, setPlannable] = useState<PlannableItem[]>([])
  const [confirmAct, setConfirmAct] = useState<'' | 'cancel'>('')
  const [priorityOpen, setPriorityOpen] = useState(false)
  const [returnOpen, setReturnOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [actionErr, setActionErr] = useState('')

  const load = useCallback((signal?: AbortSignal) => {
    setLoading(true)
    setError('')
    getShipment(docId, signal)
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
    if (!doc || !showAvail || !doc.client_id) { setPlannable([]); return }
    const ac = new AbortController()
    getPlannableItems({ client_id: doc.client_id, cargo_type: doc.cargo_type, limit: 500 }, ac.signal)
      .then((r) => { if (!ac.signal.aborted) setPlannable(r.items) })
      .catch(() => {})
    return () => ac.abort()
  }, [doc, showAvail])

  async function runAction(fn: () => Promise<unknown>) {
    if (saving) return
    setSaving(true)
    setActionErr('')
    setConfirmAct('')
    try {
      await fn()
      load()
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : 'Не удалось выполнить действие')
    } finally {
      setSaving(false)
    }
  }

  // Возврат «на упаковку»: режим (доработка / переупаковка без оплаты / за счёт
  // клиента) и force-ветку частичного возврата ведёт сама шторка ReturnToPackingSheet.
  async function handleReturn(payload: ReturnToPackingPayload) {
    if (!doc) return
    await returnShipmentToPacking(doc.id, payload)
    setReturnOpen(false)
    load()
  }

  const tone = doc ? (STATUS_TONE[doc.status] ?? '') : ''
  const plannableByKey = new Map(plannable.map((p) => [balanceKey(p), p]))
  const cancellable = doc
    ? (doc.cargo_type === 'defect' ? CANCELLABLE_DEFECT : CANCELLABLE_GOOD).has(doc.status)
    : false
  // Брак упаковку минует — возврат «на упаковку» только для годного груза.
  const returnable = doc ? doc.cargo_type === 'good' && RETURN_TO_PACKING.has(doc.status) : false
  const priorityEditable = doc ? !PRIORITY_FINAL.has(doc.status) : false
  const priorityTone = doc ? shipmentPriorityTone(doc.priority_rank) : ''

  return (
    <div className="screen">
      <AppBar title={doc ? doc.doc_number : 'Задача упаковки'} sub={doc ? SHIPMENT_STATUS_LABELS[doc.status] : ''} onBack={back} noProfile />
      <div className="scroll pad-nav">
        {error && (<div className="alert"><Icon name="alert" size={15} />{error}</div>)}
        {loading || !doc ? (
          !error && <div className="center" style={{ padding: '32px 0' }}><div className="spin" /></div>
        ) : (
          <>
            <div className="summary" style={{ marginBottom: 16 }}>
              <div className="kv"><span className="k">Статус</span>
                <span className="v">{tone ? <span className={`badge ${tone}`}><span className="dot" />{SHIPMENT_STATUS_LABELS[doc.status]}</span> : SHIPMENT_STATUS_LABELS[doc.status]}</span>
              </div>
              <div className="kv"><span className="k">Клиент</span><span className="v">{doc.client_name ?? '—'}</span></div>
              {doc.cargo_type === 'defect' && <div className="kv"><span className="k">Тип</span><span className="v">Брак</span></div>}
              {doc.repack_kind && (
                <div className="kv"><span className="k">Переупаковка</span>
                  <span className="v">
                    <span className="badge info"><span className="dot" />{SHIPMENT_REPACK_KIND_LABELS[doc.repack_kind]}</span>
                    {doc.repack_reason ? ` ${doc.repack_reason}` : ''}
                  </span>
                </div>
              )}
              <div className="kv"><span className="k">Приоритет</span>
                <span className="v" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  {priorityTone
                    ? <span className={`badge ${priorityTone}`}><span className="dot" />{shipmentPriorityLabel(doc.priority_rank)}</span>
                    : shipmentPriorityLabel(doc.priority_rank)}
                  {canEdit && priorityEditable && (
                    <button className="btn ghost sm auto" aria-label="Изменить приоритет" onClick={() => setPriorityOpen(true)}>
                      <Icon name="edit" size={13} />
                    </button>
                  )}
                </span>
              </div>
              <div className="kv"><span className="k">Упаковка (план)</span><span className="v">{fmtDate(doc.ship_date)}</span></div>
              {doc.comment && (<div className="kv"><span className="k">ТЗ</span><span className="v">{doc.comment}</span></div>)}
            </div>

            <div className="sec">Строки<span className="sec-count">{doc.lines.length}</span></div>
            <div className="line" style={{ padding: '2px 14px' }}>
              {doc.lines.map((l) => (
                <div key={l.id} className="docline">
                  <div className="docline-main">
                    <div className="tile-title" style={{ fontSize: 14 }}>{l.product_name}</div>
                    <div className="tile-meta">{[l.product_sku, l.color_name, l.size_name].filter(Boolean).join(' · ')}{l.store_name ? ` · ${l.store_name}` : ''}</div>
                    {(l.packed_good > 0 || l.packed_defect > 0) && (
                      <div className="tile-meta">упаковано: годный {l.packed_good} · брак {l.packed_defect}</div>
                    )}
                    {showAvail && (
                      <div className="stock-row">
                        {lineStockChips(plannableByKey.get(balanceKey(l)), { source: 'pack', cargoType: doc.cargo_type }).map((c) => (
                          <span key={c.label} className={`badge ${c.tone}`}>{c.label} <b>{c.value}</b></span>
                        ))}
                      </div>
                    )}
                    <LineFiles files={l.files} onError={setActionErr} />
                  </div>
                  <div className="docline-qty">
                    <div className="big">{l.qty} шт</div>
                  </div>
                </div>
              ))}
            </div>

            {doc.status === 'draft' && canEdit && (
              <button className="btn" style={{ marginTop: 16 }} onClick={() => openPackingEdit(doc.id)}>
                <Icon name="edit" size={15} /> Редактировать черновик
              </button>
            )}

            {canEdit && (returnable || cancellable) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
                {actionErr && (
                  <div className="alert"><Icon name="alert" size={15} />{actionErr}</div>
                )}
                {returnable && (
                  <button className="btn ghost" disabled={saving} onClick={() => setReturnOpen(true)}>
                    <Icon name="refresh" size={16} /> Вернуть на упаковку
                  </button>
                )}
                {cancellable && (
                  <ConfirmAction
                    danger
                    label={<><Icon name="x" size={16} /> Аннулировать задачу</>}
                    prompt="Аннулировать задачу упаковки? Действие необратимо."
                    confirmLabel="Да, аннулировать"
                    saving={saving}
                    open={confirmAct === 'cancel'}
                    onOpen={() => setConfirmAct('cancel')}
                    onClose={() => setConfirmAct('')}
                    onConfirm={() => void runAction(() => cancelShipment(doc.id))}
                  />
                )}
              </div>
            )}
          </>
        )}
      </div>

      {returnOpen && doc && (
        <ReturnToPackingSheet
          docNumber={doc.doc_number}
          isPacked={doc.status === 'packed'}
          onClose={() => setReturnOpen(false)}
          onSubmit={handleReturn}
        />
      )}

      {priorityOpen && doc && (
        <PrioritySheet
          current={doc.priority_rank}
          onClose={() => setPriorityOpen(false)}
          onSave={async (rank) => {
            await updateShipmentPriority(doc.id, rank)
            setPriorityOpen(false)
            load()
          }}
        />
      )}
    </div>
  )
}
