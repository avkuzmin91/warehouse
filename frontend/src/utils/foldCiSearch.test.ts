import { describe, expect, it } from 'vitest'
import { foldCiSearch } from './foldCiSearch'

describe('foldCiSearch', () => {
  it('приводит к нижнему регистру', () => {
    expect(foldCiSearch('КурТКА')).toBe('куртка')
    expect(foldCiSearch('ABC Def')).toBe('abc def')
  })

  it('сворачивает ё → е (включая заглавную Ё через lower)', () => {
    expect(foldCiSearch('ёжик')).toBe('ежик')
    expect(foldCiSearch('Ёлка')).toBe('елка')
    expect(foldCiSearch('СерЁжа')).toBe('сережа')
  })

  it('пустая строка остаётся пустой', () => {
    expect(foldCiSearch('')).toBe('')
  })

  it('не трогает цифры и знаки', () => {
    expect(foldCiSearch('WH-00001 / 42')).toBe('wh-00001 / 42')
  })
})
