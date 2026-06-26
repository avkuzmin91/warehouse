/** Чистые помощники для значений `DateTimeField` формата `YYYY-MM-DD[THH:mm]`. */

export function datePart(value: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : ''
}

export function timePart(value: string): string {
  const match = value.match(/^\d{4}-\d{2}-\d{2}T([\d:]{0,5})/)
  return match ? match[1] : ''
}

/** Значение `DateTimeField` заполнено полностью — есть и дата, и время `ЧЧ:ММ`. */
export function isDateTimeComplete(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
}

/**
 * `end` раньше `start`. Сравнивает только полностью заполненные значения
 * `YYYY-MM-DDTHH:mm` (лексикографический порядок совпадает с хронологическим).
 */
export function isDateTimeBefore(end: string, start: string): boolean {
  return isDateTimeComplete(end) && isDateTimeComplete(start) && end < start
}

export function combineDateTime(date: string, time: string): string {
  if (!date) return ''
  return time ? `${date}T${time}` : date
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** Стенные часы Москвы «сейчас» как [y, m(1–12), d, hh, mm]. */
function nowMoscowParts(): [number, number, number, number, number] {
  const s = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Moscow' })
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s)!
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])]
}

/**
 * `base` + `hours` как стенные часы (без сдвига зоны). Если `base` не полное
 * значение `YYYY-MM-DDTHH:mm` — отсчёт от текущего момента по Москве.
 * Возврат — `YYYY-MM-DDTHH:mm`.
 */
export function shiftHours(base: string, hours: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(base)
  const [y, mo, d, hh, mm] = m
    ? [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])]
    : nowMoscowParts()
  const dt = new Date(Date.UTC(y, mo - 1, d, hh + hours, mm))
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}T${pad2(dt.getUTCHours())}:${pad2(dt.getUTCMinutes())}`
}
