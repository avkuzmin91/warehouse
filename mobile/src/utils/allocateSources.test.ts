import { describe, expect, it } from 'vitest'
import { allocateSources } from './allocateSources'

const z = (id: string, available: number) => ({ id, name: id, available })

describe('allocateSources', () => {
  it('делит нужное количество между местами', () => {
    expect(allocateSources(500, [z('П-01-01', 400), z('Б-01-02', 100)])).toEqual([
      { zoneId: 'Б-01-02', qty: 100 },
      { zoneId: 'П-01-01', qty: 400 },
    ])
  })

  it('берёт из одного места, когда товара там хватает', () => {
    expect(allocateSources(80, [z('П-01-01', 400)])).toEqual([{ zoneId: 'П-01-01', qty: 80 }])
  })

  it('берёт всё, когда товара меньше нужного', () => {
    expect(allocateSources(500, [z('П-01-01', 300)])).toEqual([{ zoneId: 'П-01-01', qty: 300 }])
  })

  it('идёт от маленького места к большому и не трогает лишние', () => {
    expect(allocateSources(120, [z('П-01-01', 400), z('Б-01-02', 100), z('А-01-01', 5)])).toEqual([
      { zoneId: 'А-01-01', qty: 5 },
      { zoneId: 'Б-01-02', qty: 100 },
      { zoneId: 'П-01-01', qty: 15 },
    ])
  })

  it('пустой результат, когда брать нечего', () => {
    expect(allocateSources(10, [])).toEqual([])
    expect(allocateSources(0, [z('П-01-01', 400)])).toEqual([])
  })
})
