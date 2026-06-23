import { MOSCOW_TZ, parseMoscow } from '../../../../utils/format'

export function fmtDateTime(v: string | null | undefined): string {
  if (!v) return '—'
  const d = parseMoscow(v)
  if (Number.isNaN(d.getTime())) return v
  return d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: MOSCOW_TZ })
}
