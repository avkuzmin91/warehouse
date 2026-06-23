import { useMemo, useState } from 'react'
import { Icon } from './Icon'

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

/** value/onChange используют формат <input type="date">: YYYY-MM-DD */
function parse(value: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return null
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) }
}

function build(y: number, m: number, d: number): string {
  return `${y}-${pad(m + 1)}-${pad(d)}`
}

function label(value: string): string {
  const p = parse(value)
  if (!p) return ''
  return `${p.d} ${MONTHS_GEN[p.m]} ${p.y}`
}

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

function todayStr(): string {
  const n = new Date()
  return build(n.getFullYear(), n.getMonth(), n.getDate())
}

export function DateField({
  value,
  onChange,
  invalid,
  placeholder = 'Выберите дату',
  title = 'Дата',
}: {
  value: string
  onChange: (value: string) => void
  invalid?: boolean
  placeholder?: string
  title?: string
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const [view, setView] = useState(() => {
    const p = parse(value) ?? parse(todayStr())!
    return { y: p.y, m: p.m }
  })

  const sel = useMemo(() => parse(draft), [draft])
  const today = useMemo(() => {
    const n = new Date()
    return { y: n.getFullYear(), m: n.getMonth(), d: n.getDate() }
  }, [open])

  function start() {
    const base = value || todayStr()
    setDraft(base)
    const p = parse(base)!
    setView({ y: p.y, m: p.m })
    setOpen(true)
  }

  function pickDay(d: number) {
    setDraft(build(view.y, view.m, d))
  }

  function shiftMonth(delta: number) {
    const next = new Date(view.y, view.m + delta, 1)
    setView({ y: next.getFullYear(), m: next.getMonth() })
  }

  function confirm() {
    onChange(draft)
    setOpen(false)
  }

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

            <div className="dtf-actions">
              <button type="button" className="btn ghost" onClick={() => setDraft(todayStr())}>
                Сегодня
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
