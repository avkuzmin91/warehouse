import { describe, expect, it } from 'vitest'
import { parseNum, parseOptionalInteger, parseOptionalWeight } from './parseNumbers'

describe('parseNum', () => {
  it('парсит число с точкой и с запятой', () => {
    expect(parseNum('1.5')).toBe(1.5)
    expect(parseNum('1,5')).toBe(1.5)
  })

  it('не-число → 0', () => {
    expect(parseNum('')).toBe(0)
    expect(parseNum('abc')).toBe(0)
  })

  it('мусор после числа отбрасывается (parseFloat)', () => {
    expect(parseNum('12шт')).toBe(12)
  })
})

describe('parseOptionalInteger', () => {
  it('пустая строка / пробелы → null', () => {
    expect(parseOptionalInteger('')).toBeNull()
    expect(parseOptionalInteger('   ')).toBeNull()
  })

  it('округляет до целого («1,5» → 2)', () => {
    expect(parseOptionalInteger('1,5')).toBe(2)
    expect(parseOptionalInteger('1.4')).toBe(1)
    expect(parseOptionalInteger('10')).toBe(10)
  })

  it('не-число → null (Number строже parseFloat)', () => {
    expect(parseOptionalInteger('abc')).toBeNull()
    expect(parseOptionalInteger('12шт')).toBeNull()
  })

  it('parseOptionalWeight — тот же парсер', () => {
    expect(parseOptionalWeight('2,6')).toBe(3)
  })
})
