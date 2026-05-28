/** YYYY-MM-DD → локализованная короткая дата (DD.MM.YYYY). */
export function fmtDate(s: string | null): string {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('ru-RU')
}

/** YYYY-MM-DD → длинная дата с месяцем словом ("5 марта 2026"). */
export function fmtDateLong(s: string | null): string {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** YYYY-MM-DD → компактная "5 мар" (без года). */
export function fmtDateShort(s: string | null): string {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

/** ISO datetime → "05 мар 14:30". */
export function fmtDateTime(s: string): string {
  return new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** YYYY-MM-DD → DD-MM-YYYY (без локали, фиксированный формат). */
export function fmtYmdAsDmy(value: string | null): string {
  if (!value) return '—'
  const [year, month, day] = value.split('-')
  if (!year || !month || !day) return value
  return `${day}-${month}-${year}`
}
