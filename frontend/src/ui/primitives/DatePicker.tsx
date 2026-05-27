import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

interface DatePickerProps {
  value: string // YYYY-MM-DD
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  portalGroup?: string // data attribute so parent DateRange can detect this portal
}

const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]
const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const POP_W = 272

function parseYmd(ymd: string): Date | null {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  if (isNaN(dt.getTime())) return null
  return dt
}

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDisplay(ymd: string): string {
  const d = parseYmd(ymd)
  if (!d) return ''
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfWeek(year: number, month: number): number {
  const day = new Date(year, month, 1).getDay()
  return day === 0 ? 6 : day - 1
}

type ViewMode = 'days' | 'months' | 'years'

interface PopoverStyle {
  top: number
  left: number
}

export function DatePicker({ value, onChange, placeholder = 'дд.мм.гггг', disabled, className = '', portalGroup }: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const [inputText, setInputText] = useState(formatDisplay(value))
  const [viewMode, setViewMode] = useState<ViewMode>('days')
  const [popStyle, setPopStyle] = useState<PopoverStyle>({ top: 0, left: 0 })
  const [popFlipUp, setPopFlipUp] = useState(false)

  const today = new Date()
  const selected = parseYmd(value)
  const initialYear = selected?.getFullYear() ?? today.getFullYear()
  const initialMonth = selected?.getMonth() ?? today.getMonth()

  const [viewYear, setViewYear] = useState(initialYear)
  const [viewMonth, setViewMonth] = useState(initialMonth)
  const [yearPageStart, setYearPageStart] = useState(Math.floor(initialYear / 12) * 12)

  const triggerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const computePosition = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const scrollY = window.scrollY
    const scrollX = window.scrollX
    const popH = popoverRef.current?.offsetHeight ?? 320
    const spaceBelow = window.innerHeight - rect.bottom
    const flipUp = spaceBelow < popH + 8 && rect.top > popH + 8

    setPopFlipUp(flipUp)

    const top = flipUp
      ? scrollY + rect.top - popH - 4
      : scrollY + rect.bottom + 4

    // Keep within viewport horizontally
    let left = scrollX + rect.left
    if (left + POP_W > scrollX + window.innerWidth - 8) {
      left = scrollX + rect.right - POP_W
    }

    setPopStyle({ top, left })
  }, [])

  // Sync display text when value changes externally
  useEffect(() => {
    setInputText(formatDisplay(value))
  }, [value])

  // Sync calendar view on open
  useEffect(() => {
    if (open) {
      if (selected) {
        setViewYear(selected.getFullYear())
        setViewMonth(selected.getMonth())
        setYearPageStart(Math.floor(selected.getFullYear() / 12) * 12)
      }
      setViewMode('days')
      // Position after DOM paint
      requestAnimationFrame(() => computePosition())
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reposition when view mode changes (height changes)
  useEffect(() => {
    if (open) requestAnimationFrame(() => computePosition())
  }, [viewMode, open, computePosition])

  // Reposition on scroll/resize
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

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return
    const handleDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        popoverRef.current && !popoverRef.current.contains(target)
      ) {
        setOpen(false)
        setInputText(formatDisplay(value))
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); setInputText(formatDisplay(value)) }
    }
    document.addEventListener('mousedown', handleDown)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleDown)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open, value])

  const selectDate = useCallback((d: Date) => {
    const ymd = toYmd(d)
    onChange(ymd)
    setInputText(formatDisplay(ymd))
    setOpen(false)
  }, [onChange])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    setInputText(raw)
    const m = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
    if (m) {
      const d = parseInt(m[1]), mo = parseInt(m[2]), y = parseInt(m[3])
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= getDaysInMonth(y, mo - 1)) {
        const dt = new Date(y, mo - 1, d)
        onChange(toYmd(dt))
        setViewYear(y); setViewMonth(mo - 1)
        return
      }
    }
    const m2 = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (m2) {
      const y = parseInt(m2[1]), mo = parseInt(m2[2]), d = parseInt(m2[3])
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= getDaysInMonth(y, mo - 1)) {
        const dt = new Date(y, mo - 1, d)
        onChange(toYmd(dt))
        setViewYear(y); setViewMonth(mo - 1)
      }
    }
  }

  const handleInputBlur = () => setInputText(formatDisplay(value))
  const handleInputFocus = () => { if (!disabled) setOpen(true) }

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }

  // Build calendar grid
  const daysInMonth = getDaysInMonth(viewYear, viewMonth)
  const firstDow = getFirstDayOfWeek(viewYear, viewMonth)
  const cells: (number | null)[] = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const todayYmd = toYmd(today)
  const years = Array.from({ length: 12 }, (_, i) => yearPageStart + i)

  const popover = open && createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Выбор даты"
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
        userSelect: 'none',
        // Invisible until position computed (prevents flash at 0,0)
        visibility: popStyle.top === 0 && popStyle.left === 0 ? 'hidden' : 'visible',
      }}
      onMouseDown={e => e.preventDefault()}
      {...(portalGroup ? { 'data-daterange-group': portalGroup } : {})}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '10px 10px 6px' }}>
        {viewMode === 'days' && (
          <button className="dp-nav-btn" onClick={prevMonth} aria-label="Предыдущий месяц">
            <Icon name="arrowLeft" size={14} />
          </button>
        )}
        {viewMode === 'years' && (
          <button className="dp-nav-btn" onClick={() => setYearPageStart(y => y - 12)} aria-label="Предыдущие годы">
            <Icon name="arrowLeft" size={14} />
          </button>
        )}

        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', gap: 4 }}>
          {viewMode === 'days' && (
            <>
              <button className="dp-header-btn" onClick={() => setViewMode('months')} aria-label="Выбрать месяц">
                {MONTH_NAMES[viewMonth]}
              </button>
              <button className="dp-header-btn" onClick={() => { setYearPageStart(Math.floor(viewYear / 12) * 12); setViewMode('years') }} aria-label="Выбрать год">
                {viewYear}
              </button>
            </>
          )}
          {viewMode === 'months' && (
            <button className="dp-header-btn active" onClick={() => setViewMode('days')}>{viewYear}</button>
          )}
          {viewMode === 'years' && (
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-text-muted)' }}>
              {yearPageStart}–{yearPageStart + 11}
            </span>
          )}
        </div>

        {viewMode === 'days' && (
          <button className="dp-nav-btn" onClick={nextMonth} aria-label="Следующий месяц">
            <Icon name="arrowRight" size={14} />
          </button>
        )}
        {viewMode === 'years' && (
          <button className="dp-nav-btn" onClick={() => setYearPageStart(y => y + 12)} aria-label="Следующие годы">
            <Icon name="arrowRight" size={14} />
          </button>
        )}
      </div>

      {/* Days view */}
      {viewMode === 'days' && (
        <div style={{ padding: '0 8px 10px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 2 }}>
            {DAY_NAMES.map(d => (
              <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 500, color: 'var(--c-text-faint)', padding: '3px 0' }}>{d}</div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
            {cells.map((day, i) => {
              if (day === null) return <div key={`e-${i}`} />
              const cellYmd = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
              const isToday = cellYmd === todayYmd
              const isSelected = cellYmd === value
              return (
                <button
                  key={day}
                  className={['dp-day', isToday ? 'today' : '', isSelected ? 'selected' : ''].filter(Boolean).join(' ')}
                  onClick={() => selectDate(new Date(viewYear, viewMonth, day))}
                  aria-label={`${day} ${MONTH_NAMES[viewMonth]} ${viewYear}`}
                  aria-pressed={isSelected}
                >
                  {day}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Months view */}
      {viewMode === 'months' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, padding: '4px 10px 12px' }}>
          {MONTH_NAMES.map((name, i) => {
            const isSelected = i === viewMonth && (selected ? selected.getFullYear() === viewYear : false)
            const isCurrent = i === today.getMonth() && viewYear === today.getFullYear()
            return (
              <button
                key={name}
                className={['dp-month-cell', isSelected ? 'selected' : '', isCurrent && !isSelected ? 'today' : ''].filter(Boolean).join(' ')}
                onClick={() => { setViewMonth(i); setViewMode('days') }}
              >
                {name.slice(0, 3)}
              </button>
            )
          })}
        </div>
      )}

      {/* Years view */}
      {viewMode === 'years' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, padding: '4px 10px 12px' }}>
          {years.map(y => {
            const isSelected = y === viewYear
            const isCurrent = y === today.getFullYear()
            return (
              <button
                key={y}
                className={['dp-year-cell', isSelected ? 'selected' : '', isCurrent && !isSelected ? 'today' : ''].filter(Boolean).join(' ')}
                onClick={() => { setViewYear(y); setViewMode('months') }}
              >
                {y}
              </button>
            )
          })}
        </div>
      )}

      {/* Footer */}
      <div style={{ borderTop: '1px solid var(--c-border)', padding: '7px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button className="dp-footer-btn" onClick={() => selectDate(today)}>Сегодня</button>
        {value && (
          <button className="dp-footer-btn muted" onClick={() => { onChange(''); setInputText(''); setOpen(false) }}>
            Очистить
          </button>
        )}
      </div>

      {/* Flip-up indicator (tiny arrow) */}
      {popFlipUp && (
        <div style={{
          position: 'absolute', bottom: -5, left: 20,
          width: 10, height: 10,
          background: 'var(--c-bg-elev)',
          border: '1px solid var(--c-border)',
          borderTop: 'none', borderLeft: 'none',
          transform: 'rotate(45deg)',
        }} />
      )}
    </div>,
    document.body
  )

  return (
    <div ref={triggerRef} style={{ position: 'relative' }} className={className}>
      <div
        className="input dp-trigger"
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          paddingRight: 6, cursor: disabled ? 'default' : 'text',
          opacity: disabled ? 0.5 : 1,
        }}
        onClick={() => { if (!disabled) { setOpen(true); setTimeout(() => inputRef.current?.focus(), 10) } }}
      >
        <input
          ref={inputRef}
          value={inputText}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          placeholder={placeholder}
          disabled={disabled}
          aria-label="Дата"
          aria-haspopup="dialog"
          aria-expanded={open}
          style={{ flex: 1, border: 0, outline: 'none', background: 'transparent', fontSize: 13, cursor: 'inherit', minWidth: 0 }}
          onClick={e => e.stopPropagation()}
        />
        <Icon name="calendar" size={14} style={{ color: 'var(--c-text-subtle)', flexShrink: 0 }} />
      </div>
      {popover}
    </div>
  )
}
