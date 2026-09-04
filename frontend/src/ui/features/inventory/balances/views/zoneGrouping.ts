import type { BalanceZoneItem, InvOpStatus, InvQuality } from '../../../../../api/balancesApi'
import type { SizeMatrixCell } from '../../../shared/SizeMatrix'

/** Строка места с количеством в конкретном разрезе: в режиме позиций это весь
 * остаток строки, в режиме коробов — её часть, лежащая в этом коробе. */
export type ZoneRow = { item: BalanceZoneItem; qty: number }

/** Товар внутри места: средний уровень между местом и вариантами. Для одежды
 * без него место разворачивается в сотню строк цвет×размер.
 *
 * Операционный статус входит в ключ: остаток «на хранении» и «готов к отгрузке» —
 * разные по доступности корзины, сводить их в одну строку нельзя. Качество
 * внутри группы остаётся смешанным — его несёт количество («20 + 22 брак»),
 * ровно как в разрезе «По товарам». */
export type ZoneProductGroup = {
  key: string
  productId: string
  productName: string
  productSku: string
  clientId: string | null
  clientName: string | null
  op: InvOpStatus
  rows: ZoneRow[]
  totalQty: number
  goodQty: number
  defectQty: number
  colorsCount: number
  sizesCount: number
  qualities: InvQuality[]
}

export function zoneProductKey(item: BalanceZoneItem): string {
  return `${item.product_id}::${item.client_id ?? ''}::${item.op_status}`
}

/** Группа из одной строки — плоская: разворачивать нечего, вариант виден сразу. */
export function isFlatZoneGroup(g: ZoneProductGroup): boolean {
  return g.rows.length === 1
}

/** Сетка имеет смысл, когда в ней больше одной ячейки и есть годный остаток:
 * главное число ячейки — годный, а красный «0» читается как «размер вымыт»,
 * поэтому чисто бракованная группа показывается списком. */
export function hasSizeMatrix(g: ZoneProductGroup): boolean {
  return g.goodQty > 0 && g.sizesCount > 0 && (g.sizesCount > 1 || g.colorsCount > 1)
}

// Порядок корзин в карточке места: сначала хранение, процессные — следом.
const OP_ORDER: Record<string, number> = { storage: 0, boxed: 1, packing: 2, packed: 3, picked: 4, ready: 5 }

export function groupZoneRowsByProduct(rows: ZoneRow[]): ZoneProductGroup[] {
  const map = new Map<string, ZoneProductGroup>()
  const colors = new Map<string, Set<string>>()
  const sizes = new Map<string, Set<string>>()
  for (const row of rows) {
    const key = zoneProductKey(row.item)
    let group = map.get(key)
    if (!group) {
      group = {
        key,
        productId:   row.item.product_id,
        productName: row.item.product_name,
        productSku:  row.item.product_sku,
        clientId:    row.item.client_id,
        clientName:  row.item.client_name,
        op:          row.item.op_status,
        rows: [],
        totalQty: 0,
        goodQty: 0,
        defectQty: 0,
        colorsCount: 0,
        sizesCount: 0,
        qualities: [],
      }
      map.set(key, group)
      colors.set(key, new Set())
      sizes.set(key, new Set())
    }
    group.rows.push(row)
    group.totalQty += row.qty
    if (row.item.quality === 'defect') group.defectQty += row.qty
    else group.goodQty += row.qty
    if (!group.qualities.includes(row.item.quality)) group.qualities.push(row.item.quality)
    if (row.item.color_id) colors.get(key)!.add(row.item.color_id)
    if (row.item.size_id) sizes.get(key)!.add(row.item.size_id)
  }
  const groups = [...map.values()]
  for (const g of groups) {
    g.colorsCount = colors.get(g.key)!.size
    g.sizesCount = sizes.get(g.key)!.size
  }
  // Корзины одного товара идут подряд — так видно, что где лежит по одному артикулу.
  return groups.sort((a, b) =>
    a.productName.localeCompare(b.productName, 'ru')
    || (OP_ORDER[a.op] ?? 9) - (OP_ORDER[b.op] ?? 9)
    || (a.clientName ?? '').localeCompare(b.clientName ?? '', 'ru'))
}

/** Ячейки сетки цвет×размер по группе: годный — основное число, брак — «+n». */
export function zoneMatrixCells(g: ZoneProductGroup): SizeMatrixCell[] {
  return g.rows.map((row) => ({
    color_id:        row.item.color_id,
    color_name:      row.item.color_name,
    size_id:         row.item.size_id,
    size_name:       row.item.size_name,
    size_sort_order: row.item.size_sort_order,
    good:            row.item.quality === 'defect' ? 0 : row.qty,
    defect:          row.item.quality === 'defect' ? row.qty : 0,
  }))
}
