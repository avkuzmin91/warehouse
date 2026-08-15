import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBackNav } from '../../../hooks/useBackNav'
import {
  cancelTrip,
  closeTrip,
  getTrip,
  handoffTrip,
  linkTripReceipts,
  linkTripDispatches,
  tripArrival,
  tripCost,
  tripUnload,
  unlinkTripReceipt,
  unlinkTripDispatch,
  updateTripExecution,
  updateTrip,
  updateTripCarrier,
  isOutbound,
  tripLexicon,
} from '../../../api/tripsApi'
import type { TripDetail, TripLoadFactor, TripDispatchLinkItem, TripReceiptLinkItem, TripUnloadReceiptLine } from '../../../api/tripsApi'
import { UnloadReceiveTable } from './tripDetail/components/UnloadReceiveTable'
import type { ReceivePlacement } from './tripDetail/components/UnloadReceiveTable'
import { MOSCOW_TZ, parseMoscow } from '../../../utils/format'
import { getReceipts, createReceipt, advanceReceiptStatus, RECEIPT_TRIP_SELECTABLE_STATUSES } from '../../../api/receiptsApi'
import type { ReceiptListItem } from '../../../api/receiptsApi'
import { listDispatches, DISPATCH_TRIP_SELECTABLE_STATUSES } from '../../../api/dispatchApi'
import type { DispatchListItem } from '../../../api/dispatchApi'
import type { CreateReceiptFormValue } from './tripDetail/components/CreateReceiptForm'
import { useConfirm } from '../../feedback/ConfirmDialog'
import { Alert } from '../../primitives/Alert'
import { useLookups } from '../../../hooks/useLookups'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { canCorrectReceived, canViewCosts } from '../../../utils/access'
import { isDateTimeComplete, isDateTimeBefore } from './components/dateTimeValue'
import type { PlanningFormValue } from './tripDetail/PlanningForm'
import type { CostForm } from './tripDetail/views/CostingView'
import { ReceiptsBlock } from './tripDetail/ReceiptsBlock'
import type { ReceiptLink, ReceiptEnrich } from './tripDetail/ReceiptsBlock'
import { CorrectReceiveDrawer } from './tripDetail/components/CorrectReceiveDrawer'
import { DispatchesBlock } from './tripDetail/DispatchesBlock'
import type { DispatchLink, DispatchEnrich } from './tripDetail/DispatchesBlock'
import type { Check } from './tripDetail/panels'
import { PlanningView } from './tripDetail/views/PlanningView'
import { AwaitingView } from './tripDetail/views/AwaitingView'
import { InWarehouseView } from './tripDetail/views/InWarehouseView'
import { CostingView } from './tripDetail/views/CostingView'
import { ClosedView } from './tripDetail/views/ClosedView'

const CAN_LINK = new Set(['draft', 'awaiting_arrival'])

function fmtDay(d: string | null): string | undefined {
  if (!d) return undefined
  const dt = parseMoscow(d)
  if (Number.isNaN(dt.getTime())) return d
  return dt.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', timeZone: MOSCOW_TZ })
}

const EMPTY_FORM: PlanningFormValue = {
  origin_id: '', carrier_id: '', vehicle_type_id: '',
  vehicle_number: '', transport_ordered_at: '', eta: '', cost_estimate: '', comment: '',
}

function todayYmd(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function TripDetailFeature({ tripId }: { tripId: string }) {
  const navigate = useNavigate()
  const goBack = useBackNav('/logistics/trips')
  const confirm = useConfirm()
  const { warehouses, carriers, vehicleTypes, unloadingZones } = useLookups()
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
  const [loadFactor, setLoadFactor] = useState<TripLoadFactor | ''>('')
  const [arrival, setArrival] = useState<string>(todayYmd())
  const [unloadStart, setUnloadStart] = useState<string>('')
  const [unloadEnd, setUnloadEnd] = useState<string>('')
  // Приёмка inbound-рейса по строкам: раскладка принятого по ячейкам (кол-во + место).
  // По умолчанию одна ячейка на всю аллокацию рейса.
  const [placementsByLine, setPlacementsByLine] = useState<Record<string, ReceivePlacement[]>>({})
  const [available, setAvailable] = useState<ReceiptListItem[]>([])
  const [availableDispatches, setAvailableDispatches] = useState<DispatchListItem[]>([])
  const [showBlockReasons, setShowBlockReasons] = useState(false)
  const [correctOpen, setCorrectOpen] = useState(false)

  const outbound = isOutbound(detail?.doc.direction)
  const lex = tripLexicon(detail?.doc.direction)

  const load = useCallback(async () => {
    try {
      const d = await getTrip(tripId)
      setDetail(d)
      setForm({
        origin_id: d.doc.origin_id ?? '',
        carrier_id: d.doc.carrier_id ?? '',
        vehicle_type_id: d.doc.vehicle_type_id ?? '',
        vehicle_number: d.doc.vehicle_number ?? '',
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
      setLoadFactor(d.doc.load_factor ?? '')
      setArrival(d.doc.arrived_at ?? d.doc.eta ?? todayYmd())
      setUnloadStart(d.doc.unload_started_at ?? d.doc.arrived_at ?? '')
      setUnloadEnd(d.doc.unload_finished_at ?? '')
      // Предзаполняем одну ячейку = вся аллокация рейса; место — из прошлой приёмки
      // строки (storage_zone_id), как в мобильном клиенте. Несуществующие/выключенные
      // зоны вычищает эффект-санация ниже; кладовщик правит вручную или мастер-ячейкой.
      const placements: Record<string, ReceivePlacement[]> = {}
      for (const r of d.receipts) {
        for (const a of r.allocations) {
          placements[a.line_id] = [{ qty: a.qty, zoneId: a.storage_zone_id ?? '' }]
        }
      }
      setPlacementsByLine(placements)
    } catch {
      setError('Рейс не найден')
    } finally {
      setLoading(false)
    }
  }, [tripId])

  useEffect(() => { void load() }, [load])

  // Санация предзаполненных ячеек: прошлое место строки могло быть удалено или
  // выключено в справочнике — такое очищаем, чтобы не провести приход в мёртвую зону.
  useEffect(() => {
    if (unloadingZones.length === 0) return
    const activeIds = new Set(unloadingZones.filter((z) => z.is_active && !z.is_deleted).map((z) => z.id))
    setPlacementsByLine((prev) => {
      let changed = false
      const next: Record<string, ReceivePlacement[]> = {}
      for (const [lineId, rows] of Object.entries(prev)) {
        if (rows.some((p) => p.zoneId && !activeIds.has(p.zoneId))) {
          changed = true
          next[lineId] = rows.map((p) => (p.zoneId && !activeIds.has(p.zoneId) ? { ...p, zoneId: '' } : p))
        } else {
          next[lineId] = rows
        }
      }
      return changed ? next : prev
    })
  }, [unloadingZones, detail])

  useEffect(() => {
    if (!detail || !CAN_LINK.has(detail.doc.status)) return
    const ctrl = new AbortController()
    if (isOutbound(detail.doc.direction)) {
      listDispatches({ status: DISPATCH_TRIP_SELECTABLE_STATUSES, limit: 100, available_for_trip_id: detail.doc.id, cargo_type: detail.doc.cargo_type }, ctrl.signal)
        .then((res) => { if (!ctrl.signal.aborted) setAvailableDispatches(res.items) })
        .catch(() => {})
    } else {
      getReceipts({ status: RECEIPT_TRIP_SELECTABLE_STATUSES, limit: 100, available_for_trip_id: detail.doc.id }, ctrl.signal)
        .then((res) => { if (!ctrl.signal.aborted) setAvailable(res.items) })
        .catch(() => {})
    }
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
      vehicle_number: form.vehicle_number.trim() || null,
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
    load_factor: loadFactor || null,
  })

  const onField = (patch: Partial<PlanningFormValue>) => setForm((f) => ({ ...f, ...patch }))
  const onCostField = (patch: Partial<CostForm>) => setCost((c) => ({ ...c, ...patch }))

  const etaBeforeOrder = isDateTimeBefore(form.eta, form.transport_ordered_at)
  const requiredErrors: Partial<Record<keyof PlanningFormValue, boolean>> = {
    origin_id: !form.origin_id,
    carrier_id: !form.carrier_id,
    vehicle_type_id: !form.vehicle_type_id,
    vehicle_number: form.vehicle_number.trim() === '',
    cost_estimate: showCosts && form.cost_estimate.trim() === '',
    transport_ordered_at: !isDateTimeComplete(form.transport_ordered_at),
    eta: !isDateTimeComplete(form.eta) || etaBeforeOrder,
  }
  const linkedDocsCount = outbound ? (detail?.dispatches.length ?? 0) : (detail?.receipts.length ?? 0)
  const handoffBlockReasons: string[] = [
    ...(requiredErrors.origin_id ? [`Не указано «${lex.routeLabel}»`] : []),
    ...(requiredErrors.carrier_id ? ['Не выбран перевозчик'] : []),
    ...(requiredErrors.vehicle_type_id ? ['Не выбран тип кузова'] : []),
    ...(requiredErrors.vehicle_number ? ['Не указан гос. номер'] : []),
    ...(showCosts && requiredErrors.cost_estimate ? ['Не указана стоимость логистики (план)'] : []),
    ...(requiredErrors.transport_ordered_at ? ['Не указано «Транспорт заказан»'] : []),
    ...(!isDateTimeComplete(form.eta) ? [`Не указано ${lex.etaLabel.toLowerCase()}`] : []),
    ...(etaBeforeOrder ? [`${lex.etaLabel} раньше заказа транспорта`] : []),
    ...(linkedDocsCount === 0 ? [outbound ? 'Не привязано ни одной отгрузки' : 'Не привязано ни одного поступления'] : []),
  ]

  const handleSaveFields = () => run(saveFields)
  const handleSaveExecution = () => run(saveExecution)
  const handleHandoff = () => {
    if (handoffBlockReasons.length > 0) { setShowBlockReasons(true); return }
    setShowBlockReasons(false)
    return run(async () => { await saveFields(); await handoffTrip(tripId) })
  }
  const handleArrival = () => run(() => tripArrival(tripId, arrival))

  function buildReceiptLines(): TripUnloadReceiptLine[] {
    const out: TripUnloadReceiptLine[] = []
    for (const r of detail?.receipts ?? []) {
      for (const a of r.allocations) {
        const rows = placementsByLine[a.line_id] ?? [{ qty: a.qty, zoneId: '' }]
        const placements = rows
          .filter((p) => p.qty > 0)
          .map((p) => {
            const zone = unloadingZones.find((z) => z.id === p.zoneId)
            return { storage_zone_id: p.zoneId || null, storage_zone_name: zone?.name ?? null, qty: p.qty }
          })
        const total = placements.reduce((s, p) => s + p.qty, 0)
        out.push({
          line_id: a.line_id,
          accepted_qty: total,
          storage_zone_id: placements[0]?.storage_zone_id ?? null,
          storage_zone_name: placements[0]?.storage_zone_name ?? null,
          placements,
        })
      }
    }
    return out
  }

  const handleUnload = () => run(() => tripUnload(tripId, {
    unload_started_at: unloadStart || null,
    unload_finished_at: unloadEnd || null,
    load_factor: loadFactor || null,
    ...(outbound ? {} : { receipt_lines: buildReceiptLines() }),
  }))

  async function handleClose() {
    const ok = await confirm({ title: 'Закрыть рейс?', body: 'Стоимость будет сохранена, рейс перейдёт в статус «Закрыт».', confirmLabel: 'Закрыть рейс' })
    if (!ok) return
    await run(async () => { await saveCost(); await closeTrip(tripId) })
  }

  async function handleChangeCarrier(carrierId: string) {
    const carrier = carriers.find((c) => c.id === carrierId)
    const ok = await confirm({
      title: 'Сменить перевозчика?',
      body: `Рейс и его логистический расход перейдут на «${carrier?.name ?? '—'}». Если расход уже оплачивается, смена будет отклонена.`,
      confirmLabel: 'Сменить',
    })
    if (!ok) return
    await run(() => updateTripCarrier(tripId, { carrier_id: carrierId, carrier_name: carrier?.name ?? null }))
  }

  async function handleCancel() {
    const moved = status === 'costing' || status === 'closed'
    const body = moved
      ? 'Остатки вернутся на склад, привязанные поступления/отгрузки откатятся, а логистический расход рейса будет снят. Если отгрузка уже в счёте или расход оплачен — аннулирование будет отклонено.'
      : 'Это действие нельзя отменить.'
    const ok = await confirm({ title: 'Аннулировать рейс?', body, danger: true, confirmLabel: 'Аннулировать' })
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

  const handleLink = (items: TripReceiptLinkItem[]) =>
    runThrowing(() => linkTripReceipts(tripId, items))

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
        lines: f.lines.map(({ _id, ...l }) => l),
      })
      const docId = res.message
      await advanceReceiptStatus(docId)
      await linkTripReceipts(tripId, [{ receipt_doc_id: docId, allocations: [] }])
    })

  const handleUnlink = (receiptDocId: string) => run(() => unlinkTripReceipt(tripId, receiptDocId))

  // Сохранение распределения из модала: привязка/замена выбранных + отвязка убранных, один reload.
  const handleSaveReceiptDistribution = (items: TripReceiptLinkItem[], removed: string[]) =>
    runThrowing(async () => {
      if (items.length) await linkTripReceipts(tripId, items)
      for (const id of removed) await unlinkTripReceipt(tripId, id)
    })

  const handleLinkDispatches = (items: TripDispatchLinkItem[]) =>
    runThrowing(() => linkTripDispatches(tripId, items))

  const handleSaveDispatchDistribution = (items: TripDispatchLinkItem[], removed: string[]) =>
    runThrowing(async () => {
      if (items.length) await linkTripDispatches(tripId, items)
      for (const id of removed) await unlinkTripDispatch(tripId, id)
    })
  const handleUnlinkDispatch = async (dispatchDocId: string) => {
    // В погрузке открепление необратимо: привязать отгрузку обратно к этому рейсу уже нельзя.
    if (detail?.doc.status === 'unloading') {
      const num = detail.dispatches.find((d) => d.dispatch_doc_id === dispatchDocId)?.dispatch_number
      const ok = await confirm({
        title: 'Открепить отгрузку от рейса?',
        body: `Отгрузка ${num ?? ''} не уедет этим рейсом. Привязать её обратно к рейсу будет нельзя.`,
        danger: true,
        confirmLabel: 'Открепить',
      })
      if (!ok) return
    }
    await run(() => unlinkTripDispatch(tripId, dispatchDocId))
  }

  if (loading) {
    return <div className="page"><div style={{ padding: '80px 0', textAlign: 'center', color: 'var(--c-text-subtle)' }}>Загрузка…</div></div>
  }
  if (!detail) {
    return <div className="page"><div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--c-danger)' }}>{error || 'Рейс не найден'}</div></div>
  }

  const { doc, receipts, dispatches } = detail
  const status = doc.status
  const onBack = goBack
  const onOpenReceipt = (id: string) => navigate(`/inventory/receipts/${id}`)
  const onOpenDispatch = (id: string) => navigate(`/inventory/dispatches/${id}`)

  const linkedIds = new Set(receipts.map((r) => r.receipt_doc_id))
  const link: ReceiptLink = {
    options: available.filter((r) => !linkedIds.has(r.id)),
    tripNumber: doc.trip_number,
    tripOrigin: doc.origin_name,
    onLink: handleLink,
    onCreate: handleCreate,
    onUnlink: handleUnlink,
    onSaveDistribution: handleSaveReceiptDistribution,
    presetsLinked: true,
    busy,
  }

  // SKU/шт/прибытие для уже привязанных поступлений берём из кандидатов «В плане»
  // (после разгрузки они уходят в partially_received/done и в кандидатах их нет — сабтайтл сократится).
  const enrich: ReceiptEnrich = {}
  for (const a of available) enrich[a.id] = { sku: a.sku_count, qty: a.total_planned, eta: fmtDay(a.arrival_date) }

  const linkedDispatchIds = new Set(dispatches.map((d) => d.dispatch_doc_id))
  const dispatchLink: DispatchLink = {
    options: availableDispatches.filter((d) => !linkedDispatchIds.has(d.id)),
    tripNumber: doc.trip_number,
    tripDestination: doc.origin_name,
    onLink: handleLinkDispatches,
    onUnlink: handleUnlinkDispatch,
    onSaveDistribution: handleSaveDispatchDistribution,
    searchCandidates: async (q, signal) => {
      const res = await listDispatches(
        { status: DISPATCH_TRIP_SELECTABLE_STATUSES, limit: 100, available_for_trip_id: doc.id, cargo_type: doc.cargo_type, search: q },
        signal,
      )
      return res.items.filter((d) => !linkedDispatchIds.has(d.id))
    },
    presetsLinked: true,
    busy,
  }
  const dispatchEnrich: DispatchEnrich = {}
  for (const d of availableDispatches) dispatchEnrich[d.id] = { sku: d.sku_count, qty: d.total_qty }

  // Корректировка обсчёта приёмки живёт в рейсе: разгруженный inbound-рейс,
  // менеджер / начальник склада. Правится «принято этим рейсом» по ячейкам.
  const canCorrectReceive = !outbound && canCorrectReceived(user)
    && (status === 'costing' || status === 'closed') && !!doc.unload_finished_at
    && receipts.length > 0

  /** Блок документов рейса по направлению; передаётся во view как docsNode. */
  const docsNode = outbound ? (
    <DispatchesBlock
      title={lex.docsTitle}
      dispatches={dispatches}
      enrich={dispatchEnrich}
      onOpen={onOpenDispatch}
      link={CAN_LINK.has(status) ? dispatchLink : undefined}
      onUnlink={status === 'unloading' && canEditTransportPlanning ? handleUnlinkDispatch : undefined}
      expandable
      resetKey={doc.id}
    />
  ) : (canCorrectReceive ? (
    <ReceiptsBlock
      receipts={receipts}
      onOpen={onOpenReceipt}
      expandable
      resetKey={doc.id}
      onCorrectReceive={() => setCorrectOpen(true)}
    />
  ) : undefined)

  // Приёмка inbound-рейса при разгрузке: таблица «принято + место» по строкам.
  const storageZones = unloadingZones.filter((z) => z.is_active && !z.is_deleted)
  const anyReceiveZoneMissing = !outbound && receipts.some((r) => r.allocations.some((a) => {
    const rows = placementsByLine[a.line_id] ?? []
    return rows.some((p) => p.qty > 0 && !p.zoneId)
  }))
  const receiveBlockReasons = (!outbound && status === 'unloading' && anyReceiveZoneMissing)
    ? ['Укажите место хранения по строкам приёмки']
    : []
  const receiveNode = (!outbound && status === 'unloading')
    ? (showErrors: boolean) => (
        <UnloadReceiveTable
          receipts={receipts}
          zones={storageZones}
          placementsByLine={placementsByLine}
          onPlacements={(lineId, rows) => setPlacementsByLine((p) => ({ ...p, [lineId]: rows }))}
          showErrors={showErrors}
        />
      )
    : undefined

  const checks: Check[] = [
    { ok: !!form.origin_id, label: `${lex.routeLabel} указано` },
    { ok: !!form.carrier_id, label: 'Перевозчик указан' },
    { ok: !!form.vehicle_type_id, label: 'Тип кузова указан' },
    { ok: form.vehicle_number.trim() !== '', label: 'Гос. номер указан' },
    ...(showCosts ? [{ ok: form.cost_estimate.trim() !== '', label: 'Стоимость (план) указана' }] : []),
    { ok: !requiredErrors.transport_ordered_at, label: 'Транспорт заказан' },
    { ok: isDateTimeComplete(form.eta), label: `${lex.etaLabel} указано` },
    ...(etaBeforeOrder ? [{ ok: false, label: `${lex.arrivalLabel} не раньше заказа транспорта` }] : []),
    { ok: linkedDocsCount > 0, label: outbound ? `Отгрузок: ${dispatches.length}` : `Поступлений: ${receipts.length}` },
  ]

  const dirtyFields =
    form.origin_id !== (doc.origin_id ?? '') ||
    form.carrier_id !== (doc.carrier_id ?? '') ||
    form.vehicle_type_id !== (doc.vehicle_type_id ?? '') ||
    form.vehicle_number !== (doc.vehicle_number ?? '') ||
    form.transport_ordered_at !== (doc.transport_ordered_at ?? '') ||
    form.eta !== (doc.eta ?? '') ||
    (showCosts && form.cost_estimate !== (doc.cost_estimate != null ? String(doc.cost_estimate) : '')) ||
    form.comment !== (doc.comment ?? '')

  let view
  if (status === 'draft') {
    view = (
      <PlanningView
        detail={detail} form={form} onField={onField} link={link} enrich={enrich} busy={busy} checks={checks}
        showCosts={showCosts}
        canEditTransportPlanning={canEditTransportPlanning}
        invalid={showBlockReasons ? requiredErrors : undefined}
        blockReasons={showBlockReasons ? handoffBlockReasons : []}
        dirtyFields={dirtyFields}
        onBack={onBack} onCancel={handleCancel} onSaveFields={handleSaveFields} onHandoff={handleHandoff} onOpenReceipt={onOpenReceipt}
        docsNode={docsNode}
      />
    )
  } else if (status === 'awaiting_arrival' || status === 'unloading') {
    const isWarehouseTaskView = user?.role === 'warehouse_manager' || user?.role === 'warehouse_head'
    view = (
      isWarehouseTaskView ? (
        <AwaitingView
          detail={detail} loadFactor={loadFactor} onLoadFactor={setLoadFactor} busy={busy} enrich={enrich}
          arrival={arrival} onArrivalChange={setArrival}
          unloadStart={unloadStart} onUnloadStartChange={setUnloadStart}
          unloadEnd={unloadEnd} onUnloadEndChange={setUnloadEnd}
          onBack={onBack} onArrival={handleArrival} onUnload={handleUnload} onOpenReceipt={onOpenReceipt}
          docsNode={docsNode}
          receiveNode={receiveNode}
          extraBlockReasons={receiveBlockReasons}
        />
      ) : (
        <InWarehouseView
          detail={detail} form={form} onField={onField}
          showCosts={showCosts}
          canEditTransportPlanning={canEditTransportPlanning}
          dirtyFields={dirtyFields}
          link={status === 'awaiting_arrival' ? link : undefined}
          enrich={enrich}
          loadFactor={loadFactor} onLoadFactor={setLoadFactor}
          arrival={arrival} onArrivalChange={setArrival}
          unloadStart={unloadStart} onUnloadStartChange={setUnloadStart}
          unloadEnd={unloadEnd} onUnloadEndChange={setUnloadEnd}
          busy={busy} onBack={onBack} onCancel={handleCancel}
          onSaveFields={handleSaveFields} onArrival={handleArrival} onUnload={handleUnload}
          onOpenReceipt={onOpenReceipt}
          docsNode={docsNode}
          receiveNode={receiveNode}
          extraBlockReasons={receiveBlockReasons}
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
        onSaveFields={handleSaveFields}
        arrival={arrival} onArrivalChange={setArrival}
        unloadStart={unloadStart} onUnloadStartChange={setUnloadStart}
        unloadEnd={unloadEnd} onUnloadEndChange={setUnloadEnd}
        loadFactor={loadFactor} onLoadFactor={setLoadFactor} onSaveExecution={handleSaveExecution}
        busy={busy} onBack={onBack} onCancel={handleCancel} onClose={handleClose} onOpenReceipt={onOpenReceipt}
        docsNode={docsNode}
      />
    )
  } else {
    const carrierEdit = user?.role === 'admin' && status === 'closed'
      ? { carriers, currentId: doc.carrier_id, onSave: handleChangeCarrier, busy }
      : undefined
    const closedCancel = status === 'closed' && canEditTransportPlanning ? handleCancel : undefined
    view = <ClosedView detail={detail} showCosts={showCosts} onBack={onBack} onOpenReceipt={onOpenReceipt} docsNode={docsNode} carrierEdit={carrierEdit} onCancel={closedCancel} busy={busy} />
  }

  return (
    <>
      {error && (
        <div style={{ position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, maxWidth: 520 }}>
          <Alert tone="danger" icon={false}>{error}</Alert>
        </div>
      )}
      {view}
      {canCorrectReceive && (
        <CorrectReceiveDrawer
          key={correctOpen ? 'open' : 'closed'}
          tripId={tripId}
          receipts={receipts}
          zones={storageZones}
          open={correctOpen}
          onClose={() => setCorrectOpen(false)}
          onSaved={async () => { setCorrectOpen(false); await load() }}
        />
      )}
    </>
  )
}
