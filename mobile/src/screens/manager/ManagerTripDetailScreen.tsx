import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNav } from '../../nav/NavContext'
import {
  getTrip,
  updateTrip,
  handoffTrip,
  linkTripReceipts,
  unlinkTripReceipt,
  linkTripDispatches,
  unlinkTripDispatch,
  tripCost,
  closeTrip,
  cancelTrip,
  tripLexicon,
  tripStatusLabel,
  TRIP_LOAD_LABELS,
  type TripDetail,
  type TripDoc,
} from '../../api/tripsApi'
import { getCarriers, getVehicleTypes, getWarehouses, type DictionaryItem } from '../../api/lookupsApi'
import { AppBar } from '../../components/AppBar'
import { ConfirmAction } from '../../components/ConfirmAction'
import { Icon } from '../../components/Icon'
import { CollapsibleSection } from '../../components/CollapsibleSection'
import { isDateTimeBefore, isDateTimeComplete } from '../../components/DateTimeField'
import { MOSCOW_TZ, parseMoscow, variantTitle, fmtDateTime } from '../../utils/format'
import { TripDocPickerSheet, type TripPickDoc } from './TripDocPickerSheet'
import { TripPlanningFields, type PlanningValue } from './TripPlanningFields'

const RECEIPT_STATUS: Record<string, { label: string; tone: string }> = {
  planned: { label: 'В плане', tone: '' },
  partially_received: { label: 'Частично принято', tone: 'warning' },
  done: { label: 'Поступил', tone: 'success' },
}
const DISPATCH_STATUS: Record<string, { label: string; tone: string }> = {
  preparing: { label: 'Подготовка', tone: 'info' },
  awaiting_trip: { label: 'Ожидает рейс', tone: 'info' },
  partially_shipped: { label: 'Частично', tone: 'warning' },
  shipped: { label: 'Отгружено', tone: 'success' },
  cancelled: { label: 'Аннулирован', tone: '' },
}

function fmtTime(v: string | null): string {
  if (!v) return '—'
  const d = parseMoscow(v)
  if (Number.isNaN(d.getTime())) return v
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: MOSCOW_TZ })
}

/** ISO → значение для DateTimeField (наивные стенные часы Москвы, YYYY-MM-DDTHH:mm). */
function isoToInput(iso: string | null): string {
  if (!iso) return ''
  const d = parseMoscow(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('sv-SE', { timeZone: MOSCOW_TZ }).replace(' ', 'T').slice(0, 16)
}

function docToPlanning(doc: TripDoc): PlanningValue {
  return {
    originId: doc.origin_id ?? '',
    carrierId: doc.carrier_id ?? '',
    vehicleTypeId: doc.vehicle_type_id ?? '',
    vehicleNumber: doc.vehicle_number ?? '',
    orderedAt: isoToInput(doc.transport_ordered_at),
    eta: isoToInput(doc.eta),
    costEstimate: doc.cost_estimate != null ? String(doc.cost_estimate) : '',
    comment: doc.comment ?? '',
  }
}

function lineTitle(a: { product_name: string | null; product_sku: string | null; variant: string | null }): string {
  return variantTitle(a.product_name ?? a.product_sku ?? 'Товар', [a.variant])
}

export function ManagerTripDetailScreen({ tripId }: { tripId: string }) {
  const { back } = useNav()
  const [detail, setDetail] = useState<TripDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [actionErr, setActionErr] = useState('')

  const [warehouses, setWarehouses] = useState<DictionaryItem[]>([])
  const [carriers, setCarriers] = useState<DictionaryItem[]>([])
  const [vehicleTypes, setVehicleTypes] = useState<DictionaryItem[]>([])

  // Черновик: редактируемая форма планирования (инициализируется из документа).
  const [form, setForm] = useState<PlanningValue | null>(null)
  const [initialForm, setInitialForm] = useState<string>('')
  // Costing: фактическая стоимость.
  const [logisticsCost, setLogisticsCost] = useState('')
  const [waitingCost, setWaitingCost] = useState('')
  const [waitingMinutes, setWaitingMinutes] = useState('')

  const [showPicker, setShowPicker] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)

  const load = useCallback(
    (signal?: AbortSignal) => {
      setLoading(true)
      setError('')
      getTrip(tripId, signal)
        .then((d) => {
          if (signal?.aborted) return
          setDetail(d)
          const planning = docToPlanning(d.doc)
          setForm(planning)
          setInitialForm(JSON.stringify(planning))
          setLogisticsCost(d.doc.logistics_cost_actual != null ? String(d.doc.logistics_cost_actual) : '')
          setWaitingCost(d.doc.waiting_cost != null ? String(d.doc.waiting_cost) : '')
          setWaitingMinutes(d.doc.waiting_minutes != null ? String(d.doc.waiting_minutes) : '')
        })
        .catch((err) => {
          if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить рейс')
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false)
        })
    },
    [tripId],
  )

  useEffect(() => {
    const ac = new AbortController()
    load(ac.signal)
    return () => ac.abort()
  }, [load])

  useEffect(() => {
    const ac = new AbortController()
    const active = (rows: DictionaryItem[]) => rows.filter((r) => r.is_active !== false && !r.is_deleted)
    Promise.all([getWarehouses(ac.signal), getCarriers(ac.signal), getVehicleTypes(ac.signal)])
      .then(([w, c, v]) => {
        if (ac.signal.aborted) return
        setWarehouses(active(w))
        setCarriers(active(c))
        setVehicleTypes(active(v))
      })
      .catch(() => {})
    return () => ac.abort()
  }, [])

  async function runAction(fn: () => Promise<unknown>) {
    if (saving) return
    setSaving(true)
    setActionErr('')
    try {
      await fn()
      load()
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : 'Не удалось выполнить действие')
    } finally {
      setSaving(false)
    }
  }

  const doc = detail?.doc
  const outbound = doc?.direction === 'outbound'
  const lex = doc ? tripLexicon(doc.direction) : null

  const onField = (patch: Partial<PlanningValue>) => setForm((f) => (f ? { ...f, ...patch } : f))
  const dirty = form != null && JSON.stringify(form) !== initialForm
  const etaBeforeOrder = !!form && isDateTimeBefore(form.eta, form.orderedAt)

  const costNum = (s: string) => (s.trim() === '' ? null : Number(s))

  // Гейт «Передать на склад» (зеркало backend handoff).
  const handoffReasons = useMemo<string[]>(() => {
    if (!form || !lex || !detail) return []
    const r: string[] = []
    if (!form.originId) r.push(`Не указано «${lex.routeLabel}»`)
    if (!form.carrierId) r.push('Не выбран перевозчик')
    if (!form.vehicleTypeId) r.push('Не выбран тип кузова')
    if (form.vehicleNumber.trim() === '') r.push('Не указан гос. номер')
    if (form.costEstimate.trim() === '') r.push('Не указана стоимость логистики (план)')
    if (!isDateTimeComplete(form.orderedAt)) r.push('Не указано «Транспорт заказан»')
    if (!isDateTimeComplete(form.eta)) r.push('Не указано плановое прибытие')
    if (etaBeforeOrder) r.push('Плановое прибытие раньше заказа транспорта')
    const linkedCount = outbound ? detail.dispatches.length : detail.receipts.length
    if (linkedCount === 0) r.push(outbound ? 'Привяжите хотя бы одну отгрузку' : 'Привяжите хотя бы одно поступление')
    return r
  }, [form, lex, detail, etaBeforeOrder, outbound])

  function savePlanning() {
    if (!form) return
    void runAction(() =>
      updateTrip(tripId, {
        origin_id: form.originId || null,
        origin_name: warehouses.find((w) => w.id === form.originId)?.name ?? null,
        carrier_id: form.carrierId || null,
        carrier_name: carriers.find((c) => c.id === form.carrierId)?.name ?? null,
        vehicle_type_id: form.vehicleTypeId || null,
        vehicle_type_name: vehicleTypes.find((v) => v.id === form.vehicleTypeId)?.name ?? null,
        vehicle_number: form.vehicleNumber.trim() || null,
        transport_ordered_at: form.orderedAt || null,
        eta: form.eta || null,
        cost_estimate: form.costEstimate.trim() ? Number(form.costEstimate) : null,
        comment: form.comment.trim() || null,
      }),
    )
  }

  function handleHandoff() {
    if (dirty) { setActionErr('Сначала сохраните изменения карточки'); return }
    if (handoffReasons.length) { setActionErr(handoffReasons[0]); return }
    void runAction(() => handoffTrip(tripId))
  }

  function addDocs(picked: TripPickDoc[]) {
    setShowPicker(false)
    const ids = picked.map((d) => d.id)
    if (ids.length === 0) return
    void runAction(() => (outbound ? linkTripDispatches(tripId, ids) : linkTripReceipts(tripId, ids)))
  }

  function unlinkDoc(docId: string) {
    void runAction(() => (outbound ? unlinkTripDispatch(tripId, docId) : unlinkTripReceipt(tripId, docId)))
  }

  function saveCost() {
    void runAction(() =>
      tripCost(tripId, {
        logistics_cost_actual: costNum(logisticsCost),
        waiting_cost: costNum(waitingCost),
        waiting_minutes: waitingMinutes.trim() === '' ? null : Math.max(0, Math.floor(Number(waitingMinutes))),
      }),
    )
  }

  const linkedDocIds = outbound
    ? (detail?.dispatches ?? []).map((d) => d.dispatch_doc_id)
    : (detail?.receipts ?? []).map((r) => r.receipt_doc_id)

  return (
    <div className="screen">
      <AppBar
        title={doc ? doc.trip_number : 'Рейс'}
        sub={doc ? `${outbound ? 'Отгрузка' : 'Приёмка'} · ${tripStatusLabel(doc.status, doc.direction)}` : undefined}
        onBack={back}
        noProfile
      />

      <div className="scroll pad-nav">
        {error && (
          <div className="alert">
            <Icon name="alert" size={15} />
            {error}
          </div>
        )}

        {loading && !detail ? (
          <div className="center" style={{ padding: '32px 0' }}>
            <div className="spin" />
            <div>Загрузка рейса…</div>
          </div>
        ) : !doc || !lex || !detail ? null : (
          <>
            {/* Чипы машины */}
            {(doc.vehicle_type_name || doc.carrier_name || doc.origin_name) && (
              <div className="chips">
                {doc.vehicle_type_name && <span className="pill"><Icon name="truck" size={14} /> {doc.vehicle_type_name}</span>}
                {doc.carrier_name && <span className="pill"><Icon name="user" size={14} /> {doc.carrier_name}</span>}
                {doc.origin_name && <span className="pill"><Icon name="map" size={14} /> {doc.origin_name}</span>}
                {doc.vehicle_number && <span className="pill accent"><Icon name="truck" size={14} /> {doc.vehicle_number}</span>}
              </div>
            )}

            {/* ── DRAFT: редактирование плана + привязка + передача на склад ── */}
            {doc.status === 'draft' && form && (
              <>
                <TripPlanningFields
                  value={form}
                  onChange={onField}
                  warehouses={warehouses}
                  carriers={carriers}
                  vehicleTypes={vehicleTypes}
                  routeLabel={lex.routeLabel}
                  etaLabel={lex.etaLabel}
                  etaInvalid={etaBeforeOrder}
                />
                {dirty && (
                  <button className="btn ghost" style={{ marginTop: 4 }} disabled={saving} onClick={savePlanning}>
                    <Icon name="check" size={15} /> Сохранить изменения
                  </button>
                )}

                <DocsSection
                  detail={detail}
                  outbound={outbound}
                  title={lex.docsTitle}
                  onUnlink={unlinkDoc}
                  onAdd={() => setShowPicker(true)}
                  saving={saving}
                />

                <ActionBar error={actionErr}>
                  <button className="btn" disabled={saving} onClick={handleHandoff}>
                    {saving ? <span className="spin spin-sm" /> : <><Icon name="arrowRight" size={18} /> Передать на склад</>}
                  </button>
                  <ConfirmAction
                    danger
                    label={<><Icon name="x" size={16} /> Отменить рейс</>}
                    prompt="Аннулировать рейс? Действие необратимо."
                    confirmLabel="Да, отменить"
                    saving={saving}
                    open={confirmCancel}
                    onOpen={() => setConfirmCancel(true)}
                    onClose={() => setConfirmCancel(false)}
                    onConfirm={() => { setConfirmCancel(false); void runAction(() => cancelTrip(tripId)) }}
                  />
                </ActionBar>
              </>
            )}

            {/* ── AWAITING / UNLOADING: менеджер только наблюдает ── */}
            {(doc.status === 'awaiting_arrival' || doc.status === 'unloading') && (
              <>
                <div className="infocard">
                  <div className="infocard-ico"><Icon name="clock" size={20} /></div>
                  <div className="infocard-body">
                    <div className="infocard-title">
                      {doc.status === 'unloading' ? lex.progressTitle : lex.awaitingMachineTitle}
                    </div>
                    <div className="infocard-sub">
                      {doc.status === 'unloading'
                        ? `${lex.unloadStartLabel} ${fmtTime(doc.unload_started_at ?? doc.arrived_at)}`
                        : `${lex.etaLabel}: ${fmtTime(doc.eta)}`}
                    </div>
                  </div>
                </div>
                <div className="line-sub" style={{ padding: '2px 0 8px' }}>
                  {lex.warehousePhase} выполняет склад. Менеджеру доступен просмотр и отмена рейса.
                </div>

                <PlanSummary doc={doc} lex={lex} />
                <DocsSection detail={detail} outbound={outbound} title={lex.docsInVehicle} />

                <ActionBar error={actionErr}>
                  <ConfirmAction
                    danger
                    label={<><Icon name="x" size={16} /> Отменить рейс</>}
                    prompt="Аннулировать рейс? Действие необратимо."
                    confirmLabel="Да, отменить"
                    saving={saving}
                    open={confirmCancel}
                    onOpen={() => setConfirmCancel(true)}
                    onClose={() => setConfirmCancel(false)}
                    onConfirm={() => { setConfirmCancel(false); void runAction(() => cancelTrip(tripId)) }}
                  />
                </ActionBar>
              </>
            )}

            {/* ── COSTING: внести фактическую стоимость и закрыть ── */}
            {doc.status === 'costing' && (
              <>
                <ExecutionSummary doc={doc} lex={lex} />

                <div className="sec" style={{ marginTop: 4 }}>Фактическая стоимость</div>
                <div className="field">
                  <div className="flabel">Логистика (факт), ₽</div>
                  <input className="input num" inputMode="numeric" placeholder="0" value={logisticsCost}
                    onChange={(e) => setLogisticsCost(e.target.value.replace(/[^\d]/g, ''))} />
                </div>
                <div className="field">
                  <div className="flabel">Простой, ₽</div>
                  <input className="input num" inputMode="numeric" placeholder="0" value={waitingCost}
                    onChange={(e) => setWaitingCost(e.target.value.replace(/[^\d]/g, ''))} />
                </div>
                <div className="field">
                  <div className="flabel">Простой, мин</div>
                  <input className="input num" inputMode="numeric" placeholder="0" value={waitingMinutes}
                    onChange={(e) => setWaitingMinutes(e.target.value.replace(/[^\d]/g, ''))} />
                </div>
                {doc.cost_estimate != null && (
                  <div className="line-sub" style={{ marginBottom: 8 }}>План логистики: {doc.cost_estimate} ₽</div>
                )}
                <button className="btn ghost" disabled={saving} onClick={saveCost}>
                  <Icon name="check" size={15} /> Сохранить стоимость
                </button>

                <DocsSection detail={detail} outbound={outbound} title={lex.docsTitle} />

                <ActionBar error={actionErr}>
                  <button className="btn" disabled={saving} onClick={() => void runAction(() => closeTrip(tripId))}>
                    {saving ? <span className="spin spin-sm" /> : <><Icon name="check" size={18} /> Закрыть рейс</>}
                  </button>
                  <ConfirmAction
                    danger
                    label={<><Icon name="x" size={16} /> Отменить рейс</>}
                    prompt="Аннулировать рейс? Действие необратимо."
                    confirmLabel="Да, отменить"
                    saving={saving}
                    open={confirmCancel}
                    onOpen={() => setConfirmCancel(true)}
                    onClose={() => setConfirmCancel(false)}
                    onConfirm={() => { setConfirmCancel(false); void runAction(() => cancelTrip(tripId)) }}
                  />
                </ActionBar>
              </>
            )}

            {/* ── CLOSED / CANCELLED: итог ── */}
            {(doc.status === 'closed' || doc.status === 'cancelled') && (
              <>
                <div className="infocard">
                  <div className="infocard-ico"><Icon name={doc.status === 'closed' ? 'check' : 'x'} size={20} /></div>
                  <div className="infocard-body">
                    <div className="infocard-title">{tripStatusLabel(doc.status, doc.direction)}</div>
                    <div className="infocard-sub">
                      {doc.status === 'closed' ? 'Рейс завершён и закрыт.' : 'Рейс аннулирован, движения остатков отменены.'}
                    </div>
                  </div>
                </div>
                <ExecutionSummary doc={doc} lex={lex} />
                <DocsSection detail={detail} outbound={outbound} title={lex.docsTitle} />
              </>
            )}

            {/* История операций */}
            {detail.ops.length > 0 && (
              <CollapsibleSection title="История" count={detail.ops.length} style={{ marginTop: 16 }}>
                <div className="line" style={{ padding: '2px 14px' }}>
                  {detail.ops.map((op) => (
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

      {showPicker && doc && (
        <TripDocPickerSheet
          direction={doc.direction}
          cargoType={doc.cargo_type}
          tripId={tripId}
          excludeIds={linkedDocIds}
          onConfirm={addDocs}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  )
}

function PlanSummary({ doc, lex }: { doc: TripDoc; lex: ReturnType<typeof tripLexicon> }) {
  return (
    <div className="summary" style={{ marginBottom: 12 }}>
      <div className="kv"><span className="k">{lex.routeLabel}</span><span className="v">{doc.origin_name ?? '—'}</span></div>
      <div className="kv"><span className="k">Перевозчик</span><span className="v">{doc.carrier_name ?? '—'}</span></div>
      <div className="kv"><span className="k">Транспорт заказан</span><span className="v">{fmtTime(doc.transport_ordered_at)}</span></div>
      <div className="kv"><span className="k">{lex.etaLabel}</span><span className="v">{fmtTime(doc.eta)}</span></div>
      {doc.cost_estimate != null && (
        <div className="kv"><span className="k">Логистика (план)</span><span className="v mono">{doc.cost_estimate} ₽</span></div>
      )}
      {doc.comment && <div className="kv"><span className="k">Комментарий</span><span className="v">{doc.comment}</span></div>}
    </div>
  )
}

function ExecutionSummary({ doc, lex }: { doc: TripDoc; lex: ReturnType<typeof tripLexicon> }) {
  const total = (doc.logistics_cost_actual ?? 0) + (doc.waiting_cost ?? 0)
  return (
    <div className="summary" style={{ marginBottom: 12 }}>
      <div className="kv"><span className="k">{lex.arrivalLabel}</span><span className="v">{fmtTime(doc.arrived_at)}</span></div>
      <div className="kv"><span className="k">{lex.unloadStartLabel}</span><span className="v">{fmtTime(doc.unload_started_at)}</span></div>
      <div className="kv"><span className="k">{lex.unloadEndLabel}</span><span className="v">{fmtTime(doc.unload_finished_at)}</span></div>
      {doc.load_factor && (
        <div className="kv"><span className="k">Загруженность</span><span className="v">{TRIP_LOAD_LABELS[doc.load_factor]}</span></div>
      )}
      {doc.cost_estimate != null && (
        <div className="kv"><span className="k">Логистика (план)</span><span className="v mono">{doc.cost_estimate} ₽</span></div>
      )}
      {doc.logistics_cost_actual != null && (
        <div className="kv"><span className="k">Логистика (факт)</span><span className="v mono">{doc.logistics_cost_actual} ₽</span></div>
      )}
      {doc.waiting_cost != null && doc.waiting_cost > 0 && (
        <div className="kv"><span className="k">Простой</span><span className="v mono">{doc.waiting_cost} ₽{doc.waiting_minutes ? ` · ${doc.waiting_minutes} мин` : ''}</span></div>
      )}
      {total > 0 && <div className="kv"><span className="k">Итого</span><span className="v mono">{total} ₽</span></div>}
    </div>
  )
}

/** Список привязанных документов рейса; с onUnlink/onAdd — режим редактирования (черновик). */
function DocsSection({ detail, outbound, title, onUnlink, onAdd, saving }: {
  detail: TripDetail
  outbound: boolean
  title: string
  onUnlink?: (docId: string) => void
  onAdd?: () => void
  saving?: boolean
}) {
  const count = outbound ? detail.dispatches.length : detail.receipts.length
  return (
    <>
      <div className="sec" style={{ marginTop: 4 }}>{title}<span className="sec-count">{count}</span></div>

      {count === 0 ? (
        <div className="line-sub" style={{ padding: '6px 0 10px' }}>
          {outbound ? 'Отгрузки ещё не привязаны.' : 'Поступления ещё не привязаны.'}
        </div>
      ) : !outbound ? (
        detail.receipts.map((r) => (
          <div key={r.line_id} className="group">
            <div className="group-head">
              <span className="gname">
                {r.receipt_number ?? 'Поступление'}{r.client_name ? ` · ${r.client_name}` : ''}
              </span>
              {r.receipt_status && RECEIPT_STATUS[r.receipt_status] && (
                <span className={`badge ${RECEIPT_STATUS[r.receipt_status].tone}`}>
                  <span className="dot" />{RECEIPT_STATUS[r.receipt_status].label}
                </span>
              )}
              {onUnlink && (
                <button className="icon-btn danger" disabled={saving} onClick={() => onUnlink(r.receipt_doc_id)} aria-label="Отвязать">
                  <Icon name="trash" size={14} />
                </button>
              )}
            </div>
            {r.allocations.length > 0 ? (
              r.allocations.map((a) => (
                <div key={a.line_id} className="line">
                  <div className="line-name">{lineTitle(a)}</div>
                  <div className="line-sub">план {a.qty} шт{a.received_qty > 0 ? ` · принято ${a.received_qty}` : ''}</div>
                </div>
              ))
            ) : (
              <div className="line"><div className="line-sub">{r.allocated_qty} шт</div></div>
            )}
          </div>
        ))
      ) : (
        detail.dispatches.map((s) => (
          <div key={s.line_id} className="group">
            <div className="group-head">
              <span className="gname">
                {s.dispatch_number ?? 'Отгрузка'}{s.client_name ? ` · ${s.client_name}` : ''}
              </span>
              {s.dispatch_status && DISPATCH_STATUS[s.dispatch_status] && (
                <span className={`badge ${DISPATCH_STATUS[s.dispatch_status].tone}`}>
                  <span className="dot" />{DISPATCH_STATUS[s.dispatch_status].label}
                </span>
              )}
              {onUnlink && (
                <button className="icon-btn danger" disabled={saving} onClick={() => onUnlink(s.dispatch_doc_id)} aria-label="Отвязать">
                  <Icon name="trash" size={14} />
                </button>
              )}
            </div>
            {s.allocations.length > 0 ? (
              s.allocations.map((a) => (
                <div key={a.line_id} className="line">
                  <div className="line-name">{lineTitle(a)}</div>
                  <div className="line-sub">увозит {a.qty} шт</div>
                </div>
              ))
            ) : (
              <div className="line"><div className="line-sub">{s.allocated_qty} шт</div></div>
            )}
          </div>
        ))
      )}

      {onAdd && (
        <button className="btn ghost" style={{ marginTop: 8 }} disabled={saving} onClick={onAdd}>
          <Icon name="plus" size={15} /> {outbound ? 'Добавить отгрузки' : 'Добавить поступления'}
        </button>
      )}
    </>
  )
}

function ActionBar({ error, children }: { error: string; children: ReactNode }) {
  return (
    <div className="actionbar">
      {error && (
        <div className="alert">
          <Icon name="alert" size={15} />
          {error}
        </div>
      )}
      {children}
    </div>
  )
}

