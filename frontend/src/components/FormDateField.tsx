import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { FieldDropdownChevron } from './FieldDropdownChevron'
import { formatIsoDateToDdMmYyyy } from './DateRangeFilter'

const PLACEHOLDER_DISPLAY = 'дд.мм.гггг'

function isValidYyyyMmDd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function maskDigitsToDdMmYyyy(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}.${digits.slice(2)}`
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`
}

/** DD.MM.YYYY → YYYY-MM-DD (локальная дата) или null */
export function parseDdMmYyyyToIso(s: string): string | null {
  const t = s.trim()
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(t)
  if (!m) return null
  const d = Number(m[1])
  const mo = Number(m[2])
  const y = Number(m[3])
  const dt = new Date(y, mo - 1, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const MONTHS_RU = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
]

const WEEKDAYS_RU_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

function isoFromParts(y: number, m0: number, d: number): string {
  const dt = new Date(y, m0, d)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function daysInMonth(y: number, m0: number): number {
  return new Date(y, m0 + 1, 0).getDate()
}

export type FormDateFieldProps = {
  id: string
  /** YYYY-MM-DD или пусто */
  value: string
  onChange: (next: string) => void
  min?: string
  max?: string
  disabled?: boolean
  className?: string
  /** aria-label для поля (кратко, например «Дата приёмки») */
  ariaLabel: string
}

/**
 * Поле одной даты по ТЗ: отображение DD.MM.YYYY, плейсхолдер дд.мм.гггг, календарь, очистка, ручной ввод с маской.
 * Хранение: ISO YYYY-MM-DD.
 */
export function FormDateField({
  id,
  value,
  onChange,
  min,
  max,
  disabled = false,
  className = '',
  ariaLabel,
}: FormDateFieldProps) {
  const errorId = useId()
  const popoverId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const valueRef = useRef(value)
  valueRef.current = value
  const [open, setOpen] = useState(false)
  const [draftText, setDraftText] = useState('')
  const [focused, setFocused] = useState(false)
  const [fieldError, setFieldError] = useState('')
  const [panelTop, setPanelTop] = useState(false)

  const hasValue = Boolean(value && isValidYyyyMmDd(value))
  const displayFromProp = hasValue ? formatIsoDateToDdMmYyyy(value) : ''

  useEffect(() => {
    if (!focused) {
      setDraftText(displayFromProp)
    }
  }, [value, displayFromProp, focused])

  const visibleValue = focused ? draftText : displayFromProp

  const minOk = !min || !isValidYyyyMmDd(min) ? undefined : min
  const maxOk = !max || !isValidYyyyMmDd(max) ? undefined : max

  const initialMonth = (() => {
    if (hasValue && value) {
      const [y, m] = value.split('-').map(Number)
      return { y, m0: m - 1 }
    }
    const t = new Date()
    return { y: t.getFullYear(), m0: t.getMonth() }
  })()

  const [viewY, setViewY] = useState(initialMonth.y)
  const [viewM0, setViewM0] = useState(initialMonth.m0)

  useEffect(() => {
    if (!open) return
    if (hasValue && value) {
      const [y, m] = value.split('-').map(Number)
      setViewY(y)
      setViewM0(m - 1)
    }
  }, [open, hasValue, value])

  useLayoutEffect(() => {
    if (!open || !rootRef.current) return
    const root = rootRef.current
    const rect = root.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const panelH = 340
    setPanelTop(spaceBelow < panelH && rect.top > spaceBelow)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      const t = e.target as Node
      if (rootRef.current && !rootRef.current.contains(t)) {
        setOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function inRange(iso: string): boolean {
    if (minOk && iso < minOk) return false
    if (maxOk && iso > maxOk) return false
    return true
  }

  function commitText(nextText: string) {
    setFieldError('')
    const t = nextText.trim()
    if (t === '') {
      onChange('')
      return
    }
    const iso = parseDdMmYyyyToIso(t)
    if (!iso) {
      setFieldError('Неверный формат или несуществующая дата')
      return
    }
    if (!inRange(iso)) {
      setFieldError('Дата вне допустимого диапазона')
      return
    }
    onChange(iso)
  }

  function pickDay(y: number, m0: number, d: number) {
    const iso = isoFromParts(y, m0, d)
    if (!inRange(iso)) return
    setFieldError('')
    onChange(iso)
    setDraftText(formatIsoDateToDdMmYyyy(iso))
    setOpen(false)
    // focus после коммита родителя: иначе onFocus срабатывает со старым value и затирает черновик
    window.setTimeout(() => {
      inputRef.current?.focus()
    }, 0)
  }

  function clearDate() {
    if (disabled) return
    setFieldError('')
    onChange('')
    setDraftText('')
  }

  const firstDayOffset = (() => {
    const js = new Date(viewY, viewM0, 1).getDay()
    return (js + 6) % 7
  })()

  const dim = daysInMonth(viewY, viewM0)
  const cells: ({ day: number } | null)[] = []
  for (let i = 0; i < firstDayOffset; i++) cells.push(null)
  for (let d = 1; d <= dim; d++) cells.push({ day: d })
  while (cells.length % 7 !== 0) cells.push(null)

  const today = new Date()
  const todayIso = isoFromParts(today.getFullYear(), today.getMonth(), today.getDate())

  const yearOptions: number[] = []
  const yLo = minOk ? Number(minOk.slice(0, 4)) : 1920
  const yHi = maxOk ? Number(maxOk.slice(0, 4)) : new Date().getFullYear() + 5
  const yMin = Math.min(yLo, yHi)
  const yMax = Math.max(yLo, yHi)
  for (let y = yMin; y <= yMax; y++) yearOptions.push(y)

  return (
    <div
      ref={rootRef}
      className={`form-date-field ${className}`.trim()}
    >
      <div className={`form-date-field__control${hasValue ? ' form-date-field__control--has-value' : ''}`.trim()}>
        <input
          ref={inputRef}
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          disabled={disabled}
          placeholder={PLACEHOLDER_DISPLAY}
          className={`field-input form-date-field__input${fieldError ? ' form-date-field__input--error' : ''}`.trim()}
          aria-label={ariaLabel}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? errorId : undefined}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? popoverId : undefined}
          value={visibleValue}
          onChange={(e) => {
            setDraftText(maskDigitsToDdMmYyyy(e.target.value))
            setFieldError('')
          }}
          onFocus={() => {
            setFocused(true)
            const v = valueRef.current
            setDraftText(v && isValidYyyyMmDd(v) ? formatIsoDateToDdMmYyyy(v) : '')
          }}
          onBlur={() => {
            setFocused(false)
            commitText(draftText)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (!open) setOpen(true)
            }
          }}
        />
        {hasValue ? (
          <div className="form-date-field__leading">
            <button
              type="button"
              tabIndex={-1}
              className="list-filters__select-clear form-date-field__clear-btn"
              disabled={disabled}
              aria-label="Очистить дату"
              title="Очистить"
              onMouseDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
              }}
              onClick={clearDate}
            >
              <svg className="list-filters__select-clear-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M18 6L6 18M6 6l12 12"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        ) : null}
        <div className="form-date-field__trailing">
          <button
            type="button"
            tabIndex={-1}
            className="form-date-field__calendar-btn"
            disabled={disabled}
            aria-label="Открыть календарь"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (disabled) return
              setOpen((o) => !o)
            }}
          >
            <svg className="form-date-field__calendar-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect
                x="3.5"
                y="5.5"
                width="17"
                height="15"
                rx="2"
                stroke="currentColor"
                strokeWidth="1.7"
              />
              <path d="M3.5 9.5h17" stroke="currentColor" strokeWidth="1.7" />
              <path d="M8 3.5v4M16 3.5v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {fieldError ? (
        <p id={errorId} className="form-date-field__error error-text" role="alert">
          {fieldError}
        </p>
      ) : null}

      {open ? (
        <div
          id={popoverId}
          className={`form-date-field__popover${panelTop ? ' form-date-field__popover--top' : ''}`.trim()}
          role="dialog"
          aria-label="Календарь"
        >
          <div className="form-date-field__toolbar">
            <button
              type="button"
              className="form-date-field__nav"
              aria-label="Предыдущий месяц"
              onClick={() => {
                const d = new Date(viewY, viewM0 - 1, 1)
                setViewY(d.getFullYear())
                setViewM0(d.getMonth())
              }}
            >
              ‹
            </button>
            <div className="list-filters form-date-field__toolbar-filters">
              <div className="list-filters__field form-date-field__toolbar-field form-date-field__toolbar-field--month">
                <div className="list-filters__select-wrap">
                  <select
                    id={`${id}-month`}
                    className="field-input list-filters__select"
                    aria-label="Месяц"
                    value={viewM0}
                    onChange={(e) => setViewM0(Number(e.target.value))}
                  >
                    {MONTHS_RU.map((name, i) => (
                      <option key={name} value={i}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <FieldDropdownChevron />
                </div>
              </div>
              <div className="list-filters__field form-date-field__toolbar-field form-date-field__toolbar-field--year">
                <div className="list-filters__select-wrap">
                  <select
                    id={`${id}-year`}
                    className="field-input list-filters__select"
                    aria-label="Год"
                    value={viewY}
                    onChange={(e) => setViewY(Number(e.target.value))}
                  >
                    {yearOptions.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                  <FieldDropdownChevron />
                </div>
              </div>
            </div>
            <button
              type="button"
              className="form-date-field__nav"
              aria-label="Следующий месяц"
              onClick={() => {
                const d = new Date(viewY, viewM0 + 1, 1)
                setViewY(d.getFullYear())
                setViewM0(d.getMonth())
              }}
            >
              ›
            </button>
          </div>

          <div className="form-date-field__weekdays" role="row">
            {WEEKDAYS_RU_SHORT.map((w) => (
              <span key={w} className="form-date-field__weekday" role="columnheader">
                {w}
              </span>
            ))}
          </div>

          <div className="form-date-field__grid" role="grid">
            {cells.map((cell, idx) => {
              if (!cell) {
                return <span key={`e-${idx}`} className="form-date-field__cell form-date-field__cell--empty" />
              }
              const iso = isoFromParts(viewY, viewM0, cell.day)
              const disabledDay = !inRange(iso)
              const isSelected = hasValue && value === iso
              const isToday = iso === todayIso
              return (
                <button
                  key={iso}
                  type="button"
                  role="gridcell"
                  disabled={disabledDay}
                  aria-selected={isSelected}
                  className={[
                    'form-date-field__day',
                    isSelected ? 'form-date-field__day--selected' : '',
                    isToday && !isSelected ? 'form-date-field__day--today' : '',
                    disabledDay ? 'form-date-field__day--disabled' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickDay(viewY, viewM0, cell.day)}
                >
                  {cell.day}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
