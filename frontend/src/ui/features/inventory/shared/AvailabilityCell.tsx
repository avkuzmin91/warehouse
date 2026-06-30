import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../../primitives/Icon'

/** Доступность варианта на остатках — для строки состава отгрузки.
 *  `free` зеркалит серверный гейт (свободно = упаковано − резерв для годного,
 *  брак на хранении − резерв для брака); остальное — провенанс для поповера. */
export type LineAvailability = {
  free:       number
  ready:      number
  reserved:   number
  storage:    number
  packing:    number
  inTransit:  number
  isDefect:   boolean
}

type Props = {
  avail:       LineAvailability | null
  plannedQty:  number
  loading?:    boolean
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'muted' | 'warning' | 'success' }) {
  const color = tone === 'warning' ? 'var(--c-warning)' : tone === 'success' ? 'var(--c-success)' : tone === 'muted' ? 'var(--c-text-muted)' : undefined
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 12, padding: '2px 0' }}>
      <span style={{ color: tone === 'muted' ? 'var(--c-text-muted)' : 'var(--c-text-subtle)' }}>{label}</span>
      <span className="mono" style={{ color, fontWeight: tone === 'success' ? 600 : undefined }}>{value}</span>
    </div>
  )
}

const POP_WIDTH = 220

export function AvailabilityCell({ avail, plannedQty, loading }: Props) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  // Поповер рендерится порталом в body (иначе срезается блоком «Состав отгрузки»);
  // позицию считаем по триггеру, с переворотом вверх, если снизу не хватает места.
  const [popStyle, setPopStyle] = useState<React.CSSProperties>({ position: 'fixed', top: -9999, left: -9999 })

  const place = useCallback(() => {
    const t = triggerRef.current?.getBoundingClientRect()
    if (!t) return
    const gap = 6
    const ph = popRef.current?.offsetHeight ?? 0
    const left = Math.min(Math.max(t.right - POP_WIDTH, 8), window.innerWidth - POP_WIDTH - 8)
    const roomBelow = window.innerHeight - t.bottom
    const up = roomBelow < ph + gap + 8 && t.top > ph + gap + 8
    const top = up ? t.top - gap - ph : t.bottom + gap
    setPopStyle({ position: 'fixed', top, left, width: POP_WIDTH })
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, place])

  if (loading) {
    return <div className="t-sub" style={{ textAlign: 'right', marginTop: 5 }}>…</div>
  }
  if (!avail) {
    return <div className="t-sub" style={{ textAlign: 'right', marginTop: 5, color: 'var(--c-text-muted)' }}>нет данных</div>
  }

  const label = avail.isDefect ? 'брак' : 'свободно'
  // План сверх свободного остатка допустим (добор со склада/в пути при подготовке) —
  // это мягкое предупреждение, а не ошибка: на этом этапе сохраняется лишь черновик.
  const over = plannedQty > avail.free

  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 5 }}>
      <span
        ref={triggerRef}
        style={{ display: 'inline-flex' }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <span
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 500,
            cursor: 'default', whiteSpace: 'nowrap',
            background: over ? 'var(--c-warning-bg)' : 'var(--c-success-bg)',
            color: over ? 'var(--c-warning)' : 'var(--c-success)',
          }}
        >
          <Icon name={over ? 'alert' : 'check'} size={12} />
          {label} {avail.free}
        </span>
      </span>

      {open && createPortal(
        <div
          ref={popRef}
          style={{
            ...popStyle, zIndex: 9999, textAlign: 'left',
            background: 'var(--c-bg-elev)', border: '1px solid var(--c-border)',
            borderRadius: 8, boxShadow: 'var(--sh-2)', padding: '10px 12px',
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--c-text-muted)', marginBottom: 6 }}>Откуда остаток</div>
          {avail.isDefect ? (
            <Row label="Брак на хранении" value={String(avail.storage)} />
          ) : (
            <Row label="Упаковано" value={String(avail.ready)} />
          )}
          {avail.reserved > 0 && <Row label="В резерве" value={`−${avail.reserved}`} tone="warning" />}
          <div style={{ borderTop: '1px solid var(--c-border)', marginTop: 4, paddingTop: 5 }}>
            <Row label={avail.isDefect ? 'Доступно' : 'Свободно'} value={String(avail.free)} tone="success" />
          </div>
          {!avail.isDefect && avail.storage > 0 && <Row label="На хранении" value={String(avail.storage)} tone="muted" />}
          {!avail.isDefect && avail.packing > 0 && <Row label="На упаковке" value={String(avail.packing)} tone="muted" />}
          {!avail.isDefect && avail.inTransit > 0 && <Row label="В пути" value={String(avail.inTransit)} tone="muted" />}
          {over && (
            <div style={{ marginTop: 7, fontSize: 11, color: 'var(--c-text-muted)', display: 'flex', gap: 5, alignItems: 'flex-start' }}>
              <Icon name="clock" size={12} style={{ flexShrink: 0, marginTop: 1 }} />
              План сверх свободного — добор со склада/в пути при подготовке
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
