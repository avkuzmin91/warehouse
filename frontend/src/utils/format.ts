/** Склад работает по Москве — все даты/время показываем в этой зоне, не в зоне устройства. */
export const MOSCOW_TZ = 'Europe/Moscow'

/**
 * ISO-строка → абсолютный момент. Строки без явной зоны ("наивные", напр. ETA
 * рейса `2026-06-23T14:30`) трактуем как стенные часы Москвы (UTC+3, без перехода
 * на летнее время с 2014), иначе устройство в другом поясе сдвинуло бы их.
 */
export function parseMoscow(s: string): Date {
  const hasTz = /([zZ]|[+-]\d{2}:?\d{2})$/.test(s)
  if (hasTz) return new Date(s)
  return new Date(s.includes('T') ? `${s}+03:00` : `${s}T00:00:00+03:00`)
}

/** Сегодняшняя календарная дата по Москве в формате YYYY-MM-DD. */
export function moscowTodayYmd(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: MOSCOW_TZ })
}

/** YYYY-MM-DD → локализованная короткая дата (DD.MM.YYYY). */
export function fmtDate(s: string | null): string {
  if (!s) return '—'
  return parseMoscow(s).toLocaleDateString('ru-RU', { timeZone: MOSCOW_TZ })
}

/** YYYY-MM-DD → длинная дата с месяцем словом ("5 марта 2026"). */
export function fmtDateLong(s: string | null): string {
  if (!s) return '—'
  return parseMoscow(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: MOSCOW_TZ })
}

/** YYYY-MM-DD → компактная "5 мар" (без года). */
export function fmtDateShort(s: string | null): string {
  if (!s) return '—'
  return parseMoscow(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: MOSCOW_TZ })
}

/** ISO datetime → "05 мар 14:30" (по Москве). */
export function fmtDateTime(s: string): string {
  return parseMoscow(s).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: MOSCOW_TZ })
}

/**
 * Длительность в мс → компактное "4 ч 20 мин" / "3 дн" / "5 мин".
 *
 * Монитору нужен запас времени, а не момент: "через 4 ч" читается без счёта в
 * уме, "06 сент., 17:31" — нет. Знак не выводится, направление ("через" /
 * "просрочен на") задаёт вызывающий.
 */
export function fmtDurationShort(ms: number): string {
  const total = Math.floor(Math.abs(ms) / 60000)
  if (total < 1) return 'меньше минуты'
  const days = Math.floor(total / 1440)
  const hours = Math.floor((total % 1440) / 60)
  const minutes = total % 60
  if (days > 0) return hours > 0 ? `${days} дн ${hours} ч` : `${days} дн`
  if (hours > 0) return minutes > 0 ? `${hours} ч ${minutes} мин` : `${hours} ч`
  return `${minutes} мин`
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

/** YYYY-MM-DD (или ISO datetime) → ключ дня для группировки списков ('no-date' если пусто/некорректно). */
export function dayGroupKey(s: string | null): string {
  if (!s) return 'no-date'
  const ymd = s.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : 'no-date'
}

/** Заголовок дня-разделителя в списках: "Сегодня · 20 июня · пятница". */
export function dayGroupLabel(s: string | null, emptyLabel = 'Без даты'): string {
  const key = dayGroupKey(s)
  if (key === 'no-date') return emptyLabel
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const now = new Date()
  const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const diffDays = Math.round((date.getTime() - todayMs) / 86_400_000)
  const rel = diffDays === 0 ? 'Сегодня' : diffDays === 1 ? 'Завтра' : diffDays === -1 ? 'Вчера' : null
  const dm = date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' })
  const weekday = date.toLocaleDateString('ru-RU', { weekday: 'long' })
  return rel ? `${rel} · ${dm} · ${weekday}` : `${dm} · ${weekday}`
}

/** Local calendar date as YYYY-MM-DD. */
export function localTodayYmd(): string {
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
