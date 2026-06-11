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
