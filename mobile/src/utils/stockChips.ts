import type { PlannableItem, InvQuality } from '../api/balancesApi'

export type StockChip = { label: string; value: number; tone: string }

/**
 * Чипы доступности строки: для упаковки — «склад» (+ «в пути»); для отгрузки —
 * «свободно» (упаковано − резерв) с раскрытием резерва/склада. Единый источник
 * для пикера остатков и детальных экранов. `item` может отсутствовать (варианта
 * нет на остатках) — тогда нули (наглядно показывает «ничего нет / всё в пути»).
 */
export function lineStockChips(
  item: PlannableItem | undefined,
  opts: { source: 'pack' | 'dispatch'; cargoType: InvQuality; reserved?: number },
): StockChip[] {
  const { source, cargoType } = opts
  const isDispatch = source === 'dispatch'
  const dispatchGood = isDispatch && cargoType !== 'defect'
  const ready = item && dispatchGood ? item.ready_good + (item.packed_good ?? 0) : 0
  const storage = item ? (cargoType === 'defect' ? item.storage_defect : item.storage_good) : 0
  const transit = item && cargoType !== 'defect' ? item.in_transit : 0
  const reserved = isDispatch ? (opts.reserved ?? 0) : 0
  // Валовый источник отгрузки (до вычета резерва): упаковано для годного, склад — иначе.
  const gross = dispatchGood ? ready : storage
  const free = Math.max(0, gross - reserved)

  const out: StockChip[] = []
  if (isDispatch) {
    out.push({ label: 'свободно', value: free, tone: 'success' })
    if (reserved > 0) {
      out.push({ label: cargoType === 'defect' ? 'брак' : 'упаковано', value: gross, tone: 'accent' })
      out.push({ label: 'в резерве', value: reserved, tone: 'warning' })
    }
    if (dispatchGood && storage > 0) out.push({ label: 'склад', value: storage, tone: 'accent' })
  } else {
    out.push(
      cargoType === 'defect'
        ? { label: 'брак', value: storage, tone: 'danger' }
        : { label: 'склад', value: storage, tone: 'accent' },
    )
  }
  if (transit > 0) out.push({ label: 'в пути', value: transit, tone: 'info' })
  return out
}
