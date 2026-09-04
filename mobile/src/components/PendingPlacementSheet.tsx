import { Sheet } from './Sheet'
import { Icon } from './Icon'
import { parseMoscow, variantTitle } from '../utils/format'
import type { ContainerPendingBox, ContainerPendingPlacement } from '../api/containersApi'

/** Дольше смены у стола — короб, скорее всего, забыли: помечаем предупреждением. */
const STALE_HOURS = 12

function pluralDays(n: number): string {
  const d10 = n % 10
  const d100 = n % 100
  if (d10 === 1 && d100 !== 11) return `${n} день`
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return `${n} дня`
  return `${n} дней`
}

/** Сколько объект ждёт у стола: «меньше часа», «3 ч», «2 дня». */
export function waiting(since: string | null | undefined): { label: string; stale: boolean } | null {
  if (!since) return null
  const dt = parseMoscow(since)
  if (Number.isNaN(dt.getTime())) return null
  const hours = Math.floor((Date.now() - dt.getTime()) / 3600000)
  const stale = hours >= STALE_HOURS
  if (hours < 1) return { label: 'меньше часа', stale }
  if (hours < 24) return { label: `${hours} ч`, stale }
  return { label: pluralDays(Math.floor(hours / 24)), stale }
}

function boxAge(b: ContainerPendingBox): number {
  if (!b.closed_at) return Number.MAX_SAFE_INTEGER
  const t = parseMoscow(b.closed_at).getTime()
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t
}

/** Что стоит у стола и ждёт развозки: короба и собранное без короба.
 *
 * Лист подбора для одной ходки тележки: короб берётся тапом (объект уникальный,
 * тап равен скану), товар без короба — только справка, потому что его количество
 * это число сканов, и готовое `qty` из списка сломало бы поштучный пересчёт.
 */
export function PendingPlacementSheet({
  data,
  takenIds,
  canTake,
  onTake,
  onClose,
}: {
  data: ContainerPendingPlacement
  takenIds: string[]
  canTake: boolean
  onTake: (box: ContainerPendingBox) => void
  onClose: () => void
}) {
  const boxes = [...data.boxes].sort((a, b) => boxAge(a) - boxAge(b))
  const oldest = waiting(data.since)
  const empty = boxes.length === 0 && data.aside.length === 0

  return (
    <Sheet onClose={onClose}>
      <h3>Что ждёт у стола</h3>
      <div className="line-sub" style={{ marginTop: 0 }}>
        {empty
          ? 'Пусто — всё развезено по местам'
          : `Коробов ${boxes.length} (${data.boxes_qty} шт.)${data.aside_qty > 0 ? ` · без короба ${data.aside_qty} шт.` : ''}`}
        {oldest && ` · самый старый ждёт ${oldest.label}`}
      </div>

      {boxes.length > 0 && (
        <>
          <div className="line-sub" style={{ marginTop: 16 }}>
            {canTake
              ? 'Короба — нажмите, чтобы взять в ходку'
              : 'Короба — чтобы взять, переключите «Откуда» на зону упаковки'}
          </div>
          <div className="combo-list" style={{ marginTop: 4 }}>
            {boxes.map((b) => {
              const taken = takenIds.includes(b.id)
              const w = waiting(b.closed_at)
              const meta = [
                b.client_name,
                `${b.items_qty} шт.`,
                w ? `у стола ${w.label}` : null,
              ].filter(Boolean).join(' · ')
              return (
                <button
                  key={b.id}
                  className="combo-opt"
                  style={taken ? { opacity: 0.6 } : undefined}
                  disabled={!canTake || taken}
                  onClick={() => onTake(b)}
                >
                  <Icon
                    name="box"
                    size={17}
                    style={{ flex: '0 0 auto', color: w?.stale ? 'var(--c-warning)' : 'var(--c-text-muted)' }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="line-name mono">{b.doc_number}</div>
                    <div
                      className="line-sub"
                      style={{ marginTop: 2, color: w?.stale ? 'var(--c-warning)' : undefined }}
                    >
                      {meta}
                    </div>
                  </div>
                  {taken ? (
                    <span className="badge success" style={{ flex: '0 0 auto' }}>
                      <span className="dot" />
                      в пачке
                    </span>
                  ) : canTake ? (
                    <Icon name="plus" size={17} style={{ flex: '0 0 auto', color: 'var(--c-text-muted)' }} />
                  ) : null}
                </button>
              )
            })}
          </div>
        </>
      )}

      {data.aside.length > 0 && (
        <>
          <div className="line-sub" style={{ marginTop: 16 }}>
            Без короба (габарит, брак) — сканируйте поштучно
          </div>
          <div className="combo-list" style={{ marginTop: 4 }}>
            {data.aside.map((i) => (
              <div
                key={`${i.product_id}-${i.color_id ?? ''}-${i.size_id ?? ''}-${i.quality}`}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="line-name">{variantTitle(i.product_name ?? '—', [i.color_name, i.size_name])}</div>
                  <div className="line-sub" style={{ marginTop: 2 }}>
                    {[i.product_sku, i.client_name].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div style={{ flex: '0 0 auto', textAlign: 'right' }}>
                  <div className="line-name">{i.qty} шт.</div>
                  {i.quality === 'defect' && (
                    <div className="line-sub" style={{ marginTop: 2, color: 'var(--c-danger)' }}>брак</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <button className="btn ghost" style={{ marginTop: 16 }} onClick={onClose}>
        Закрыть
      </button>
    </Sheet>
  )
}
