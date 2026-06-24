// Склад работает по Москве — серверные даты/время показываем в этой зоне, а не в
// зоне устройства (телефон кладовщика может стоять в другом поясе или со сбитой
// датой). Контракт повторяет веб (frontend/src/utils/format.ts).
export const MOSCOW_TZ = 'Europe/Moscow'

/**
 * ISO-строка → абсолютный момент. Строки без явной зоны («наивные», напр. ETA
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

/** Текущие московские «стенные» дата-время без зоны (YYYY-MM-DDTHH:mm:ss) — для дефолтов форм. */
export function moscowNowIso(): string {
  // sv-SE даёт "YYYY-MM-DD HH:mm:ss"; меняем разделитель на T под контракт datetime-local.
  return new Date().toLocaleString('sv-SE', { timeZone: MOSCOW_TZ }).replace(' ', 'T')
}

/** ISO-дата → короткая дата DD.MM.YYYY по Москве. `empty` — что показать при пустом значении. */
export function fmtDate(s: string | null | undefined, empty = '—'): string {
  if (!s) return empty
  const dt = parseMoscow(s)
  if (Number.isNaN(dt.getTime())) return s
  return dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: MOSCOW_TZ })
}

/** ISO datetime → «05.03, 14:30» по Москве. `empty` — что показать при пустом/кривом значении. */
export function fmtDateTime(s: string | null | undefined, empty = '—'): string {
  if (!s) return empty
  const dt = parseMoscow(s)
  if (Number.isNaN(dt.getTime())) return s
  return dt.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: MOSCOW_TZ,
  })
}

/** Название позиции «Товар · цвет · размер» (пустые части отбрасываются). */
export function variantTitle(productName: string, parts: (string | null | undefined)[]): string {
  const variant = parts.filter(Boolean).join(' · ')
  return variant ? `${productName} · ${variant}` : productName
}
