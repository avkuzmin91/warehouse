import type { PackingProductivityResponse } from '../../../api/shipmentsApi'

// Чистое преобразование ответа «производительности упаковки» в ряды/агрегаты
// дашборда аналитики. Вынесено из вью, чтобы покрыть тестом (агрегация — основная
// логика раздела: непрерывная ось дней, суммы по клиентам/SKU, пробелы тарифов).

export const TOP_SKU_LIMIT = 12

export type Mode = 'qty' | 'money'

type Agg = { good: number; defect: number; total: number; earn_kop: number }
export type ClientAgg = Agg & { client_id: string | null; client_name: string }
export type SkuAgg = Agg & { product_id: string; product_sku: string | null; product_name: string | null }
export type GapRow = {
  product_id: string
  product_sku: string | null
  product_name: string | null
  client_name: string
  good: number
  defect: number
  total: number
}

export type Derived = {
  axis: string[]
  goodSeries: number[]
  defectSeries: number[]
  totalSeries: number[]
  docSeries: number[]
  skuSeries: number[]
  goodEarnSeries: number[]
  defectEarnSeries: number[]
  earnSeries: number[]
  byClient: ClientAgg[]
  topSkus: SkuAgg[]
  skuTotalCount: number
  gaps: GapRow[]
}

export const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)

export function shiftYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

/** Непрерывная ось дат from..to включительно (дни без упаковки — нули в графике). */
export function ymdRange(from: string, to: string): string[] {
  const out: string[] = []
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  let t = Date.UTC(fy, fm - 1, fd)
  const end = Date.UTC(ty, tm - 1, td)
  const pad = (n: number) => String(n).padStart(2, '0')
  while (t <= end && out.length < 400) {
    const dt = new Date(t)
    out.push(`${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`)
    t += 86_400_000
  }
  return out
}

export function ddmm(ymd: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}` : ymd
}

export function daysInclusive(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  return Math.floor((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000) + 1
}

export function niceMax(v: number): number {
  if (v <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / p
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return m * p
}

/** Короткая подпись оси: штуки (1.2 тыс) или рубли из копеек (34 тыс). */
export function fmtShort(v: number, money: boolean): string {
  const base = money ? v / 100 : v
  if (base >= 1_000_000) return (base / 1_000_000).toFixed(base >= 10_000_000 ? 0 : 1).replace('.', ',') + ' млн'
  if (base >= 1000) return Math.round(base / 1000) + ' тыс'
  return String(Math.round(base))
}

export function derive(data: PackingProductivityResponse, from: string, to: string): Derived {
  const axis = ymdRange(from, to)
  const idx = new Map(axis.map((d, i) => [d, i]))
  const n = axis.length
  const zero = () => new Array<number>(n).fill(0)
  const goodSeries = zero(), defectSeries = zero(), totalSeries = zero()
  const docSeries = zero(), skuSeries = zero()
  const goodEarnSeries = zero(), defectEarnSeries = zero(), earnSeries = zero()

  const clientMap = new Map<string, ClientAgg>()
  const skuMap = new Map<string, SkuAgg>()
  const gapMap = new Map<string, GapRow>()

  for (const day of data.days) {
    const i = idx.get(day.packed_date)
    if (i != null) {
      goodSeries[i] = day.good
      defectSeries[i] = day.defect
      totalSeries[i] = day.total
      docSeries[i] = day.doc_count
      skuSeries[i] = day.sku_count
      goodEarnSeries[i] = day.good_earn_kop
      defectEarnSeries[i] = day.defect_earn_kop
      earnSeries[i] = day.earn_kop
    }
    for (const r of day.rows) {
      const ck = r.client_id ?? '∅'
      const c = clientMap.get(ck) ?? { client_id: r.client_id, client_name: r.client_name ?? 'Без клиента', good: 0, defect: 0, total: 0, earn_kop: 0 }
      c.good += r.good; c.defect += r.defect; c.total += r.total; c.earn_kop += r.earn_kop
      clientMap.set(ck, c)

      const s = skuMap.get(r.product_id) ?? { product_id: r.product_id, product_sku: r.product_sku, product_name: r.product_name, good: 0, defect: 0, total: 0, earn_kop: 0 }
      s.good += r.good; s.defect += r.defect; s.total += r.total; s.earn_kop += r.earn_kop
      skuMap.set(r.product_id, s)

      if (r.price_missing) {
        const gk = `${r.product_id}|${r.client_id ?? '∅'}`
        const g = gapMap.get(gk) ?? { product_id: r.product_id, product_sku: r.product_sku, product_name: r.product_name, client_name: r.client_name ?? 'Без клиента', good: 0, defect: 0, total: 0 }
        g.good += r.good; g.defect += r.defect; g.total += r.total
        gapMap.set(gk, g)
      }
    }
  }

  const byClient = [...clientMap.values()].sort((a, b) => b.total - a.total)
  const allSkus = [...skuMap.values()].sort((a, b) => b.total - a.total)
  const gaps = [...gapMap.values()].sort((a, b) => b.total - a.total)

  return {
    axis, goodSeries, defectSeries, totalSeries, docSeries, skuSeries,
    goodEarnSeries, defectEarnSeries, earnSeries,
    byClient, topSkus: allSkus.slice(0, TOP_SKU_LIMIT), skuTotalCount: allSkus.length, gaps,
  }
}
