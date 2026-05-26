import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../primitives/Icon'
import { DatePicker } from '../primitives/DatePicker'

interface DateRangeProps {
  from: string
  to: string
  onFromChange: (v: string) => void
  onToChange: (v: string) => void
  onClear?: () => void
}

function formatShort(ymd: string): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ''
  const [, m, d] = ymd.split('-')
  return `${d}.${m}`
}

const POP_W = 340

export function DateRange({ from, to, onFromChange, onToChange, onClear }: DateRangeProps) {
  const [open, setOpen] = useState(false)
  const [popStyle, setPopStyle] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const hasValue = Boolean(from || to)

  const label = hasValue
    ? [formatShort(from), formatShort(to)].filter(Boolean).join(' — ')
    : 'Дата'

  const computePosition = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const scrollY = window.scrollY
    const scrollX = window.scrollX
    const popH = popoverRef.current?.offsetHeight ?? 120

    const spaceBelow = window.innerHeight - rect.bottom
    const flipUp = spaceBelow < popH + 8 && rect.top > popH + 8

    const top = flipUp
      ? scrollY + rect.top - popH - 4
      : scrollY + rect.bottom + 4

    let left = scrollX + rect.left
    if (left + POP_W > scrollX + window.innerWidth - 8) {
      left = scrollX + rect.right - POP_W
    }

    setPopStyle({ top, left })
  }, [])

  useEffect(() => {
    if (open) requestAnimationFrame(() => computePosition())
  }, [open, computePosition])

  useEffect(() => {
    if (!open) return
    const handle = () => computePosition()
    window.addEventListener('scroll', handle, true)
    window.addEventListener('resize', handle)
    return () => {
      window.removeEventListener('scroll', handle, true)
      window.removeEventListener('resize', handle)
    }
  }, [open, computePosition])

  useEffect(() => {
    if (!open) return
    const handleDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        popoverRef.current && !popoverRef.current.contains(target)
      ) {
        setOpen(false)
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleDown)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleDown)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const popover = open && createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Фильтр по дате"
      style={{
        position: 'absolute',
        top: popStyle.top,
        left: popStyle.left,
        width: POP_W,
        zIndex: 9999,
        background: 'var(--c-bg-elev)',
        border: '1px solid var(--c-border)',
        borderRadius: 'var(--r-xl)',
        boxShadow: 'var(--sh-3)',
        padding: '12px 14px',
        display: 'flex',
        gap: 10,
        alignItems: 'flex-end',
        visibility: popStyle.top === 0 && popStyle.left === 0 ? 'hidden' : 'visible',
      }}
      onMouseDown={e => e.preventDefault()}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, color: 'var(--c-text-faint)', marginBottom: 4 }}>От</div>
        <DatePicker value={from} onChange={onFromChange} placeholder="дд.мм.гггг" />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, color: 'var(--c-text-faint)', marginBottom: 4 }}>До</div>
        <DatePicker value={to} onChange={onToChange} placeholder="дд.мм.гггг" />
      </div>
    </div>,
    document.body
  )

  return (
    <div ref={triggerRef} style={{ position: 'relative' }}>
      <div
        className={`chip ${hasValue ? 'active' : ''}`}
        style={{ gap: 5, paddingRight: hasValue ? 6 : undefined, cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setOpen(o => !o)}
      >
        <Icon name="calendar" size={13} />
        <span style={{ fontSize: 12.5 }}>{label}</span>
        {hasValue && onClear && (
          <span
            className="x"
            onClick={(e) => { e.stopPropagation(); onClear(); setOpen(false) }}
            style={{ marginLeft: 2 }}
          >
            <Icon name="x" size={11} />
          </span>
        )}
      </div>
      {popover}
    </div>
  )
}
