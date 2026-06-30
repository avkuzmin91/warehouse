import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createTrip, handoffTrip, tripLexicon, isOutbound, linkTripDispatches, linkTripReceipts } from '../../../api/tripsApi'
import type { TripReceiptItem, TripReceiptLinkItem, TripDispatchItem, TripDispatchLinkItem, TripDirection, TripCargoType } from '../../../api/tripsApi'
import { getReceipts, RECEIPT_TRIP_SELECTABLE_STATUSES } from '../../../api/receiptsApi'
import type { ReceiptListItem } from '../../../api/receiptsApi'
import { MOSCOW_TZ, parseMoscow, moscowTodayYmd } from '../../../utils/format'
import { listDispatches, DISPATCH_TRIP_SELECTABLE_STATUSES } from '../../../api/dispatchApi'
import type { DispatchListItem } from '../../../api/dispatchApi'
import { Icon } from '../../primitives/Icon'
import { Alert } from '../../primitives/Alert'
import { useLookups } from '../../../hooks/useLookups'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { canCreateDocuments, canViewCosts } from '../../../utils/access'
import { isDateTimeComplete, isDateTimeBefore } from './components/dateTimeValue'
import { PlanningForm } from './tripDetail/PlanningForm'
import type { PlanningFormValue } from './tripDetail/PlanningForm'
import { ProcessPanel, ReadyChecklist } from './tripDetail/panels'
import type { Check } from './tripDetail/panels'
import { ReceiptsBlock } from './tripDetail/ReceiptsBlock'
import type { ReceiptLink, ReceiptEnrich } from './tripDetail/ReceiptsBlock'
import { DispatchesBlock } from './tripDetail/DispatchesBlock'
import type { DispatchLink, DispatchEnrich } from './tripDetail/DispatchesBlock'

const EMPTY_FORM: PlanningFormValue = {
  origin_id: '', carrier_id: '', vehicle_type_id: '',
  vehicle_number: '', transport_ordered_at: '', eta: '', cost_estimate: '', comment: '',
}

// «Транспорт заказан» — момент создания карточки (МСК, дата+время); «Плановое прибытие»
// — та же дата без времени (время кладовщик уточняет позже).
function initialForm(): PlanningFormValue {
  const day = moscowTodayYmd()
  const time = new Date().toLocaleTimeString('en-GB', {
    timeZone: MOSCOW_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })
  return { ...EMPTY_FORM, transport_ordered_at: `${day}T${time}`, eta: day }
}

function fmtDay(d: string | null): string | undefined {
  if (!d) return undefined
  const dt = parseMoscow(d)
  if (Number.isNaN(dt.getTime())) return d
  return dt.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', timeZone: MOSCOW_TZ })
}

export function TripCreateFeature({ direction = 'inbound', cargoType = 'good' }: { direction?: TripDirection; cargoType?: TripCargoType }) {
  const navigate = useNavigate()
  const { warehouses, carriers, vehicleTypes } = useLookups()
  const { user } = useCurrentUser()
  const showCosts = canViewCosts(user)
  const canCreate = canCreateDocuments(user)
  const outbound = isOutbound(direction)
  const defect = outbound && cargoType === 'defect'
  const lex = tripLexicon(direction)

  const [form, setForm] = useState<PlanningFormValue>(initialForm)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [shipDist, setShipDist] = useState<TripDispatchLinkItem[]>([])
  const [recvDist, setRecvDist] = useState<TripReceiptLinkItem[]>([])
  const [available, setAvailable] = useState<ReceiptListItem[]>([])
  const [availableDispatches, setAvailableDispatches] = useState<DispatchListItem[]>([])
  // Отгрузки, найденные серверным поиском в модале (за пределами предзагруженных 100):
  // без них выбранная из поиска отгрузка не отрисуется карточкой в карточке создания.
  const [seenDispatches, setSeenDispatches] = useState<Record<string, DispatchListItem>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showBlockReasons, setShowBlockReasons] = useState(false)

  useEffect(() => {
    const ctrl = new AbortController()
    if (outbound) {
      // 'new' — несуществующий рейс: available_for_trip_id исключает только привязки
      // к ЭТОМУ рейсу (которого ещё нет) → в кандидаты попадают и документы, уже
      // распределённые по другим рейсам (дробление). cargo_type ограничивает типом груза.
      listDispatches({ status: DISPATCH_TRIP_SELECTABLE_STATUSES, limit: 100, available_for_trip_id: 'new', cargo_type: cargoType }, ctrl.signal)
        .then((res) => { if (!ctrl.signal.aborted) setAvailableDispatches(res.items) })
        .catch(() => {})
    } else {
      // Зеркально отгрузкам: «В плане» + «Частично принято» (остаток можно довезти
      // вторым рейсом). available_for_trip_id:'new' оставляет в кандидатах поступления,
      // уже привязанные к другим рейсам.
      getReceipts({ status: RECEIPT_TRIP_SELECTABLE_STATUSES, limit: 100, available_for_trip_id: 'new' }, ctrl.signal)
        .then((res) => { if (!ctrl.signal.aborted) setAvailable(res.items) })
        .catch(() => {})
    }
    return () => ctrl.abort()
  }, [outbound, cargoType])

  const onField = (patch: Partial<PlanningFormValue>) => setForm((f) => ({ ...f, ...patch }))

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

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
  const blockReasons: string[] = [
    ...(requiredErrors.origin_id ? [`Не указано «${lex.routeLabel}»`] : []),
    ...(requiredErrors.carrier_id ? ['Не выбран перевозчик'] : []),
    ...(requiredErrors.vehicle_type_id ? ['Не выбран тип кузова'] : []),
    ...(requiredErrors.vehicle_number ? ['Не указан гос. номер'] : []),
    ...(requiredErrors.cost_estimate ? ['Не указана стоимость логистики (план)'] : []),
    ...(requiredErrors.transport_ordered_at ? ['Не указано «Транспорт заказан»'] : []),
    ...(!isDateTimeComplete(form.eta) ? [`Не указано ${lex.etaLabel.toLowerCase()}`] : []),
    ...(etaBeforeOrder ? [`${lex.etaLabel} раньше заказа транспорта`] : []),
    ...(selected.size === 0 ? [outbound ? 'Не выбрано ни одной отгрузки' : 'Не выбрано ни одного поступления'] : []),
  ]

  const checks: Check[] = [
    { ok: !!form.origin_id, label: `${lex.routeLabel} указано` },
    { ok: !!form.carrier_id, label: 'Перевозчик указан' },
    { ok: !!form.vehicle_type_id, label: 'Тип кузова указан' },
    { ok: form.vehicle_number.trim() !== '', label: 'Гос. номер указан' },
    ...(showCosts ? [{ ok: form.cost_estimate.trim() !== '', label: 'Стоимость (план) указана' }] : []),
    { ok: !requiredErrors.transport_ordered_at, label: 'Транспорт заказан' },
    { ok: isDateTimeComplete(form.eta), label: `${lex.etaLabel} указано` },
    ...(etaBeforeOrder ? [{ ok: false, label: `${lex.arrivalLabel} не раньше заказа транспорта` }] : []),
    { ok: selected.size > 0, label: outbound ? `Отгрузок выбрано: ${selected.size}` : `Поступлений выбрано: ${selected.size}` },
  ]

  // Выбранные кандидаты показываем теми же карточками, что и привязанные в карточке рейса.
  // Количество «в рейс» берём из распределения модала (shipDist/recvDist), а не полный план.
  const recvDistQty = (id: string): number | undefined =>
    recvDist.find((it) => it.receipt_doc_id === id)?.allocations.reduce((s, a) => s + a.qty, 0)
  const shipDistQty = (id: string): number | undefined =>
    shipDist.find((it) => it.dispatch_doc_id === id)?.allocations.reduce((s, a) => s + a.qty, 0)
  const selectedReceipts: TripReceiptItem[] = available
    .filter((r) => selected.has(r.id))
    .map((r) => ({
      line_id: r.id, receipt_doc_id: r.id, receipt_number: r.doc_number,
      receipt_status: 'planned', client_id: r.client_id, client_name: r.client_name,
      allocated_qty: recvDistQty(r.id) ?? r.total_planned,
      received_qty: 0,
      // Пресеты для повторного открытия модала: достаточно line_id+qty (детали строк не показываем).
      allocations: (recvDist.find((it) => it.receipt_doc_id === r.id)?.allocations ?? []).map((a) => ({
        line_id: a.line_id, product_sku: null, product_name: null, variant: null,
        qty: a.qty, planned_qty: 0, accepted_qty: 0, received_qty: 0,
        storage_zone_id: null, storage_zone_name: null,
      })),
    }))
  // Пул всех известных отгрузок: предзагруженные + найденные поиском.
  const dispatchById: Record<string, DispatchListItem> = {}
  for (const s of availableDispatches) dispatchById[s.id] = s
  for (const id in seenDispatches) dispatchById[id] = seenDispatches[id]

  const selectedDispatches: TripDispatchItem[] = [...selected]
    .map((id) => dispatchById[id])
    .filter((s): s is DispatchListItem => !!s)
    .map((s) => ({
      line_id: s.id, dispatch_doc_id: s.id, dispatch_number: s.doc_number,
      dispatch_status: s.status, client_id: s.client_id, client_name: s.client_name,
      allocated_qty: shipDistQty(s.id) ?? s.total_qty,
      allocations: (shipDist.find((it) => it.dispatch_doc_id === s.id)?.allocations ?? []).map((a) => ({
        line_id: a.line_id, product_sku: null, product_name: null, variant: null,
        qty: a.qty, line_qty: 0, shipped_qty: 0,
      })),
    }))

  const enrich: ReceiptEnrich = {}
  for (const r of available) enrich[r.id] = { sku: r.sku_count, qty: r.total_planned, eta: fmtDay(r.arrival_date) }
  const dispatchEnrich: DispatchEnrich = {}
  for (const id in dispatchById) dispatchEnrich[id] = { sku: dispatchById[id].sku_count, qty: dispatchById[id].total_qty }

  // Модал распределения отдаёт строки с количествами; рейс ещё не создан, поэтому
  // распределение копим локально и применяем при создании (linkTrip* после createTrip).
  const saveShipDist = async (items: TripDispatchLinkItem[]) => {
    setShipDist(items)
    setSelected(new Set(items.map((it) => it.dispatch_doc_id)))
  }
  const saveRecvDist = async (items: TripReceiptLinkItem[]) => {
    setRecvDist(items)
    setSelected(new Set(items.map((it) => it.receipt_doc_id)))
  }

  const link: ReceiptLink = {
    options: available.filter((r) => !selected.has(r.id)),
    tripNumber: '— новый —',
    tripOrigin: warehouses.find((w) => w.id === form.origin_id)?.name ?? null,
    onLink: saveRecvDist,
    onUnlink: (id) => toggle(id),
    onSaveDistribution: saveRecvDist,
    presetsLinked: false,
    busy: false,
  }
  const dispatchLink: DispatchLink = {
    options: availableDispatches.filter((s) => !selected.has(s.id)),
    tripNumber: '— новый —',
    tripDestination: warehouses.find((w) => w.id === form.origin_id)?.name ?? null,
    onLink: saveShipDist,
    onUnlink: (id) => toggle(id),
    onSaveDistribution: saveShipDist,
    searchCandidates: async (q, signal) => {
      const res = await listDispatches(
        { status: DISPATCH_TRIP_SELECTABLE_STATUSES, limit: 100, available_for_trip_id: 'new', cargo_type: cargoType, search: q },
        signal,
      )
      // Запоминаем найденные документы, чтобы выбранная из поиска отгрузка отрисовалась карточкой.
      setSeenDispatches((prev) => { const n = { ...prev }; for (const s of res.items) n[s.id] = s; return n })
      return res.items.filter((s) => !selected.has(s.id))
    },
    presetsLinked: false,
    busy: false,
  }

  function tripPayload() {
    const origin = warehouses.find((w) => w.id === form.origin_id)
    const carrier = carriers.find((c) => c.id === form.carrier_id)
    const vehicle = vehicleTypes.find((v) => v.id === form.vehicle_type_id)
    return {
      direction,
      ...(outbound ? { cargo_type: cargoType } : {}),
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
      ...(outbound ? { dispatch_doc_ids: [...selected] } : { receipt_doc_ids: [...selected] }),
    }
  }

  async function saveTrip({ handoff }: { handoff: boolean }) {
    setSaving(true)
    setError('')
    try {
      const res = await createTrip(tripPayload())
      // Применяем распределение по строкам поверх созданного рейса (link заменяет привязку целиком).
      if (outbound && shipDist.length) await linkTripDispatches(res.message, shipDist)
      if (!outbound && recvDist.length) await linkTripReceipts(res.message, recvDist)
      if (handoff) await handoffTrip(res.message)
      navigate(`/logistics/trips/${res.message}`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка')
      setSaving(false)
    }
  }

  const handleSaveDraft = () => saveTrip({ handoff: false })
  const handleHandoff = () => {
    if (blockReasons.length > 0) { setShowBlockReasons(true); return }
    setShowBlockReasons(false)
    saveTrip({ handoff: true })
  }

  if (!canCreate) {
    return (
      <div className="page">
        <div style={{ padding: 32, color: 'var(--c-text-subtle)' }}>Недостаточно прав для создания рейсов.</div>
      </div>
    )
  }

  return (
    <div className="page">
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16,
        paddingBottom: 16, marginBottom: 18, borderBottom: '1px solid var(--c-border)',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <button className="btn ghost icon sm" onClick={() => navigate(`/logistics/trips?dir=${direction}`)}><Icon name="arrowLeft" size={14} /></button>
            <span style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>{outbound ? (defect ? 'Новый рейс отгрузки брака' : 'Новый рейс отгрузки товара') : 'Новый рейс поступления'}</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' }}>Новый рейс</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <button className="btn" onClick={handleSaveDraft} disabled={saving}>
              <Icon name="save" size={14} />Сохранить черновик
            </button>
            {showCosts && (
              <button className="btn primary" onClick={handleHandoff} disabled={saving}>
                <Icon name="arrowRight" size={14} />Передать на склад
              </button>
            )}
          </div>
          {showBlockReasons && blockReasons.length > 0 && (
            <div className="block-reasons">
              {blockReasons.map((r, i) => (
                <div key={i}>· {r}</div>
              ))}
            </div>
          )}
        </div>
      </div>

      {error && <Alert tone="danger" icon={false} style={{ marginBottom: 16 }}>{error}</Alert>}

      <div className="split-360">
        <div className="col gap-16">
          <PlanningForm value={form} onChange={onField} state="active" showCosts={showCosts}
            invalid={showBlockReasons ? requiredErrors : undefined} routeLabel={lex.routeLabel} etaLabel={lex.etaLabel} />
          {outbound ? (
            <DispatchesBlock title={lex.docsTitle} dispatches={selectedDispatches} enrich={dispatchEnrich} link={dispatchLink} />
          ) : (
            <ReceiptsBlock receipts={selectedReceipts} enrich={enrich} link={link} />
          )}
        </div>

        <div className="col gap-16">
          <ProcessPanel status="draft" ops={[]} direction={direction} />
          <ReadyChecklist checks={checks} />
        </div>
      </div>
    </div>
  )
}
