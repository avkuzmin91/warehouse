import { useMemo, useState } from 'react'
import { CONTAINER_OP_LABELS } from '../../../../api/containersApi'
import type { ContainerOp } from '../../../../api/containersApi'
import { Card, CardHead } from '../../../primitives/Card'
import { Icon } from '../../../primitives/Icon'
import { MOSCOW_TZ, dayGroupLabel, parseMoscow } from '../../../../utils/format'

/** Сканы поштучные: 23 записи «+1 шт.» — это один поход к коробу, а не 23 события. */
const SCAN_OPS = new Set(['item_add', 'item_remove'])

const OP_ICONS: Record<string, string> = {
  create: 'tag',
  take: 'box',
  item_add: 'plus',
  item_remove: 'minus',
  close: 'lock',
  reopen: 'refresh',
  place: 'archive',
  move: 'forklift',
  release: 'x',
  delete: 'trash',
}

const OP_COLORS: Record<string, string> = {
  item_add: 'var(--c-success)',
  item_remove: 'var(--c-warning)',
  close: 'var(--c-info)',
  reopen: 'var(--c-warning)',
  place: 'var(--c-success)',
  move: 'var(--c-accent)',
  delete: 'var(--c-danger)',
}

type Entry = {
  key: string
  op_type: string
  qty: number | null
  scans: number
  variant: string | null
  zone: string | null
  comment: string | null
  user: string | null
  from_at: string
  to_at: string
}

function variantOf(o: ContainerOp): string | null {
  const parts = [o.product_name, o.color_name, o.size_name].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

/** Комментарий вида «+1 шт.» не добавляет ничего к подписи операции и количеству. */
function meaningfulComment(comment: string | null): string | null {
  if (!comment) return null
  return /^[+−-]?\s*\d+\s*шт\.?$/.test(comment.trim()) ? null : comment
}

function fmtTime(iso: string): string {
  const d = parseMoscow(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: MOSCOW_TZ })
}

/** Календарный день по Москве: журнал показывается в МСК, разделители должны совпадать. */
function moscowYmd(iso: string): string {
  const d = parseMoscow(iso)
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString('en-CA', { timeZone: MOSCOW_TZ })
}

function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1]
  return forms[2]
}

function toEntry(o: ContainerOp): Entry {
  return {
    key: o.id,
    op_type: o.op_type,
    qty: o.qty,
    scans: 1,
    variant: variantOf(o),
    zone: o.zone_name,
    comment: meaningfulComment(o.comment),
    user: o.created_by_name,
    from_at: o.created_at,
    to_at: o.created_at,
  }
}

/** Подряд идущие сканы одного человека по одной позиции — одна запись «набрано N шт.».
 *
 * Журнал append-only и остаётся полным: свёртка живёт только в отображении, а
 * тумблер «Все записи» возвращает поштучный вид для разбора пересорта.
 */
function collapse(ops: ContainerOp[]): Entry[] {
  const out: Entry[] = []
  for (const o of ops) {
    const variant = variantOf(o)
    const prev = out[out.length - 1]
    const mergeable =
      prev != null
      && SCAN_OPS.has(o.op_type)
      && prev.op_type === o.op_type
      && prev.variant === variant
      && prev.user === o.created_by_name
      && prev.zone === o.zone_name
      && moscowYmd(prev.to_at) === moscowYmd(o.created_at)
    if (mergeable) {
      prev.qty = (prev.qty ?? 0) + (o.qty ?? 0)
      prev.scans += 1
      // ops приходят от новых к старым, поэтому расширяется нижняя граница.
      prev.to_at = o.created_at
      prev.comment = null
      continue
    }
    out.push(toEntry(o))
  }
  return out
}

/** Разделитель дня рисуется у первой записи дня — считаем это до рендера, а не в нём. */
function withDayHeads(entries: Entry[]): { entry: Entry; dayHead: string | null }[] {
  let last = ''
  return entries.map((entry) => {
    const day = moscowYmd(entry.from_at)
    const dayHead = day === last ? null : day
    last = day
    return { entry, dayHead }
  })
}

function qtyLabel(e: Entry): string | null {
  if (e.qty == null) return null
  if (e.op_type === 'item_add') return `+${e.qty} шт.`
  if (e.op_type === 'item_remove') return `−${e.qty} шт.`
  return `${e.qty} шт.`
}

export function BoxHistory({ ops }: { ops: ContainerOp[] }) {
  const [raw, setRaw] = useState(false)
  const grouped = useMemo(() => collapse(ops), [ops])
  const entries = raw ? ops.map(toEntry) : grouped
  const collapsed = ops.length - grouped.length
  const rows = withDayHeads(entries)

  return (
    <Card>
      <CardHead>
        <span className="card-head-title">История</span>
        <span className="t-sub">{ops.length} {plural(ops.length, ['запись', 'записи', 'записей'])}</span>
        <span style={{ flex: 1 }} />
        {collapsed > 0 && (
          <button className="btn sm ghost" onClick={() => setRaw((v) => !v)}>
            {raw ? 'Свернуть сканы' : 'Все записи'}
          </button>
        )}
      </CardHead>
      {entries.length === 0 ? (
        <div className="t-sub" style={{ padding: 14 }}>Записей нет.</div>
      ) : (
        <div style={{ padding: '6px 14px 12px' }}>
          {rows.map(({ entry: e, dayHead }) => {
            // Комментарий журнала написан по-русски и уже описывает событие целиком —
            // подпись op_type рядом с ним читалась бы как повтор.
            const label = e.comment ?? CONTAINER_OP_LABELS[e.op_type] ?? e.op_type
            const qty = e.comment ? null : qtyLabel(e)
            const time = e.from_at === e.to_at || fmtTime(e.from_at) === fmtTime(e.to_at)
              ? fmtTime(e.from_at)
              : `${fmtTime(e.to_at)} – ${fmtTime(e.from_at)}`
            return (
              <div key={e.key}>
                {dayHead && (
                  <div
                    className="t-sub"
                    style={{ padding: '10px 0 6px', textTransform: 'lowercase' }}
                  >
                    {dayGroupLabel(dayHead)}
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '26px minmax(0,1fr)', gap: 2 }}>
                  <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 3 }}>
                    <span
                      style={{
                        width: 20, height: 20, borderRadius: '50%',
                        background: 'var(--c-bg-sunken)',
                        border: '1px solid var(--c-border)',
                        color: OP_COLORS[e.op_type] ?? 'var(--c-text-subtle)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}
                    >
                      <Icon name={(OP_ICONS[e.op_type] ?? 'layers') as never} size={11} />
                    </span>
                  </div>
                  <div style={{ minWidth: 0, padding: '2px 0 8px' }}>
                    <div className="row gap-8" style={{ flexWrap: 'wrap', rowGap: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{label}</span>
                      {qty && <span className="mono" style={{ fontSize: 12 }}>{qty}</span>}
                      {e.variant && <span className="t-sub">{e.variant}</span>}
                      {e.zone && !e.comment && (e.op_type === 'place' || e.op_type === 'move') && (
                        <span className="t-sub">→ {e.zone}</span>
                      )}
                    </div>
                    <div className="t-sub" style={{ marginTop: 2 }}>
                      {time}
                      {e.scans > 1 ? ` · ${e.scans} ${plural(e.scans, ['скан', 'скана', 'сканов'])}` : ''}
                      {e.user ? ` · ${e.user}` : ''}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
