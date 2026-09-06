export type SourceOption = { id: string; name: string; available: number }
export type SourceAllocation = { zoneId: string; qty: number }

// Автоподбор мест-источников под нужное количество. Идём от места с наименьшим
// остатком к наибольшему: мелкие остатки выгребаются целиком, и товар остаётся
// минимально разбросанным по складу. Если товара меньше нужного — берём всё, что
// есть (передача будет частичной).
export function allocateSources(need: number, options: SourceOption[]): SourceAllocation[] {
  if (need <= 0) return []
  const sorted = [...options]
    .filter((o) => o.available > 0)
    .sort((a, b) => a.available - b.available || a.name.localeCompare(b.name, 'ru'))
  const rows: SourceAllocation[] = []
  let left = need
  for (const o of sorted) {
    if (left <= 0) break
    const take = Math.min(left, o.available)
    rows.push({ zoneId: o.id, qty: take })
    left -= take
  }
  return rows
}
