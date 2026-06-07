import { request } from './http'
import { getReceipts, isReceiptOverdue, type ReceiptListItem } from './receiptsApi'
import { isShipmentOverdue, listShipments, type ShipmentListItem } from './shipmentsApi'

// --- Types ---

export type DashboardTodayStats = {
  receipt_docs: number
  accepted: number
  shipped: number
  defects: number
}

export type DashboardTodayResponse = {
  today: DashboardTodayStats
  yesterday: DashboardTodayStats
}

export type OperationalPlanItem = {
  type: 'receipt' | 'shipment'
  id: string
  doc_number: string
  status: string
  date: string | null
  date_kind: 'arrival' | 'ship'
  client_name: string | null
  destination: string | null
  sku_count: number
  total_qty: number
  progress_qty: number | null
  overdue: boolean
  priority: 'overdue' | 'today' | 'active' | 'upcoming' | 'no_date'
  exception: string | null
}

export type OperationalPlanResponse = {
  receipts: OperationalPlanItem[]
  shipments: OperationalPlanItem[]
  exceptions: OperationalPlanItem[]
  totals: {
    receipts: number
    shipments: number
    overdue: number
  }
}

// --- API functions ---

export function getDashboardToday(signal?: AbortSignal) {
  return request<DashboardTodayResponse>('/dashboard/today', { signal })
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDaysIso(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function priority(date: string | null, active = false): OperationalPlanItem['priority'] {
  if (!date) return 'no_date'
  const today = todayIso()
  if (date < today) return 'overdue'
  if (date === today) return 'today'
  if (active) return 'active'
  return 'upcoming'
}

function priorityRank(item: OperationalPlanItem): [number, string, string] {
  const ranks: Record<OperationalPlanItem['priority'], number> = {
    overdue: 0,
    today: 1,
    active: 2,
    upcoming: 3,
    no_date: 4,
  }
  return [ranks[item.priority] ?? 9, item.date ?? '9999-12-31', item.doc_number]
}

function comparePlanItems(a: OperationalPlanItem, b: OperationalPlanItem): number {
  const ar = priorityRank(a)
  const br = priorityRank(b)
  return ar[0] - br[0] || ar[1].localeCompare(br[1]) || ar[2].localeCompare(br[2])
}

function exceptionFor(item: OperationalPlanItem): string | null {
  if (item.priority === 'overdue') return 'Просрочен плановый срок'
  if (item.priority === 'no_date') return 'Не указана плановая дата'
  if (item.type === 'shipment' && item.priority === 'today' && (item.progress_qty ?? 0) === 0) {
    return 'Сегодня к отгрузке, упаковка не начата'
  }
  return null
}

function receiptToPlanItem(item: ReceiptListItem): OperationalPlanItem {
  return {
    type: 'receipt',
    id: item.id,
    doc_number: item.doc_number,
    status: item.status,
    date: item.arrival_date,
    date_kind: 'arrival',
    client_name: item.client_name,
    destination: null,
    sku_count: item.sku_count,
    total_qty: item.total_planned,
    progress_qty: item.total_accepted_qty,
    overdue: isReceiptOverdue(item),
    priority: priority(item.arrival_date, item.status === 'on_intake'),
    exception: null,
  }
}

function shipmentToPlanItem(item: ShipmentListItem): OperationalPlanItem {
  return {
    type: 'shipment',
    id: item.id,
    doc_number: item.doc_number,
    status: item.status,
    date: item.ship_date,
    date_kind: 'ship',
    client_name: item.client_name,
    destination: item.destination,
    sku_count: item.sku_count,
    total_qty: item.total_qty,
    progress_qty: item.total_packed_qty ?? 0,
    overdue: isShipmentOverdue(item),
    priority: priority(item.ship_date),
    exception: null,
  }
}

function withinHorizon(item: OperationalPlanItem, horizonDays: number): boolean {
  return !item.date || item.date <= addDaysIso(horizonDays)
}

async function getOperationalPlanFallback(
  params: { limit?: number; horizon_days?: number },
  signal?: AbortSignal,
): Promise<OperationalPlanResponse> {
  const limit = params.limit ?? 8
  const horizonDays = params.horizon_days ?? 7
  const [plannedReceipts, intakeReceipts, packingShipments] = await Promise.all([
    getReceipts({ status: 'planned', limit: 100 }, signal),
    getReceipts({ status: 'on_intake', limit: 100 }, signal),
    listShipments({ status: 'packing', limit: 100 }, signal),
  ])

  const receipts = [...plannedReceipts.items, ...intakeReceipts.items]
    .map(receiptToPlanItem)
    .filter((item) => withinHorizon(item, horizonDays))
    .sort(comparePlanItems)
  const shipments = packingShipments.items
    .map(shipmentToPlanItem)
    .filter((item) => withinHorizon(item, horizonDays))
    .sort(comparePlanItems)
  const exceptions = [...receipts, ...shipments]
    .map((item) => ({ ...item, exception: exceptionFor(item) }))
    .filter((item) => item.exception)
    .sort(comparePlanItems)

  return {
    receipts: receipts.slice(0, limit),
    shipments: shipments.slice(0, limit),
    exceptions: exceptions.slice(0, limit),
    totals: {
      receipts: receipts.length,
      shipments: shipments.length,
      overdue: [...receipts, ...shipments].filter((item) => item.overdue).length,
    },
  }
}

export async function getOperationalPlan(params: { limit?: number; horizon_days?: number } = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.horizon_days !== undefined) sp.set('horizon_days', String(params.horizon_days))
  const q = sp.toString()
  try {
    return await request<OperationalPlanResponse>(`/dashboard/operational-plan${q ? `?${q}` : ''}`, { signal })
  } catch {
    return getOperationalPlanFallback(params, signal)
  }
}
