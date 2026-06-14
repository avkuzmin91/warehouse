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

/** Копейки (INTEGER из API) → "15 000,00 ₽". */
export function formatMoneyKopecks(kopecks: number | null | undefined): string {
  if (kopecks == null) return '—'
  const neg = kopecks < 0
  const abs = Math.abs(Math.round(kopecks))
  const rub = Math.floor(abs / 100)
  const kop = abs % 100
  return `${neg ? '−' : ''}${rub.toLocaleString('ru-RU')},${String(kop).padStart(2, '0')} ₽`
}

/** Ввод рублей ("15000", "15 000,50") → копейки (INTEGER) или null, если не число / < 0. */
export function parseRublesToKopecks(input: string): number | null {
  const s = input.trim().replace(/\s/g, '').replace(',', '.')
  if (!s) return null
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

/** Local calendar date as YYYY-MM-DD. */
export function localTodayYmd(): string {
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
