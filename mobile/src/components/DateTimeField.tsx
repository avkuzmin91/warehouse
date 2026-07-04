import { useEffect, useMemo, useState } from 'react'
import { Icon } from './Icon'
import { useHardwareBack } from '../nav/backHandlers'
import { moscowNowIso } from '../utils/format'

const MONTHS = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
]
const MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

const pad = (n: number) => String(n).padStart(2, '0')

/** value/onChange используют формат <input type="datetime-local">: YYYY-MM-DDTHH:mm */
function parse(value: string): { y: number; m: number; d: number; hh: number; mm: number; hasTime: boolean } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value)
  if (!match) return null
  return {
    y: Number(match[1]),
    m: Number(match[2]) - 1,
    d: Number(match[3]),
    hh: Number(match[4] ?? 0),
    mm: Number(match[5] ?? 0),
    hasTime: match[4] != null && match[5] != null,
  }
}

function build(y: number, m: number, d: number, hh: number, mm: number): string {
  return `${y}-${pad(m + 1)}-${pad(d)}T${pad(hh)}:${pad(mm)}`
}

export function isDateTimeComplete(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
}

export function isDateTimeBefore(end: string, start: string): boolean {
  return isDateTimeComplete(end) && isDateTimeComplete(start) && end < start
}

function label(value: string): string {
  const p = parse(value)
  if (!p) return ''
  if (!p.hasTime) return `${p.d} ${MONTHS_GEN[p.m]} ${p.y}`
  return `${p.d} ${MONTHS_GEN[p.m]} ${p.y}, ${pad(p.hh)}:${pad(p.mm)}`
}

/** Кол-во дней в месяце и смещение первого дня (Пн = 0). */
function monthGrid(y: number, m: number): (number | null)[] {
  const first = new Date(y, m, 1)
  const lead = (first.getDay() + 6) % 7
  const days = new Date(y, m + 1, 0).getDate()
  const cells: (number | null)[] = []
  for (let i = 0; i < lead; i++) cells.push(null)
  for (let d = 1; d <= days; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

export function DateTimeField({
  value,
  onChange,
  invalid,
  placeholder = 'Выберите дату и время',
  title = 'Дата и время',
}: {
  value: string
  onChange: (value: string) => void
  invalid?: boolean
  placeholder?: string
  title?: string
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const [minText, setMinText] = useState('')
  const [view, setView] = useState(() => {
    const p = parse(value) ?? parse(initialNow())!
    return { y: p.y, m: p.m }
  })

  const sel = useMemo(() => parse(draft), [draft])
  useEffect(() => { setMinText(sel ? pad(sel.mm) : '00') }, [open])
  const today = useMemo(() => {
    const t = parse(initialNow())!
    return { y: t.y, m: t.m, d: t.d }
  }, [open])

  function start() {
    const base = value || initialNow()
    const p = parse(base) ?? parse(initialNow())!
    setDraft(build(p.y, p.m, p.d, p.hh, p.mm))
    setMinText(pad(p.mm))
    setView({ y: p.y, m: p.m })
    setOpen(true)
  }

  function pickDay(d: number) {
    const cur = parse(draft) ?? parse(initialNow())!
    setDraft(build(view.y, view.m, d, cur.hh, cur.mm))
  }

  function pickTime(hh: number, mm: number) {
    const cur = parse(draft) ?? parse(initialNow())!
    setDraft(build(cur.y, cur.m, cur.d, hh, mm))
  }

  function shiftMonth(delta: number) {
    const next = new Date(view.y, view.m + delta, 1)
    setView({ y: next.getFullYear(), m: next.getMonth() })
  }

  function confirm() {
    onChange(draft)
    setOpen(false)
  }

  useHardwareBack(() => setOpen(false), open)

  const cells = monthGrid(view.y, view.m)

  return (
    <>
      <button
        type="button"
        className={`selectish dtf${invalid ? ' invalid' : ''}`}
        onClick={start}
      >
        <Icon name="calendar" size={18} />
        <span className={value ? '' : 'dtf-ph'}>{value ? label(value) : placeholder}</span>
      </button>

      {open && (
        <div className="sheet-backdrop dtf-pop" onClick={() => setOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grip" />
            <h3>{title}</h3>

            <div className="dtf-cal-head">
              <button type="button" className="dtf-nav" onClick={() => shiftMonth(-1)} aria-label="Предыдущий месяц">
                <Icon name="chev" size={20} style={{ transform: 'rotate(180deg)' }} />
              </button>
              <div className="dtf-month">
                {MONTHS[view.m][0].toUpperCase() + MONTHS[view.m].slice(1)} {view.y}
              </div>
              <button type="button" className="dtf-nav" onClick={() => shiftMonth(1)} aria-label="Следующий месяц">
                <Icon name="chev" size={20} />
              </button>
            </div>

            <div className="dtf-grid dtf-dow">
              {WEEKDAYS.map((w) => (
                <div key={w} className="dtf-dowcell">{w}</div>
              ))}
            </div>
            <div className="dtf-grid">
              {cells.map((d, i) => {
                if (d == null) return <div key={i} className="dtf-day empty" />
                const isSel = sel != null && sel.y === view.y && sel.m === view.m && sel.d === d
                const isToday = today.y === view.y && today.m === view.m && today.d === d
                return (
                  <button
                    key={i}
                    type="button"
                    className={`dtf-day${isSel ? ' on' : ''}${isToday ? ' today' : ''}`}
                    onClick={() => pickDay(d)}
                  >
                    {d}
                  </button>
                )
              })}
            </div>

            <div className="dtf-time">
              <Icon name="clock" size={18} />
              <select
                className="selectish dtf-tsel"
                value={sel ? pad(sel.hh) : '00'}
                onChange={(e) => pickTime(Number(e.target.value), sel?.mm ?? 0)}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={pad(h)}>{pad(h)}</option>
                ))}
              </select>
              <span className="dtf-colon">:</span>
              <input
                className="dtf-min"
                inputMode="numeric"
                maxLength={2}
                value={minText}
                onChange={(e) => {
                  const raw = e.target.value.replace(/\D/g, '').slice(0, 2)
                  setMinText(raw)
                  pickTime(sel?.hh ?? 0, Math.min(59, Number(raw || 0)))
                }}
                onBlur={() => setMinText(sel ? pad(sel.mm) : '00')}
              />
            </div>

            <div className="dtf-actions">
              <button type="button" className="btn ghost" onClick={() => setDraft(initialNow())}>
                Сейчас
              </button>
              <button type="button" className="btn" onClick={confirm}>
                <Icon name="check" size={18} /> Готово
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function initialNow(): string {
  return moscowNowIso().slice(0, 16)
}
