import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  cancelTrip,
  closeTrip,
  getTrip,
  handoffTrip,
  linkTripReceipts,
  tripArrival,
  tripCost,
  tripUnload,
  unlinkTripReceipt,
  updateTripExecution,
  updateTrip,
} from '../../../api/tripsApi'
import type { TripDetail, TripLoadFactor } from '../../../api/tripsApi'
import { getReceipts, createReceipt, advanceReceiptStatus } from '../../../api/receiptsApi'
import type { ReceiptListItem } from '../../../api/receiptsApi'
import type { CreateReceiptFormValue } from './tripDetail/components/CreateReceiptForm'
import { useConfirm } from '../../feedback/ConfirmDialog'
import { Alert } from '../../primitives/Alert'
import { useLookups } from '../../../hooks/useLookups'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { canViewCosts } from '../../../utils/access'
import { isDateTimeComplete, isDateTimeBefore } from './components/fields'
import type { PlanningFormValue } from './tripDetail/PlanningForm'
import type { CostForm } from './tripDetail/views/CostingView'
import type { ReceiptLink, ReceiptEnrich } from './tripDetail/ReceiptsBlock'
import type { Check } from './tripDetail/panels'
import { PlanningView } from './tripDetail/views/PlanningView'
import { AwaitingView } from './tripDetail/views/AwaitingView'
import { InWarehouseView } from './tripDetail/views/InWarehouseView'
import { CostingView } from './tripDetail/views/CostingView'
import { ClosedView } from './tripDetail/views/ClosedView'

const CAN_LINK = new Set(['draft', 'awaiting_arrival'])

function fmtDay(d: string | null): string | undefined {
  if (!d) return undefined
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return d
  return dt.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })
}

const EMPTY_FORM: PlanningFormValue = {
  origin_id: '', carrier_id: '', vehicle_type_id: '',
  transport_ordered_at: '', eta: '', cost_estimate: '', comment: '',
}

function todayYmd(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function TripDetailFeature({ tripId }: { tripId: string }) {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { warehouses, carriers, vehicleTypes } = useLookups()
  const { user } = useCurrentUser()
  const showCosts = canViewCosts(user)
  const canEditTransportPlanning = user?.role === 'admin' || user?.role === 'manager'
  const canEditCostingExecution = canEditTransportPlanning

  const [detail, setDetail] = useState<TripDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [form, setForm] = useState<PlanningFormValue>(EMPTY_FORM)
  const [cost, setCost] = useState<CostForm>({ logistics_cost_actual: '', waiting_cost: '', waiting_minutes: '' })
  const [loadFactor, setLoadFactor] = useState<TripLoadFactor>('full')
  const [arrival, setArrival] = useState<string>(todayYmd())
  const [unloadStart, setUnloadStart] = useState<string>('')
  const [unloadEnd, setUnloadEnd] = useState<string>('')
  const [available, setAvailable] = useState<ReceiptListItem[]>([])
  const [showBlockReasons, setShowBlockReasons] = useState(false)

  const load = useCallback(async () => {
    try {
      const d = await getTrip(tripId)
      setDetail(d)
      setForm({
        origin_id: d.doc.origin_id ?? '',
        carrier_id: d.doc.carrier_id ?? '',
        vehicle_type_id: d.doc.vehicle_type_id ?? '',
        transport_ordered_at: d.doc.transport_ordered_at ?? '',
        eta: d.doc.eta ?? '',
        cost_estimate: d.doc.cost_estimate != null ? String(d.doc.cost_estimate) : '',
        comment: d.doc.comment ?? '',
      })
      setCost({
        logistics_cost_actual: d.doc.logistics_cost_actual != null ? String(d.doc.logistics_cost_actual) : '',
        waiting_cost: d.doc.waiting_cost != null ? String(d.doc.waiting_cost) : '',
        waiting_minutes: d.doc.waiting_minutes != null ? String(d.doc.waiting_minutes) : '',
      })
      setLoadFactor(d.doc.load_factor ?? 'full')
      setArrival(d.doc.arrived_at ?? d.doc.eta ?? todayYmd())
      setUnloadStart(d.doc.unload_started_at ?? d.doc.arrived_at ?? '')
      setUnloadEnd(d.doc.unload_finished_at ?? '')
    } catch {
      setError('Рейс не найден')
    } finally {
      setLoading(false)
    }
  }, [tripId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!detail || !CAN_LINK.has(detail.doc.status)) return
    const ctrl = new AbortController()
    getReceipts({ status: 'planned', limit: 100, available_for_trip_id: tripId }, ctrl.signal)
      .then((res) => { if (!ctrl.signal.aborted) setAvailable(res.items) })
      .catch(() => {})
    return () => ctrl.abort()
  }, [detail])

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError('')
    try {
      await fn()
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setBusy(false)
    }
  }

  const saveFields = () => {
    const origin = warehouses.find((w) => w.id === form.origin_id)
    const carrier = carriers.find((c) => c.id === form.carrier_id)
    const vehicle = vehicleTypes.find((v) => v.id === form.vehicle_type_id)
    return updateTrip(tripId, {
      origin_id: form.origin_id || null,
      origin_name: origin?.name ?? null,
      carrier_id: form.carrier_id || null,
      carrier_name: carrier?.name ?? null,
      vehicle_type_id: form.vehicle_type_id || null,
      vehicle_type_name: vehicle?.name ?? null,
      transport_ordered_at: form.transport_ordered_at || null,
      eta: form.eta || null,
      ...(showCosts ? { cost_estimate: form.cost_estimate.trim() ? Number(form.cost_estimate) : null } : {}),
      comment: form.comment.trim() || null,
    })
  }

  const saveCost = () => tripCost(tripId, {
    logistics_cost_actual: cost.logistics_cost_actual.trim() ? Number(cost.logistics_cost_actual) : null,
    waiting_cost: cost.waiting_cost.trim() ? Number(cost.waiting_cost) : null,
    waiting_minutes: cost.waiting_minutes.trim() ? Number(cost.waiting_minutes) : null,
  })
  const saveExecution = () => updateTripExecution(tripId, {
    arrived_at: arrival || null,
    unload_started_at: unloadStart || null,
    unload_finished_at: unloadEnd || null,
    load_factor: loadFactor,
  })

  const onField = (patch: Partial<PlanningFormValue>) => setForm((f) => ({ ...f, ...patch }))
  const onCostField = (patch: Partial<CostForm>) => setCost((c) => ({ ...c, ...patch }))

  const etaBeforeOrder = isDateTimeBefore(form.eta, form.transport_ordered_at)
  const requiredErrors: Partial<Record<keyof PlanningFormValue, boolean>> = {
    origin_id: !form.origin_id,
    carrier_id: !form.carrier_id,
    vehicle_type_id: !form.vehicle_type_id,
    cost_estimate: showCosts && form.cost_estimate.trim() === '',
    transport_ordered_at: !isDateTimeComplete(form.transport_ordered_at),
    eta: !isDateTimeComplete(form.eta) || etaBeforeOrder,
  }
  const handoffBlockReasons: string[] = [
    ...(requiredErrors.origin_id ? ['Не указано «Откуда»'] : []),
    ...(requiredErrors.carrier_id ? ['Не выбран перевозчик'] : []),
    ...(requiredErrors.vehicle_type_id ? ['Не выбран тип кузова'] : []),
    ...(showCosts && requiredErrors.cost_estimate ? ['Не указана стоимость логистики (план)'] : []),
    ...(requiredErrors.transport_ordered_at ? ['Не указано «Транспорт заказан»'] : []),
    ...(!isDateTimeComplete(form.eta) ? ['Не указано плановое прибытие'] : []),
    ...(etaBeforeOrder ? ['Плановое прибытие раньше заказа транспорта'] : []),
    ...((detail?.receipts.length ?? 0) === 0 ? ['Не привязано ни одного поступления'] : []),
  ]

  const handleSaveFields = () => run(saveFields)
  const handleSaveCost = () => run(saveCost)
  const handleSaveExecution = () => run(saveExecution)
  const handleHandoff = () => {
    if (handoffBlockReasons.length > 0) { setShowBlockReasons(true); return }
    setShowBlockReasons(false)
    return run(async () => { await saveFields(); await handoffTrip(tripId) })
  }
  const handleArrival = () => run(() => tripArrival(tripId, arrival))
  const handleUnload = () => run(() => tripUnload(tripId, {
    unload_started_at: unloadStart || null,
    unload_finished_at: unloadEnd || null,
    load_factor: loadFactor,
  }))

  async function handleClose() {
    const ok = await confirm({ title: 'Закрыть рейс?', body: 'Стоимость будет сохранена, рейс перейдёт в статус «Закрыт».', confirmLabel: 'Закрыть рейс' })
    if (!ok) return
    await run(async () => { await saveCost(); await closeTrip(tripId) })
  }

  async function handleCancel() {
    const ok = await confirm({ title: 'Аннулировать рейс?', body: 'Это действие нельзя отменить.', danger: true, confirmLabel: 'Аннулировать' })
    if (!ok) return
    await run(() => cancelTrip(tripId))
  }

  async function runThrowing(fn: () => Promise<unknown>) {
    setBusy(true)
    setError('')
    try {
      await fn()
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка')
      throw e
    } finally {
      setBusy(false)
    }
  }

  const handleLink = (receiptIds: string[]) =>
    runThrowing(() => linkTripReceipts(tripId, receiptIds))

  const handleCreate = (f: CreateReceiptFormValue) =>
    runThrowing(async () => {
      const res = await createReceipt({
        client_id: f.client_id,
        supplier_name: f.supplier_name.trim() || null,
        arrival_date: f.arrival_date || null,
        ttn: f.ttn.trim() || null,
        zone_id: f.zone_id || null,
        zone_name: f.zone_name || null,
        comment: f.comment.trim() || null,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        lines: f.lines.map(({ _id, ...l }) => l),
      })
      const docId = res.message
      await advanceReceiptStatus(docId)
      await linkTripReceipts(tripId, [docId])
    })

  const handleUnlink = (receiptDocId: string) => run(() => unlinkTripReceipt(tripId, receiptDocId))

  if (loading) {
    return <div className="page"><div style={{ padding: '80px 0', textAlign: 'center', color: 'var(--c-text-subtle)' }}>Загрузка…</div></div>
  }
  if (!detail) {
    return <div className="page"><div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--c-danger)' }}>{error || 'Рейс не найден'}</div></div>
  }

  const { doc, receipts } = detail
  const status = doc.status
  const onBack = () => navigate('/logistics/trips')
  const onOpenReceipt = (id: string) => navigate(`/inventory/receipts/${id}`)

  const linkedIds = new Set(receipts.map((r) => r.receipt_doc_id))
  const link: ReceiptLink = {
    options: available.filter((r) => !linkedIds.has(r.id)),
    tripNumber: doc.trip_number,
    tripOrigin: doc.origin_name,
    onLink: handleLink,
    onCreate: handleCreate,
    onUnlink: handleUnlink,
    busy,
  }

  // SKU/шт/прибытие для уже привязанных поступлений берём из кандидатов «В плане»
  // (после разгрузки они уходят в on_intake и в кандидатах их нет — сабтайтл сократится).
  const enrich: ReceiptEnrich = {}
  for (const a of available) enrich[a.id] = { sku: a.sku_count, qty: a.total_planned, eta: fmtDay(a.arrival_date) }

  const checks: Check[] = [
    { ok: !!form.origin_id, label: 'Откуда указано' },
    { ok: !!form.carrier_id, label: 'Перевозчик указан' },
    { ok: !!form.vehicle_type_id, label: 'Тип кузова указан' },
    ...(showCosts ? [{ ok: form.cost_estimate.trim() !== '', label: 'Стоимость (план) указана' }] : []),
    { ok: !requiredErrors.transport_ordered_at, label: 'Транспорт заказан' },
    { ok: isDateTimeComplete(form.eta), label: 'Плановое прибытие указано' },
    ...(etaBeforeOrder ? [{ ok: false, label: 'Прибытие не раньше заказа транспорта' }] : []),
    { ok: receipts.length > 0, label: `Поступлений: ${receipts.length}` },
  ]

  const dirtyCost =
    cost.logistics_cost_actual !== (doc.logistics_cost_actual != null ? String(doc.logistics_cost_actual) : '') ||
    cost.waiting_cost !== (doc.waiting_cost != null ? String(doc.waiting_cost) : '') ||
    cost.waiting_minutes !== (doc.waiting_minutes != null ? String(doc.waiting_minutes) : '')

  let view
  if (status === 'draft') {
    view = (
      <PlanningView
        detail={detail} form={form} onField={onField} link={link} enrich={enrich} busy={busy} checks={checks}
        showCosts={showCosts}
        canEditTransportPlanning={canEditTransportPlanning}
        invalid={showBlockReasons ? requiredErrors : undefined}
        blockReasons={showBlockReasons ? handoffBlockReasons : []}
        onBack={onBack} onCancel={handleCancel} onHandoff={handleHandoff} onOpenReceipt={onOpenReceipt}
      />
    )
  } else if (status === 'awaiting_arrival' || status === 'unloading') {
    const isWarehouseTaskView = user?.role === 'warehouse_manager'
    view = (
      isWarehouseTaskView ? (
        <AwaitingView
          detail={detail} loadFactor={loadFactor} onLoadFactor={setLoadFactor} busy={busy} enrich={enrich}
          arrival={arrival} onArrivalChange={setArrival}
          unloadStart={unloadStart} onUnloadStartChange={setUnloadStart}
          unloadEnd={unloadEnd} onUnloadEndChange={setUnloadEnd}
          onBack={onBack} onArrival={handleArrival} onUnload={handleUnload} onOpenReceipt={onOpenReceipt}
        />
      ) : (
        <InWarehouseView
          detail={detail} form={form} onField={onField}
          showCosts={showCosts}
          canEditTransportPlanning={canEditTransportPlanning}
          link={status === 'awaiting_arrival' ? link : undefined}
          enrich={enrich}
          loadFactor={loadFactor} onLoadFactor={setLoadFactor}
          arrival={arrival} onArrivalChange={setArrival}
          unloadStart={unloadStart} onUnloadStartChange={setUnloadStart}
          unloadEnd={unloadEnd} onUnloadEndChange={setUnloadEnd}
          busy={busy} onBack={onBack} onCancel={handleCancel}
          onSaveFields={handleSaveFields} onArrival={handleArrival} onUnload={handleUnload}
          onOpenReceipt={onOpenReceipt}
        />
      )
    )
  } else if (status === 'costing') {
    view = (
      <CostingView
        detail={detail} form={form} onField={onField} cost={cost} onCost={onCostField}
        showCosts={showCosts}
        canEditTransportPlanning={canEditTransportPlanning}
        canEditExecution={canEditCostingExecution}
        dirtyCost={dirtyCost} onSaveCost={handleSaveCost} onSaveFields={handleSaveFields}
        arrival={arrival} onArrivalChange={setArrival}
        unloadStart={unloadStart} onUnloadStartChange={setUnloadStart}
        unloadEnd={unloadEnd} onUnloadEndChange={setUnloadEnd}
        loadFactor={loadFactor} onLoadFactor={setLoadFactor} onSaveExecution={handleSaveExecution}
        busy={busy} onBack={onBack} onCancel={handleCancel} onClose={handleClose} onOpenReceipt={onOpenReceipt}
      />
    )
  } else {
    view = <ClosedView detail={detail} showCosts={showCosts} onBack={onBack} onOpenReceipt={onOpenReceipt} />
  }

  return (
    <>
      {error && (
        <div style={{ position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, maxWidth: 520 }}>
          <Alert tone="danger" icon={false}>{error}</Alert>
        </div>
      )}
      {view}
    </>
  )
}
