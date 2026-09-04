import type { MpSupplyBoardItem } from '../../../../api/marketplacesApi'
import { parseMoscow } from '../../../../utils/format'

/** Волна = отсечка площадки. Верхний уровень доски — время, а не алфавит:
 *  менеджер закрывает отсечки, а не разбирает список кабинетов. */
export type SupplyWave = {
  key: string
  title: string
  late: boolean
  items: MpSupplyBoardItem[]
}

const HHMM = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow',
})
const DAY = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit', month: '2-digit', timeZone: 'Europe/Moscow',
})
const YMD = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Moscow',
})

export function waveTitle(cutoffAt: string | null): string {
  if (!cutoffAt) return 'Без срока'
  const date = parseMoscow(cutoffAt)
  const day = YMD.format(date)
  const now = new Date()
  const today = YMD.format(now)
  const tomorrow = YMD.format(new Date(now.getTime() + 86_400_000))
  const time = HHMM.format(date)
  if (day === today) return `Сегодня до ${time}`
  if (day === tomorrow) return `Завтра до ${time}`
  return `${DAY.format(date)} до ${time}`
}

export function cutoffTime(cutoffAt: string | null): string {
  return cutoffAt ? HHMM.format(parseMoscow(cutoffAt)) : '—'
}

/** «через 2 ч 10 мин» / «−16 ч 40 мин» — абсолютное время для планирования,
 *  остаток для тревоги. */
export function cutoffCountdown(cutoffAt: string | null): string {
  if (!cutoffAt) return 'без дедлайна'
  const diff = parseMoscow(cutoffAt).getTime() - Date.now()
  const late = diff < 0
  const mins = Math.floor(Math.abs(diff) / 60_000)
  const hours = Math.floor(mins / 60)
  const rest = mins % 60
  const body = hours > 0 ? `${hours} ч ${rest} мин` : `${rest} мин`
  return late ? `−${body}` : `через ${body}`
}

export function groupIntoWaves(items: MpSupplyBoardItem[]): SupplyWave[] {
  const late = items.filter((i) => i.overdue)
  const rest = items.filter((i) => !i.overdue)
  const byCutoff = new Map<string, MpSupplyBoardItem[]>()
  for (const item of rest) {
    const key = item.cutoff_at ?? ''
    const bucket = byCutoff.get(key)
    if (bucket) bucket.push(item)
    else byCutoff.set(key, [item])
  }
  const waves: SupplyWave[] = [...byCutoff.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    .map(([key, group]) => ({
      key: key || 'no-deadline',
      title: waveTitle(key || null),
      late: false,
      items: group,
    }))
  if (late.length) {
    waves.unshift({ key: 'overdue', title: 'Просрочено', late: true, items: late })
  }
  return waves
}
