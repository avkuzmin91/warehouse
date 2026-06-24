import { describe, expect, it } from 'vitest'
import { fmtDate, fmtDateTime, moscowNowIso, moscowTodayYmd, parseMoscow, variantTitle } from './format'

describe('parseMoscow', () => {
  it('трактует наивную дату как полночь по Москве (UTC+3)', () => {
    // 2026-03-05 00:00 МСК = 2026-03-04 21:00 UTC
    expect(parseMoscow('2026-03-05').toISOString()).toBe('2026-03-04T21:00:00.000Z')
  })

  it('трактует наивный datetime как стенные часы Москвы', () => {
    expect(parseMoscow('2026-06-23T14:30').toISOString()).toBe('2026-06-23T11:30:00.000Z')
  })

  it('уважает явную зону во входной строке', () => {
    expect(parseMoscow('2026-06-23T14:30:00Z').toISOString()).toBe('2026-06-23T14:30:00.000Z')
  })
})

describe('fmtDate', () => {
  it('форматирует дату в DD.MM.YYYY по Москве', () => {
    expect(fmtDate('2026-03-05')).toBe('05.03.2026')
  })

  it('UTC-полночь относится к московскому календарному дню (+3)', () => {
    // 2026-06-23 00:00 UTC = 03:00 МСК того же дня
    expect(fmtDate('2026-06-23T00:00:00Z')).toBe('23.06.2026')
  })

  it('UTC-22:00 уже следующий день по Москве', () => {
    // 2026-06-23 22:00 UTC = 2026-06-24 01:00 МСК
    expect(fmtDate('2026-06-23T22:00:00Z')).toBe('24.06.2026')
  })

  it('возвращает заданное пустое значение', () => {
    expect(fmtDate(null)).toBe('—')
    expect(fmtDate('', '')).toBe('')
  })
})

describe('fmtDateTime', () => {
  it('форматирует наивный datetime как московские стенные часы', () => {
    expect(fmtDateTime('2026-06-23T14:30')).toBe('23.06, 14:30')
  })

  it('сдвигает UTC-инстант в московскую зону', () => {
    expect(fmtDateTime('2026-06-23T00:00:00Z')).toBe('23.06, 03:00')
  })
})

describe('moscowTodayYmd / moscowNowIso', () => {
  it('moscowTodayYmd возвращает YYYY-MM-DD', () => {
    expect(moscowTodayYmd()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('moscowNowIso возвращает наивный datetime YYYY-MM-DDTHH:mm:ss', () => {
    expect(moscowNowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
  })
})

describe('variantTitle', () => {
  it('склеивает товар и непустые части через · ', () => {
    expect(variantTitle('Куртка', ['Красный', 'M'])).toBe('Куртка · Красный · M')
  })

  it('отбрасывает пустые части', () => {
    expect(variantTitle('Куртка', [null, undefined, ''])).toBe('Куртка')
    expect(variantTitle('Куртка', ['Синий', null])).toBe('Куртка · Синий')
  })
})
