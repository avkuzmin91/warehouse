import { describe, it, expect } from 'vitest'
import { derive, ymdRange, niceMax, fmtShort } from './packingAnalytics'
import type { PackingProductivityResponse } from '../../../api/shipmentsApi'

function resp(days: PackingProductivityResponse['days']): PackingProductivityResponse {
  return {
    days,
    total_good: 0, total_defect: 0, total: 0,
    total_good_earn_kop: 0, total_defect_earn_kop: 0, total_earn_kop: 0,
    with_earnings: true,
  }
}

const row = (over: Partial<PackingProductivityResponse['days'][0]['rows'][0]>) => ({
  client_id: null, client_name: null, product_id: 'p', product_sku: null, product_name: null,
  good: 0, defect: 0, total: 0, good_earn_kop: 0, defect_earn_kop: 0, earn_kop: 0,
  price_missing: false, doc_ids: [], ...over,
})

const day = (over: Partial<PackingProductivityResponse['days'][0]>) => ({
  packed_date: '2026-07-01', good: 0, defect: 0, total: 0, sku_count: 0, doc_count: 0,
  good_earn_kop: 0, defect_earn_kop: 0, earn_kop: 0, rows: [], ...over,
})

describe('ymdRange', () => {
  it('строит непрерывную ось включительно', () => {
    expect(ymdRange('2026-07-01', '2026-07-03')).toEqual(['2026-07-01', '2026-07-02', '2026-07-03'])
  })
  it('одна дата — один день', () => {
    expect(ymdRange('2026-07-05', '2026-07-05')).toEqual(['2026-07-05'])
  })
})

describe('derive: ряды по дням', () => {
  it('раскладывает дни по оси и оставляет нули на пустых днях', () => {
    const data = resp([
      day({ packed_date: '2026-07-03', good: 10, defect: 2, total: 12, doc_count: 1, sku_count: 1, good_earn_kop: 1000, defect_earn_kop: 200, earn_kop: 1200 }),
    ])
    const d = derive(data, '2026-07-01', '2026-07-03')
    expect(d.axis).toEqual(['2026-07-01', '2026-07-02', '2026-07-03'])
    expect(d.goodSeries).toEqual([0, 0, 10])
    expect(d.defectSeries).toEqual([0, 0, 2])
    expect(d.earnSeries).toEqual([0, 0, 1200])
    expect(d.docSeries).toEqual([0, 0, 1])
  })

  it('дни вне диапазона оси игнорируются', () => {
    const data = resp([day({ packed_date: '2026-06-30', good: 5, total: 5 })])
    const d = derive(data, '2026-07-01', '2026-07-02')
    expect(d.goodSeries).toEqual([0, 0])
  })
})

describe('derive: агрегаты по клиентам и SKU', () => {
  it('суммирует по клиенту и товару через несколько дней, сортирует по объёму', () => {
    const data = resp([
      day({ packed_date: '2026-07-01', rows: [
        row({ client_id: 'c1', client_name: 'Клиент A', product_id: 'p1', product_sku: 'SKU1', good: 8, total: 8 }),
        row({ client_id: 'c2', client_name: 'Клиент B', product_id: 'p2', product_sku: 'SKU2', good: 3, defect: 1, total: 4 }),
      ] }),
      day({ packed_date: '2026-07-02', rows: [
        row({ client_id: 'c1', client_name: 'Клиент A', product_id: 'p1', product_sku: 'SKU1', good: 2, total: 2 }),
      ] }),
    ])
    const d = derive(data, '2026-07-01', '2026-07-02')
    expect(d.byClient.map((c) => [c.client_name, c.total])).toEqual([['Клиент A', 10], ['Клиент B', 4]])
    expect(d.topSkus.map((s) => [s.product_sku, s.total])).toEqual([['SKU1', 10], ['SKU2', 4]])
    expect(d.skuTotalCount).toBe(2)
  })

  it('null client_id сворачивается в «Без клиента»', () => {
    const data = resp([day({ rows: [row({ client_id: null, good: 4, total: 4 })] })])
    const d = derive(data, '2026-07-01', '2026-07-01')
    expect(d.byClient[0].client_name).toBe('Без клиента')
  })
})

describe('derive: пробелы тарифов', () => {
  it('собирает только позиции price_missing, группируя по товар×клиент', () => {
    const data = resp([
      day({ packed_date: '2026-07-01', rows: [
        row({ client_id: 'c1', client_name: 'A', product_id: 'p1', product_sku: 'S1', good: 5, total: 5, price_missing: true }),
        row({ client_id: 'c1', client_name: 'A', product_id: 'p2', product_sku: 'S2', good: 7, total: 7, price_missing: false }),
      ] }),
      day({ packed_date: '2026-07-02', rows: [
        row({ client_id: 'c1', client_name: 'A', product_id: 'p1', product_sku: 'S1', defect: 3, total: 3, price_missing: true }),
      ] }),
    ])
    const d = derive(data, '2026-07-01', '2026-07-02')
    expect(d.gaps).toHaveLength(1)
    expect(d.gaps[0]).toMatchObject({ product_sku: 'S1', client_name: 'A', good: 5, defect: 3, total: 8 })
  })

  it('нет незаданных тарифов — пустой список', () => {
    const data = resp([day({ rows: [row({ good: 1, total: 1, price_missing: false })] })])
    expect(derive(data, '2026-07-01', '2026-07-01').gaps).toEqual([])
  })
})

describe('форматирование оси', () => {
  it('niceMax округляет вверх до «красивого» максимума', () => {
    expect(niceMax(0)).toBe(1)
    expect(niceMax(12)).toBe(20)
    expect(niceMax(230)).toBe(250)
  })
  it('fmtShort: штуки и рубли из копеек', () => {
    expect(fmtShort(1500, false)).toBe('2 тыс')
    expect(fmtShort(3_400_000, true)).toBe('34 тыс')
    expect(fmtShort(500, false)).toBe('500')
  })
})
