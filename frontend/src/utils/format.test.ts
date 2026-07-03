import { describe, expect, it } from 'vitest'
import {
  dayGroupKey,
  dayGroupLabel,
  fmtDate,
  fmtDateTime,
  fmtYmdAsDmy,
  formatMoneyKopecks,
  localTodayYmd,
  moscowTodayYmd,
  parseMoscow,
  parseRublesToKopecks,
} from './format'

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
    expect(parseMoscow('2026-06-23T14:30:00+05:00').toISOString()).toBe('2026-06-23T09:30:00.000Z')
  })
})

describe('fmtDate', () => {
  it('форматирует дату в DD.MM.YYYY по Москве', () => {
    expect(fmtDate('2026-03-05')).toBe('05.03.2026')
  })

  it('UTC-22:00 уже следующий день по Москве', () => {
    // 2026-06-23 22:00 UTC = 2026-06-24 01:00 МСК
    expect(fmtDate('2026-06-23T22:00:00Z')).toBe('24.06.2026')
  })

  it('пустое значение → тире', () => {
    expect(fmtDate(null)).toBe('—')
    expect(fmtDate('')).toBe('—')
  })
})

describe('fmtDateTime', () => {
  it('наивный datetime — московские стенные часы', () => {
    expect(fmtDateTime('2026-06-23T14:30')).toContain('14:30')
  })

  it('UTC-инстант сдвигается в московскую зону (+3)', () => {
    expect(fmtDateTime('2026-06-23T00:00:00Z')).toContain('03:00')
  })
})

describe('fmtYmdAsDmy', () => {
  it('YYYY-MM-DD → DD-MM-YYYY', () => {
    expect(fmtYmdAsDmy('2026-03-05')).toBe('05-03-2026')
  })

  it('пустое → тире, некорректное возвращается как есть', () => {
    expect(fmtYmdAsDmy(null)).toBe('—')
    expect(fmtYmdAsDmy('')).toBe('—')
    expect(fmtYmdAsDmy('garbage')).toBe('garbage')
  })
})

describe('formatMoneyKopecks', () => {
  it('копейки → рубли с двумя знаками', () => {
    expect(formatMoneyKopecks(15000)).toBe('150,00 ₽')
    expect(formatMoneyKopecks(1)).toBe('0,01 ₽')
  })

  it('тысячи разделяются неразрывным пробелом (ru-RU)', () => {
    expect(formatMoneyKopecks(1_500_000)).toBe('15 000,00 ₽')
  })

  it('отрицательное — с математическим минусом', () => {
    expect(formatMoneyKopecks(-15050)).toBe('−150,50 ₽')
  })

  it('null/undefined → тире', () => {
    expect(formatMoneyKopecks(null)).toBe('—')
    expect(formatMoneyKopecks(undefined)).toBe('—')
  })
})

describe('parseRublesToKopecks', () => {
  it('целые рубли → копейки', () => {
    expect(parseRublesToKopecks('15000')).toBe(1_500_000)
  })

  it('поддерживает пробелы-разделители и запятую', () => {
    expect(parseRublesToKopecks('15 000,50')).toBe(1_500_050)
    expect(parseRublesToKopecks('0.1')).toBe(10)
  })

  it('пустое / не число / отрицательное → null', () => {
    expect(parseRublesToKopecks('')).toBeNull()
    expect(parseRublesToKopecks('  ')).toBeNull()
    expect(parseRublesToKopecks('abc')).toBeNull()
    expect(parseRublesToKopecks('-5')).toBeNull()
  })
})

describe('dayGroupKey', () => {
  it('берёт календарный день из даты и datetime', () => {
    expect(dayGroupKey('2026-06-23')).toBe('2026-06-23')
    expect(dayGroupKey('2026-06-23T10:00:00Z')).toBe('2026-06-23')
  })

  it('пусто / мусор → no-date', () => {
    expect(dayGroupKey(null)).toBe('no-date')
    expect(dayGroupKey('')).toBe('no-date')
    expect(dayGroupKey('garbage')).toBe('no-date')
  })
})

describe('dayGroupLabel', () => {
  it('без даты — заданная метка', () => {
    expect(dayGroupLabel(null)).toBe('Без даты')
    expect(dayGroupLabel(null, 'Не назначено')).toBe('Не назначено')
  })

  it('сегодняшняя локальная дата начинается с «Сегодня»', () => {
    expect(dayGroupLabel(localTodayYmd())).toMatch(/^Сегодня · /)
  })

  it('давняя дата — «день месяц · день недели» без относительного слова', () => {
    // 2020-01-01 — среда
    expect(dayGroupLabel('2020-01-01')).toBe('01 января · среда')
  })
})

describe('moscowTodayYmd / localTodayYmd', () => {
  it('возвращают YYYY-MM-DD', () => {
    expect(moscowTodayYmd()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(localTodayYmd()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
