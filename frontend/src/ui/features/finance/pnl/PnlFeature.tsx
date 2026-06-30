import { useEffect, useMemo, useRef, useState } from 'react'
import { getPnl } from '../../../../api/pnlApi'
import type { Pnl } from '../../../../api/pnlApi'
import { ListPage } from '../../../layouts/ListPage'
import { Icon } from '../../../primitives/Icon'
import type { IconName } from '../../../primitives/Icon'
import { EmptyState } from '../../../primitives/EmptyState'
import { useApi } from '../../../../hooks/useApi'
import { useCurrentUser } from '../../../../hooks/useCurrentUser'
import { useFilterParam } from '../../../../hooks/useFilterParams'
import { moscowTodayYmd } from '../../../../utils/format'
import { AnalyticsTabs } from '../AnalyticsTabs'

const PRESETS = [
  { d: 1, l: 'День' },
  { d: 7, l: 'Неделя' },
  { d: 14, l: '2 недели' },
  { d: 30, l: 'Месяц' },
] as const
const DEFAULT_PERIOD = 14

// Цвета источников дохода — закреплены по смыслу (упаковка зелёная, логистика синяя,
// палеты янтарные). Семантических переменных темы под стопку графика не хватает,
// поэтому категориальные тона задаём напрямую (как catColor в аналитике расходов).
const INCOME_COLOR: Record<string, string> = {
  packing_good: 'oklch(0.70 0.13 150)',
  packing_defect: 'oklch(0.60 0.10 160)',
  logistics: 'oklch(0.66 0.13 250)',
  pallets: 'oklch(0.74 0.13 80)',
}
function catColor(i: number): string {
  const hue = ((i * 360) / 20 + 18) % 360
  const L = 0.66 + (i % 2 === 0 ? 0.03 : -0.03)
  return `oklch(${L.toFixed(3)} 0.125 ${hue.toFixed(1)})`
}

function shiftYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}
function ddmm(ymd: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}` : ymd
}
function fmtRub(kopecks: number): string {
  return Math.round(kopecks / 100).toLocaleString('ru-RU')
}
function fmtSignedRub(kopecks: number): string {
  const s = kopecks > 0 ? '+' : kopecks < 0 ? '−' : ''
  return s + Math.abs(Math.round(kopecks / 100)).toLocaleString('ru-RU')
}
function fmtShort(kopecks: number): string {
  const v = Math.abs(kopecks) / 100
  const sign = kopecks < 0 ? '−' : ''
  if (v >= 1_000_000) return sign + (v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1).replace('.', ',') + ' млн'
  if (v >= 1000) return sign + Math.round(v / 1000) + ' тыс'
  return sign + String(Math.round(v))
}
function niceMax(v: number): number {
  if (v <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / p
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return m * p
}

export function PnlFeature() {
  const { user } = useCurrentUser()
  const isFinance = user?.role === 'admin' || user?.role === 'manager'

  const [periodRaw, setPeriodRaw] = useFilterParam('days', String(DEFAULT_PERIOD))
  const period = PRESETS.some((p) => p.d === Number(periodRaw)) ? Number(periodRaw) : DEFAULT_PERIOD

  const today = moscowTodayYmd()
  const effTo = today
  const effFrom = shiftYmd(today, -(period - 1))

  const { data, loading, error } = useApi(
    (s) => getPnl({ date_from: effFrom, date_to: effTo }, s),
    [effFrom, effTo],
  )

  if (!isFinance) {
    return (
      <ListPage title="Доходы и расходы">
        <AnalyticsTabs active="pnl" />
        <EmptyState title="Недостаточно прав" sub="Финансовая аналитика доступна администратору и менеджеру." />
      </ListPage>
    )
  }

  const actions = (
    <div className="preset">
      {PRESETS.map((p) => (
        <button key={p.d} className={period === p.d ? 'on' : ''} onClick={() => setPeriodRaw(String(p.d))}>{p.l}</button>
      ))}
    </div>
  )

  return (
    <ListPage
      title="Доходы и расходы"
      subtitle={`Период: ${ddmm(effFrom)} — ${ddmm(effTo)} · заработали ли мы за период`}
      actions={actions}
    >
      <AnalyticsTabs active="pnl" />
      {loading && !data ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>Загрузка…</div>
      ) : error ? (
        <EmptyState title="Не удалось загрузить" sub={error.message} />
      ) : !data ? null : (
        <PnlBody data={data} />
      )}
    </ListPage>
  )
}

function PnlBody({ data }: { data: Pnl }) {
  const [hoverDay, setHoverDay] = useState<number | null>(null)
  const lineRef = useRef<HTMLDivElement>(null)
  const [lineW, setLineW] = useState(640)

  useEffect(() => {
    const el = lineRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setLineW(el.clientWidth))
    ro.observe(el)
    setLineW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const n = data.axis.length
  const peakIncome = Math.max(0, ...data.income_series)
  const peakExpense = Math.max(0, ...data.expense_series)
  const axisMax = niceMax(Math.max(peakIncome, peakExpense))
  const labelEvery = Math.max(1, Math.ceil(n / 15))

  const incomeColor = (key: string) => INCOME_COLOR[key] ?? 'var(--c-accent)'
  const expenseColorByName = useMemo(() => {
    const m: Record<string, string> = {}
    data.expense_categories.forEach((c, i) => { m[c.key] = catColor(i) })
    return m
  }, [data.expense_categories])

  const hi = hoverDay
  const hoverIncome = hi == null ? 0 : data.income_series[hi]
  const hoverExpense = hi == null ? 0 : data.expense_series[hi]
  const hoverNetDay = hoverIncome - hoverExpense

  // Нарастающий итог прибыли — линия с нулевой осью; масштаб по диапазону [min,max] вкл. 0.
  const cum = data.net_cumulative
  const cumMin = Math.min(0, ...cum)
  const cumMax = Math.max(0, ...cum)
  const cumSpan = cumMax - cumMin || 1
  const H = 120
  const padT = 8
  const padB = 8
  const yOf = (v: number) => padT + (cumMax - v) / cumSpan * (H - padT - padB)
  const xOf = (i: number) => n <= 1 ? lineW / 2 : (i / (n - 1)) * lineW
  const zeroY = yOf(0)
  const linePts = cum.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ')
  const lastNet = cum.length ? cum[cum.length - 1] : 0

  const netTone = data.net_total >= 0 ? 'var(--c-success)' : 'var(--c-danger)'

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <KpiCard icon="coins" label="Доход за период" value={fmtRub(data.income_total)} unit="₽" sub="упаковка · логистика · палеты" />
        <KpiCard icon="wallet" label="Расход за период" value={fmtRub(data.expense_total)} unit="₽" sub="все категории расходов" />
        <KpiCard icon="chart" label="Чистая прибыль" value={fmtSignedRub(data.net_total)} unit="₽" sub={data.net_total >= 0 ? 'мы в плюсе' : 'мы в минусе'} tone={netTone} />
        <KpiCard icon="layers" label="Маржа" value={`${String(data.margin_pct).replace('.', ',')}`} unit="%" sub="прибыль / доход" tone={data.margin_pct < 0 ? 'var(--c-danger)' : undefined} />
      </div>

      <div className="an-card" style={{ marginBottom: 16 }}>
        <div className="an-card-head">
          <div className="an-card-ico"><Icon name="chart" size={14} /></div>
          <span className="an-card-title">Доход и расход по дням</span>
          <span className="an-card-hint" style={{ marginLeft: 'auto' }}>
            {hi == null ? 'доход вверх · расход вниз' : `${ddmm(data.axis[hi])}: доход ${fmtShort(hoverIncome)} · расход ${fmtShort(hoverExpense)} · итог ${fmtShort(hoverNetDay)}`}
          </span>
        </div>
        <div style={{ padding: '16px 18px 12px' }}>
          {data.income_total === 0 && data.expense_total === 0 ? (
            <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>За период данных нет</div>
          ) : (
            <>
              <div className="pnl-plot">
                {[1, 0.5].map((f) => (
                  <div key={`u${f}`} className="pnl-gl" style={{ top: `${(1 - f) * 25}%` }}>
                    <span className="yl">{fmtShort(axisMax * f)}</span>
                  </div>
                ))}
                <div className="pnl-zero"><span className="yl" style={{ position: 'absolute', left: -64, width: 58, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-faint)', transform: 'translateY(-50%)' }}>0</span></div>
                {[0.5, 1].map((f) => (
                  <div key={`d${f}`} className="pnl-gl" style={{ top: `${50 + f * 25}%` }}>
                    <span className="yl">{fmtShort(axisMax * f)}</span>
                  </div>
                ))}

                <div className="pnl-bars">
                  {data.axis.map((day, di) => (
                    <div key={day} className={`pnl-col${hoverDay === di ? ' sel' : ''}`} onMouseEnter={() => setHoverDay(di)} onMouseLeave={() => setHoverDay(null)}>
                      <div className="pnl-half up">
                        {data.income_sources.map((s) => {
                          const v = s.series[di] ?? 0
                          if (v <= 0) return null
                          return <div key={s.key} className="pnl-seg" style={{ height: `${(v / axisMax) * 100}%`, background: incomeColor(s.key) }} />
                        })}
                      </div>
                      <div className="pnl-half dn">
                        {data.expense_categories.map((c) => {
                          const v = c.series[di] ?? 0
                          if (v <= 0) return null
                          return <div key={c.key} className="pnl-seg" style={{ height: `${(v / axisMax) * 100}%`, background: expenseColorByName[c.key] }} />
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="pnl-xaxis">
                {data.axis.map((day, di) => (
                  <div key={day} className="pnl-xtick">{di % labelEvery === 0 || di === n - 1 ? ddmm(day) : ''}</div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="an-card" style={{ marginBottom: 16 }}>
        <div className="an-card-head">
          <div className="an-card-ico"><Icon name="chart" size={14} /></div>
          <span className="an-card-title">Накопительный итог прибыли</span>
          <span className="an-card-hint" style={{ marginLeft: 'auto', color: lastNet >= 0 ? 'var(--c-success)' : 'var(--c-danger)' }}>
            на конец периода: {fmtSignedRub(lastNet)} ₽
          </span>
        </div>
        <div ref={lineRef} style={{ padding: '12px 18px' }}>
          <svg width={lineW} height={H} style={{ display: 'block', overflow: 'visible' }}>
            <line x1={0} y1={zeroY} x2={lineW} y2={zeroY} stroke="var(--c-border-strong)" strokeWidth={1} strokeDasharray="3 3" />
            {n > 1 && (
              <>
                <polygon points={`0,${zeroY} ${linePts} ${lineW},${zeroY}`} fill={lastNet >= 0 ? 'var(--c-success)' : 'var(--c-danger)'} opacity={0.10} />
                <polyline points={linePts} fill="none" stroke={lastNet >= 0 ? 'var(--c-success)' : 'var(--c-danger)'} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              </>
            )}
            {cum.map((v, i) => (
              <circle key={i} cx={xOf(i)} cy={yOf(v)} r={n > 30 ? 0 : 2.5} fill={v >= 0 ? 'var(--c-success)' : 'var(--c-danger)'} />
            ))}
          </svg>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
        <BreakdownCard icon="coins" title="Доход по источникам" rows={data.income_sources.map((s) => ({ name: s.label, amount: s.amount, color: incomeColor(s.key) }))} total={data.income_total} />
        <BreakdownCard icon="wallet" title="Расход по категориям" rows={data.expense_categories.map((c) => ({ name: c.label, amount: c.amount, color: expenseColorByName[c.key] }))} total={data.expense_total} />
      </div>
    </>
  )
}

function BreakdownCard({ icon, title, rows, total }: {
  icon: IconName
  title: string
  rows: { name: string; amount: number; color: string }[]
  total: number
}) {
  const sorted = [...rows].sort((a, b) => b.amount - a.amount)
  const max = Math.max(1, ...sorted.map((r) => r.amount))
  return (
    <div className="an-card">
      <div className="an-card-head">
        <div className="an-card-ico"><Icon name={icon} size={14} /></div>
        <span className="an-card-title">{title}</span>
        <span className="an-card-hint">{fmtRub(total)} ₽</span>
      </div>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {sorted.length === 0 ? (
          <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>Нет данных за период</div>
        ) : sorted.map((r) => {
          const pct = Math.round((r.amount / max) * 100)
          const share = total > 0 ? Math.round((r.amount / total) * 100) : 0
          return (
            <div key={r.name}>
              <div className="bd-top">
                <span className="bd-name">
                  <span className="lrow-sw" style={{ background: r.color }} />
                  <span className="nm">{r.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--c-text-faint)', flexShrink: 0 }}>· {share}%</span>
                </span>
                <span className="mono" style={{ fontSize: 12.5, color: 'var(--c-text-muted)', fontWeight: 600, flexShrink: 0 }}>{fmtRub(r.amount)}</span>
              </div>
              <div className="prog" style={{ height: 7 }}>
                <div className="prog-fill" style={{ width: `${pct}%`, background: r.color }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function KpiCard({ icon, label, value, unit, sub, tone }: {
  icon: IconName
  label: string
  value: string
  unit?: string
  sub?: string
  tone?: string
}) {
  return (
    <div className="an-card" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 500, color: 'var(--c-text-subtle)', letterSpacing: '0.02em', textTransform: 'uppercase' }}>
        <Icon name={icon} size={13} />{label}
      </span>
      <span style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-0.01em', color: tone || 'var(--c-text)', fontVariantNumeric: 'tabular-nums' }}>
        {value}{unit && <span style={{ fontSize: 12, color: 'var(--c-text-subtle)', fontWeight: 500, marginLeft: 3 }}>{unit}</span>}
      </span>
      {sub && <span style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>{sub}</span>}
    </div>
  )
}
