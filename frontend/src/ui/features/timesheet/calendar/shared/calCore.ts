// Ядро производственного календаря: чистые функции и константы (без React).
// Правило 6/1: рабочий день = любой день, кроме воскресенья. Таблица календаря
// хранит только исключения и перебивает правило в обе стороны. Состояние дня
// выводится из is_working + дня недели (отдельной колонки типа в БД нет).

import type { CalendarException } from '../../../../../api/productionCalendarApi'

export const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]
export const MONTHS_SHORT = [
  'Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек',
]
export const MON_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]
export const WD_HEAD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

export const pad = (n: number) => String(n).padStart(2, '0')
export const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`
const isSunday = (dt: Date) => dt.getDay() === 0
// Нерабочий по умолчанию (правило 6/1) — только воскресенье.
export const defaultWorking = (dt: Date) => dt.getDay() !== 0

export type Override = { is_working: boolean; reason: string | null }
export type OverrideMap = Record<string, Override>

export type DayStateKey = 'work' | 'weekoff' | 'holiday' | 'worksun'

export const STATE: Record<DayStateKey, { label: string; fill: string; text: string; dot: string }> = {
  work:    { label: 'Рабочий день',         fill: 'var(--c-bg-elev)',   text: 'var(--c-text)',        dot: 'var(--c-text-faint)' },
  weekoff: { label: 'Воскресенье (6/1)',    fill: 'var(--c-bg-sunken)', text: 'var(--c-text-subtle)', dot: 'var(--c-text-subtle)' },
  holiday: { label: 'Нерабочий — праздник', fill: 'var(--c-danger-bg)', text: 'var(--c-danger)',      dot: 'var(--c-danger)' },
  worksun: { label: 'Рабочее воскресенье',  fill: 'var(--c-success-bg)', text: 'var(--c-success)',    dot: 'var(--c-success)' },
}

export const STATE_LEGEND: DayStateKey[] = ['work', 'weekoff', 'holiday', 'worksun']

export function dayState(dt: Date, overrides: OverrideMap): DayStateKey {
  const key = isoOf(dt.getFullYear(), dt.getMonth() + 1, dt.getDate())
  const ov = overrides[key]
  if (ov) return ov.is_working ? 'worksun' : 'holiday'
  return isSunday(dt) ? 'weekoff' : 'work'
}

export const isWorkingState = (s: DayStateKey) => s === 'work' || s === 'worksun'

// Сетка месяца: массив (Date|null), Пн первый.
export function monthGrid(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month - 1, 1)
  const startDow = (first.getDay() + 6) % 7
  const daysIn = new Date(year, month, 0).getDate()
  const cells: (Date | null)[] = Array(startDow).fill(null)
  for (let d = 1; d <= daysIn; d++) cells.push(new Date(year, month - 1, d))
  while (cells.length % 7) cells.push(null)
  return cells
}

// Число рабочих дней месяца с учётом исключений.
export function workingDays(year: number, month: number, overrides: OverrideMap): number {
  const daysIn = new Date(year, month, 0).getDate()
  let n = 0
  for (let d = 1; d <= daysIn; d++) {
    if (isWorkingState(dayState(new Date(year, month - 1, d), overrides))) n++
  }
  return n
}

export function overridesFromItems(items: CalendarException[] | undefined): OverrideMap {
  const map: OverrideMap = {}
  for (const it of items ?? []) map[it.cal_date] = { is_working: it.is_working, reason: it.reason }
  return map
}

export const fmtLong = (isoStr: string) => {
  const [, m, d] = isoStr.split('-').map(Number)
  return `${d} ${MON_GEN[m - 1]}`
}
export const fmtDow = (isoStr: string) => {
  const [y, m, d] = isoStr.split('-').map(Number)
  return WD_HEAD[(new Date(y, m - 1, d).getDay() + 6) % 7]
}

// Все iso-даты в инклюзивном диапазоне [a..b] (a/b в любом порядке).
export function isoRange(a: string, b: string): string[] {
  const from = a < b ? a : b
  const to = a < b ? b : a
  const out: string[] = []
  let cur = new Date(from + 'T00:00:00')
  const end = new Date(to + 'T00:00:00')
  while (cur <= end) {
    out.push(isoOf(cur.getFullYear(), cur.getMonth() + 1, cur.getDate()))
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1)
  }
  return out
}
