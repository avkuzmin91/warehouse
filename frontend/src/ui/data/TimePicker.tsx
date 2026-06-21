import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../primitives/Icon'

interface TimePickerProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  invalid?: boolean
  step?: number // шаг сетки в минутах (по умолчанию 15)
  width?: number | string
  height?: number
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Свободный ввод «чч:мм» → нормализованное HH:MM, либо null. Принимает «8», «830», «08:05», «2005». */
function parseTime(q: string): string | null {
  const d = q.replace(/\D/g, '')
  if (!d) return null
  let hh: number, mm: number
  if (d.length <= 2) { hh = +d; mm = 0 }
  else if (d.length === 3) { hh = +d.slice(0, 1); mm = +d.slice(1) }
  else { hh = +d.slice(0, 2); mm = +d.slice(2, 4) }
  if (hh > 23 || mm > 59) return null
  return `${pad(hh)}:${pad(mm)}`
}

/** Выбор времени в стиле сайта: триггер-поле с видимой иконкой часов + портальный поповер
 *  со списком вариантов и ручным вводом для произвольных минут. Заменяет нативный input[type=time],
 *  чей пикер не совпадает с темой сайта, а кнопку открытия почти не видно. */
export function TimePicker({ value, onChange, disabled, invalid, step = 15, width = '100%', height = 30 }: TimePickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({})
  const containerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<HTMLDivElement>(null)

  const grid = useMemo(() => {
    const out: string[] = []
    for (let h = 0; h < 24; h++) for (let m = 0; m < 60; m += step) out.push(`${pad(h)}:${pad(m)}`)
    return out
  }, [step])

  const digits = query.replace(/\D/g, '')
  const suggestion = parseTime(query)
  const options = useMemo(() => {
    let base = digits ? grid.filter((t) => t.replace(':', '').startsWith(digits)) : grid
    if (suggestion && !base.includes(suggestion)) base = [suggestion, ...base]
    return base
  }, [grid, digits, suggestion])

  const updatePosition = () => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const gap = 4
    const desired = 260
    const w = Math.max(rect.width, 132)
    const spaceBelow = window.innerHeight - rect.bottom - 8
    const spaceAbove = rect.top - 8
    if (spaceBelow < 160 && spaceAbove > spaceBelow) {
      setDropdownStyle({ position: 'fixed', bottom: window.innerHeight - rect.top + gap, left: rect.left, width: w, maxHeight: Math.min(desired, Math.max(120, spaceAbove - gap)) })
    } else {
      setDropdownStyle({ position: 'fixed', top: rect.bottom + gap, left: rect.left, width: w, maxHeight: Math.min(desired, Math.max(120, spaceBelow - gap)) })
    }
  }

  useEffect(() => {
    if (!open) return
    updatePosition()
    const onScroll = () => updatePosition()
    window.addEventListener('resize', onScroll)
    window.addEventListener('scroll', onScroll, true)
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (containerRef.current?.contains(t) || dropdownRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    setTimeout(() => {
      inputRef.current?.focus({ preventScroll: true })
      const list = listRef.current
      const sel = selectedRef.current
      if (list && sel) list.scrollTop = sel.offsetTop - list.clientHeight / 2 + sel.clientHeight / 2
    }, 10)
    return () => {
      window.removeEventListener('resize', onScroll)
      window.removeEventListener('scroll', onScroll, true)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  const handleOpen = () => {
    if (disabled) return
    setQuery('')
    setOpen(true)
  }
  const select = (v: string) => { onChange(v); setOpen(false); setQuery('') }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); setQuery('') }
    if (e.key === 'Enter') { e.preventDefault(); if (suggestion) select(suggestion); else if (options[0]) select(options[0]) }
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', width, flexShrink: 0 }}>
      <div
        className="input sm"
        onClick={handleOpen}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, height, padding: '0 8px',
          cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, boxSizing: 'border-box',
          ...(invalid ? { borderColor: 'var(--c-danger)' } : open ? { borderColor: 'var(--c-accent)', boxShadow: '0 0 0 3px var(--c-accent-bg)' } : null),
        }}
      >
        <span className={value ? 'mono' : ''} style={{ flex: 1, fontSize: value ? 12.5 : 12, fontWeight: value ? 500 : 400, color: value ? 'var(--c-text)' : 'var(--c-text-subtle)' }}>
          {value || '—:—'}
        </span>
        <Icon name="clock" size={13} style={{ color: open ? 'var(--c-accent)' : 'var(--c-text-muted)', flexShrink: 0 }} />
      </div>

      {open && createPortal(
        <div
          ref={dropdownRef}
          style={{ ...dropdownStyle, background: 'var(--c-bg-elev)', border: '1px solid var(--c-border)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--sh-2)', zIndex: 9999, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        >
          <div style={{ padding: 6, borderBottom: '1px solid var(--c-border)' }}>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKey}
              placeholder="чч:мм"
              className="input sm"
              style={{ width: '100%', height: 28 }}
            />
          </div>
          <div ref={listRef} style={{ overflowY: 'auto', padding: 4 }}>
            {options.length === 0 ? (
              <div style={{ padding: '10px', fontSize: 12.5, color: 'var(--c-text-subtle)', textAlign: 'center' }}>Неверное время</div>
            ) : options.map((t) => (
              <div
                key={t}
                ref={t === value ? selectedRef : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(t)}
                className="mono"
                style={{
                  padding: '6px 10px', borderRadius: 'var(--r-md)', cursor: 'pointer', fontSize: 13,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: t === value ? 'var(--c-bg-hover)' : '',
                  fontWeight: t === value ? 600 : 400,
                }}
              >
                {t}
                {t === value && <Icon name="check" size={12} style={{ color: 'var(--c-accent)' }} />}
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
