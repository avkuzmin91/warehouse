import type { InventoryOperationItem, InventoryOpType } from '../api'

/** Календарная дата YYYY-MM-DD в локальном часовом поясе браузера. */
export function localCalendarYmdFromDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Локальный календарный день для момента времени из ISO-строки (без смещения «в UTC-день» —
 * используются getFullYear/getMonth/getDate в зоне пользователя).
 */
export function calendarYmdFromIsoInLocalTz(iso: string): string | null {
  const d = new Date(iso.trim())
  if (Number.isNaN(d.getTime())) return null
  return localCalendarYmdFromDate(d)
}

/**
 * Просрочка ожидающей операции: календарная дата операции строго раньше сегодняшнего дня (локально).
 */
export function isPendingInventoryOperationOverdue(operationIsoDate: string, now: Date = new Date()): boolean {
  const opYmd = calendarYmdFromIsoInLocalTz(operationIsoDate)
  if (!opYmd) return false
  const todayYmd = localCalendarYmdFromDate(now)
  return opYmd < todayYmd
}

export type InventoryOpListRowPresentation = {
  className?: string
  /** Подсказка для просроченной ожидающей операции */
  title?: string
}

/**
 * Единая визуальная логика строк списков поступлений и отгрузок (только UI).
 * Приоритет: принят/отгружен → зелёный; ожидает и дата ≥ сегодня → жёлтый; ожидает и дата < сегодня → красный + title.
 */
export function getInventoryOpListRowPresentation(
  opType: InventoryOpType,
  row: Pick<InventoryOperationItem, 'receipt_status' | 'shipment_status' | 'created_at'>,
): InventoryOpListRowPresentation {
  const base = opType === 'out' ? 'inv-shipment-row' : 'inv-receipt-row'

  if (opType === 'in') {
    const s = row.receipt_status
    if (s === 'accepted') {
      return { className: `${base} inv-receipt-row--accepted` }
    }
    if (s !== 'pending') return {}
    const overdue = isPendingInventoryOperationOverdue(String(row.created_at ?? ''))
    if (overdue) {
      return {
        className: `${base} inv-receipt-row--pending inv-op-row--overdue`,
        title: 'Просроченное поступление',
      }
    }
    return { className: `${base} inv-receipt-row--pending` }
  }

  const s = row.shipment_status
  if (s === 'shipped') {
    return { className: `${base} inv-shipment-row--shipped` }
  }
  if (s !== 'pending') return {}
  const overdue = isPendingInventoryOperationOverdue(String(row.created_at ?? ''))
  if (overdue) {
    return {
      className: `${base} inv-shipment-row--pending inv-op-row--overdue`,
      title: 'Просроченная отгрузка',
    }
  }
  return { className: `${base} inv-shipment-row--pending` }
}
