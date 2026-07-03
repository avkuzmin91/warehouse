import { useEffect, useMemo, useRef, useState } from 'react'
import { getPnl } from '../../../../api/pnlApi'
import type { Pnl, PnlSeries } from '../../../../api/pnlApi'
import { ListPage } from '../../../layouts/ListPage'
import { Icon } from '../../../primitives/Icon'
import type { IconName } from '../../../primitives/Icon'
import { EmptyState } from '../../../primitives/EmptyState'
import { useApi } from '../../../../hooks/useApi'
import { useCurrentUser } from '../../../../hooks/useCurrentUser'
import { useFilterParam } from '../../../../hooks/useFilterParams'
import { moscowTodayYmd } from '../../../../utils/format'
import { AnalyticsTabs } from '../AnalyticsTabs'
import { PnlDayDrawer } from './PnlDayDrawer'

const PRESETS = [
  { d: 7, l: 'Неделя' },
  { d: 30, l: 'Месяц' },
  { d: 90, l: 'Квартал' },
] as const
const DEFAULT_PERIOD = 30

// До 22.06.2026 финансовые данные вносились нерегулярно, поэтому совмещённый P&L
// («доход vs расход») считаем только с этой даты. Отдельные вкладки «Доходы» и
// «Расходы» её не применяют — там показываем всё как есть.
const DATA_START = '2026-06-22'

// Цвета источников дохода закреплены по смыслу (упаковка зелёная, логистика синяя,
// палеты янтарные). Категориальных переменных темы под стопку графика не хватает —
// задаём тона напрямую (как catColor в аналитике расходов).
const INCOME_COLOR: Record<string, string> = {
  packing_good: 'oklch(0.70 0.13 150)',
  packing_defect: 'oklch(0.60 0.10 160)',
  logistics: 'oklch(0.66 0.13 250)',
  pallets: 'oklch(0.74 0.13 80)',
  boxes: 'oklch(0.70 0.14 40)',
  extra: 'oklch(0.66 0.14 310)',
}
export function incomeColor(key: string): string {
  return INCOME_COLOR[key] ?? 'var(--c-accent)'
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
function daysInclusive(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  return Math.floor((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000) + 1
}
const MONTHS_GEN = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const DOW_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
export function dayFull(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return `${d} ${MONTHS_GEN[m - 1]}, ${DOW_SHORT[dt.getUTCDay()]}`
}
export function fmtRub(kopecks: number): string {
  return Math.round(kopecks / 100).toLocaleString('ru-RU')
}
export function fmtSignedRub(kopecks: number): string {
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
// % изменения относительно прошлого периода; null — «нет базы» (прошлый = 0).
function pctDelta(cur: number, prev: number): number | null {
  if (prev === 0) return cur === 0 ? 0 : null
  return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10
}

type ChartMode = 'net' | 'split'

export function PnlFeature() {
  const { user } = useCurrentUser()
  const isFinance = user?.role === 'admin' || user?.role === 'manager'

  const [periodRaw, setPeriodRaw] = useFilterParam('days', String(DEFAULT_PERIOD))
  const period = PRESETS.some((p) => p.d === Number(periodRaw)) ? Number(periodRaw) : DEFAULT_PERIOD
  const [compare, setCompare] = useState(false)
  const [chartMode, setChartMode] = useState<ChartMode>('net')

  const today = moscowTodayYmd()
  const effTo = today
  const rawFrom = shiftYmd(today, -(period - 1))
  const effFrom = rawFrom < DATA_START ? DATA_START : rawFrom
  const shownDays = daysInclusive(effFrom, effTo)
  const prevTo = shiftYmd(effFrom, -1)
  const prevFrom = shiftYmd(prevTo, -(period - 1))
  // Прошлый период сравниваем, только если он целиком после начала корректных данных.
  const canCompare = prevFrom >= DATA_START

  const { data, loading, error } = useApi(
    (s) => getPnl({ date_from: effFrom, date_to: effTo }, s),
    [effFrom, effTo],
  )
  const { data: prevData } = useApi(
    (s) => (compare && canCompare ? getPnl({ date_from: prevFrom, date_to: prevTo }, s) : Promise.resolve(null)),
    [prevFrom, prevTo, compare, canCompare],
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
    <div className="row gap-8" style={{ flexWrap: 'wrap', gap: 8 }}>
      <div className="preset">
        {PRESETS.map((p) => (
          <button key={p.d} className={period === p.d ? 'on' : ''} onClick={() => setPeriodRaw(String(p.d))}>{p.l}</button>
        ))}
      </div>
      <button
        className={`pnl-cmp${compare && canCompare ? ' on' : ''}`}
        disabled={!canCompare}
        title={canCompare ? undefined : `Сравнение доступно, когда прошлый период целиком после ${ddmm(DATA_START)} — до этой даты данные неполные`}
        onClick={() => setCompare((v) => !v)}
      >
        <span className="pnl-cmp-sw" />Сравнить с прошлым
      </button>
      <button className="btn" disabled={!data} onClick={() => data && exportCsv(data)}>
        <Icon name="download" size={14} />Выгрузить
      </button>
    </div>
  )

  return (
    <ListPage
      title="Доходы и расходы"
      subtitle={`${ddmm(effFrom)} — ${ddmm(effTo)} · ${shownDays} дн. · заработали ли мы за период`}
      actions={actions}
    >
      <AnalyticsTabs active="pnl" />
      {loading && !data ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>Загрузка…</div>
      ) : error ? (
        <EmptyState title="Не удалось загрузить" sub={error.message} />
      ) : !data ? null : (
        <PnlBody
          data={data}
          prev={compare ? prevData : null}
          chartMode={chartMode}
          onChartMode={setChartMode}
        />
      )}
    </ListPage>
  )
}

function exportCsv(d: Pnl) {
  const rows: string[][] = [['Дата', 'Доход, ₽', 'Расход, ₽', 'Итог, ₽']]
  d.axis.forEach((day, i) => {
    const inc = d.income_series[i] ?? 0
    const exp = d.expense_series[i] ?? 0
    rows.push([day, String(Math.round(inc / 100)), String(Math.round(exp / 100)), String(Math.round((inc - exp) / 100))])
  })
  const csv = '﻿' + rows.map((r) => r.join(';')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `pnl_${d.date_from}_${d.date_to}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function PnlBody({ data, prev, chartMode, onChartMode }: {
  data: Pnl
  prev: Pnl | null
  chartMode: ChartMode
  onChartMode: (m: ChartMode) => void
}) {
  const cmp = !!prev
  const [selDay, setSelDay] = useState<number | null>(null)
  const netSeries = useMemo(
    () => data.axis.map((_, i) => (data.income_series[i] ?? 0) - (data.expense_series[i] ?? 0)),
    [data],
  )
  const profitDays = netSeries.filter((v) => v > 0).length
  const lossDays = netSeries.filter((v) => v < 0).length

  const expColor = useMemo(() => {
    const m: Record<string, string> = {}
    data.expense_categories.forEach((c, i) => { m[c.key] = catColor(i) })
    return m
  }, [data.expense_categories])

  const incomeDelta = cmp ? pctDelta(data.income_total, prev.income_total) : null
  const expenseDelta = cmp ? pctDelta(data.expense_total, prev.expense_total) : null
  const netDelta = cmp ? pctDelta(data.net_total, prev.net_total) : null
  const marginDelta = cmp && data.margin_pct != null && prev.margin_pct != null ? pctDelta(data.margin_pct, prev.margin_pct) : null

  return (
    <>
      <ResultHero data={data} prev={prev} netDelta={netDelta} profitDays={profitDays} lossDays={lossDays} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <KpiCard icon="coins" label="Доход" value={fmtRub(data.income_total)} unit="₽" sub="за период" delta={incomeDelta} goodIsUp compare={cmp} />
        <KpiCard icon="wallet" label="Расход" value={fmtRub(data.expense_total)} unit="₽" sub="за период" delta={expenseDelta} goodIsUp={false} compare={cmp} />
        <KpiCard icon="pulse" label="Чистая прибыль" value={fmtSignedRub(data.net_total)} unit="₽" sub={data.net_total >= 0 ? 'в плюсе' : 'в минусе'} tone={data.net_total >= 0 ? 'var(--c-success)' : 'var(--c-danger)'} delta={netDelta} goodIsUp compare={cmp} />
        <KpiCard icon="chart" label="Маржа" value={data.margin_pct == null ? '—' : String(data.margin_pct).replace('.', ',')} unit={data.margin_pct == null ? undefined : '%'} sub="прибыль / доход" tone={data.margin_pct != null && data.margin_pct < 0 ? 'var(--c-danger)' : undefined} delta={marginDelta} goodIsUp compare={cmp} />
      </div>

      <div className="an-card" style={{ marginBottom: 16 }}>
        <div className="an-card-head">
          <div className="an-card-ico"><Icon name="chart" size={14} /></div>
          <span className="an-card-title">{chartMode === 'net' ? 'Итог по дням' : 'Доход и расход по дням'}</span>
          <span className="an-card-hint" style={{ marginLeft: 'auto', marginRight: 10 }}>
            {chartMode === 'net' ? 'выше нуля — заработали · ниже — потеряли' : 'доход вверх · расход вниз'}
          </span>
          <div className="preset">
            <button className={chartMode === 'net' ? 'on' : ''} onClick={() => onChartMode('net')}>Итог</button>
            <button className={chartMode === 'split' ? 'on' : ''} onClick={() => onChartMode('split')}>Доход / расход</button>
          </div>
        </div>
        <div style={{ padding: '18px 18px 14px' }}>
          {data.income_total === 0 && data.expense_total === 0 ? (
            <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>За период данных нет</div>
          ) : (
            <MainChart data={data} netSeries={netSeries} mode={chartMode} expColor={expColor} onSelectDay={setSelDay} />
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
        <BreakdownCard
          icon="coins" title="Доход по источникам" total={data.income_total} compare={cmp} goodIsUp
          rows={data.income_sources.map((s) => ({ key: s.key, label: s.label, amount: s.amount, color: incomeColor(s.key) }))}
          prevRows={prev?.income_sources}
        />
        <BreakdownCard
          icon="wallet" title="Расход по категориям" total={data.expense_total} compare={cmp} goodIsUp={false}
          rows={data.expense_categories.map((c) => ({ key: c.key, label: c.label, amount: c.amount, color: expColor[c.key] }))}
          prevRows={prev?.expense_categories}
        />
      </div>

      <PnlDayDrawer
        day={selDay != null ? data.axis[selDay] : null}
        from={data.date_from}
        to={data.date_to}
        expColor={expColor}
        onClose={() => setSelDay(null)}
      />
    </>
  )
}

function Delta({ delta, goodIsUp = true, label = 'к пред.' }: { delta: number | null; goodIsUp?: boolean; label?: string }) {
  if (delta == null) return <span className="pnl-delta flat">— нет базы</span>
  if (delta === 0) return <span className="pnl-delta flat">0%{label ? ` · ${label}` : ''}</span>
  const up = delta > 0
  const good = up === goodIsUp
  return (
    <span className={`pnl-delta ${good ? 'up' : 'down'}`}>
      <Icon name={up ? 'arrowUp' : 'arrowDown'} size={11} />
      {Math.abs(delta).toLocaleString('ru-RU')}%{label ? ` · ${label}` : ''}
    </span>
  )
}

function ResultHero({ data, prev, netDelta, profitDays, lossDays }: {
  data: Pnl
  prev: Pnl | null
  netDelta: number | null
  profitDays: number
  lossDays: number
}) {
  const cmp = !!prev
  const plus = data.net_total >= 0
  const cum = data.net_cumulative
  const lastNet = cum.length ? cum[cum.length - 1] : 0
  return (
    <div className="an-card pnl-hero" style={{ marginBottom: 16 }}>
      <div className="pnl-hero-main">
        <span className="pnl-hero-label"><Icon name="pulse" size={13} />Чистый результат за период</span>
        <span className="pnl-hero-num" style={{ color: plus ? 'var(--c-success)' : 'var(--c-danger)' }}>
          {fmtSignedRub(data.net_total)}<span className="u">₽</span>
        </span>
        <div className="pnl-hero-meta">
          <span className={`pnl-verdict ${plus ? 'plus' : 'minus'}`}>
            <Icon name={plus ? 'arrowUp' : 'arrowDown'} size={13} />{plus ? 'Мы в плюсе' : 'Мы в минусе'}
          </span>
          <span style={{ fontSize: 12.5, color: 'var(--c-text-muted)' }}>
            маржа <b style={{ color: 'var(--c-text)', fontVariantNumeric: 'tabular-nums' }}>{data.margin_pct == null ? '—' : `${String(data.margin_pct).replace('.', ',')}%`}</b>
          </span>
          {cmp && <Delta delta={netDelta} goodIsUp label="к прошлому периоду" />}
        </div>
        <div style={{ marginTop: 14, fontSize: 12.5, color: 'var(--c-text-muted)', lineHeight: 1.5 }}>
          Прибыльных дней <b style={{ color: 'var(--c-success)' }}>{profitDays}</b> · убыточных <b style={{ color: 'var(--c-danger)' }}>{lossDays}</b> из {data.days}.
          {' '}Доход <span className="mono">{fmtShort(data.income_total)}</span> · расход <span className="mono">{fmtShort(data.expense_total)}</span>.
        </div>
      </div>
      <div className="pnl-hero-side">
        <div className="pnl-hero-side-top">
          <span className="pnl-hero-side-label"><Icon name="chart" size={11} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 5 }} />Накопительный итог</span>
          <span className="mono" style={{ fontSize: 12.5, fontWeight: 700, color: lastNet >= 0 ? 'var(--c-success)' : 'var(--c-danger)' }}>{fmtSignedRub(lastNet)} ₽</span>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', minHeight: 96 }}>
          <Sparkline cur={cum} prev={prev?.net_cumulative ?? null} />
        </div>
        {cmp && (
          <div style={{ display: 'flex', gap: 14, marginTop: 8 }}>
            <span className="pnl-legend-it"><span style={{ width: 16, height: 2, background: 'var(--c-success)', borderRadius: 2 }} />этот период</span>
            <span className="pnl-legend-it"><span style={{ width: 16, height: 0, borderTop: '2px dashed var(--c-text-faint)' }} />прошлый период</span>
          </div>
        )}
      </div>
    </div>
  )
}

function Sparkline({ cur, prev, w = 360, h = 96 }: { cur: number[]; prev: number[] | null; w?: number; h?: number }) {
  const all = prev ? [...cur, ...prev] : cur
  const mn = Math.min(0, ...all)
  const mx = Math.max(0, ...all)
  const span = mx - mn || 1
  const n = cur.length
  const x = (i: number) => (n <= 1 ? w / 2 : (i / (n - 1)) * w)
  const y = (v: number) => 6 + (mx - v) / span * (h - 12)
  const pts = (arr: number[]) => arr.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const last = cur.length ? cur[cur.length - 1] : 0
  const col = last >= 0 ? 'var(--c-success)' : 'var(--c-danger)'
  const zeroY = y(0)
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }}>
      <line x1={0} y1={zeroY} x2={w} y2={zeroY} stroke="var(--c-border-strong)" strokeWidth={1} strokeDasharray="3 3" />
      {prev && prev.length > 1 && <polyline points={pts(prev)} fill="none" stroke="var(--c-text-faint)" strokeWidth={1.5} strokeDasharray="4 3" />}
      {n > 1 && (
        <>
          <polygon points={`0,${zeroY} ${pts(cur)} ${w},${zeroY}`} fill={col} opacity={0.10} />
          <polyline points={pts(cur)} fill="none" stroke={col} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
        </>
      )}
    </svg>
  )
}

type ChartCat = { key: string; label: string; color: string; series: number[]; amount: number }

function MainChart({ data, netSeries, mode, expColor, onSelectDay }: {
  data: Pnl
  netSeries: number[]
  mode: ChartMode
  expColor: Record<string, string>
  onSelectDay: (i: number) => void
}) {
  const [hover, setHover] = useState<number | null>(null)
  const [tipX, setTipX] = useState(0)
  const plotRef = useRef<HTMLDivElement>(null)
  const [plotW, setPlotW] = useState(700)
  const n = data.days
  const labelEvery = Math.max(1, Math.ceil(n / 15))

  useEffect(() => {
    const el = plotRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setPlotW(el.clientWidth))
    ro.observe(el)
    setPlotW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const incSrc: ChartCat[] = data.income_sources.map((s) => ({ key: s.key, label: s.label, color: incomeColor(s.key), series: s.series, amount: s.amount }))

  // Для диверг-вида мелкие категории расхода (<4% итога) сворачиваем в «Прочее».
  const expCats: ChartCat[] = useMemo(() => {
    const cats: ChartCat[] = data.expense_categories.map((c) => ({ key: c.key, label: c.label, color: expColor[c.key], series: c.series, amount: c.amount }))
    if (mode !== 'split') return cats
    const thr = data.expense_total * 0.04
    const big = cats.filter((c) => c.amount >= thr)
    const small = cats.filter((c) => c.amount < thr)
    if (small.length <= 1) return cats
    const restSeries = data.axis.map((_, i) => small.reduce((s, c) => s + (c.series[i] ?? 0), 0))
    return [...big, { key: '__rest', label: `Прочее · ${small.length}`, color: 'var(--c-text-faint)', series: restSeries, amount: small.reduce((s, c) => s + c.amount, 0) }]
  }, [data, mode, expColor])

  const maxNetAbs = Math.max(1, ...netSeries.map(Math.abs))
  const netAxis = niceMax(maxNetAbs)
  const peakI = Math.max(0, ...data.income_series)
  const peakE = Math.max(0, ...data.expense_series)
  const splitAxis = niceMax(Math.max(peakI, peakE))
  const axisMax = mode === 'split' ? splitAxis : netAxis

  const onMove = (e: React.MouseEvent) => {
    const r = plotRef.current?.getBoundingClientRect()
    if (r) setTipX(e.clientX - r.left)
  }

  const tip = hover == null ? null : {
    day: data.axis[hover],
    income: data.income_series[hover] ?? 0,
    expense: data.expense_series[hover] ?? 0,
    net: netSeries[hover] ?? 0,
  }

  return (
    <>
      <div className="pnl-plot" ref={plotRef} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {[1, 0.5].map((f) => (
          <div key={`u${f}`} className="pnl-gl" style={{ top: `${(1 - f) * 25}%` }}><span className="yl">{fmtShort(axisMax * f)}</span></div>
        ))}
        <div className="pnl-zero"><span className="yl">0</span></div>
        {[0.5, 1].map((f) => (
          <div key={`d${f}`} className="pnl-gl" style={{ top: `${50 + f * 25}%` }}>
            <span className="yl">{mode === 'split' ? fmtShort(axisMax * f) : '−' + fmtShort(axisMax * f)}</span>
          </div>
        ))}

        <div className="pnl-bars">
          {data.axis.map((day, i) => {
            const net = netSeries[i]
            const dim = hover != null && hover !== i ? 0.45 : 1
            return (
              <div key={day} className={`pnl-col${hover === i ? ' sel' : ''}`} onMouseEnter={() => setHover(i)} onClick={() => onSelectDay(i)}>
                {mode === 'net' ? (
                  <>
                    <div className="pnl-half up">
                      {net > 0 && <div className="pnl-bar up" style={{ height: `${(net / axisMax) * 100}%`, background: 'var(--c-success)', opacity: dim }} />}
                    </div>
                    <div className="pnl-half dn">
                      {net < 0 && <div className="pnl-bar dn" style={{ height: `${(-net / axisMax) * 100}%`, background: 'var(--c-danger)', opacity: dim }} />}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="pnl-half up">
                      {incSrc.map((s) => {
                        const v = s.series[i] ?? 0
                        if (v <= 0) return null
                        return <div key={s.key} className="pnl-seg" style={{ height: `${(v / axisMax) * 100}%`, background: s.color, opacity: dim }} />
                      })}
                    </div>
                    <div className="pnl-half dn">
                      {expCats.map((c) => {
                        const v = c.series[i] ?? 0
                        if (v <= 0) return null
                        return <div key={c.key} className="pnl-seg" style={{ height: `${(v / axisMax) * 100}%`, background: c.color, opacity: dim }} />
                      })}
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>

        {tip && (
          <div className="pnl-tip" style={{ left: Math.max(104, Math.min(tipX, plotW - 8)), top: 4, transform: tipX > plotW - 140 ? 'translateX(-100%)' : 'translateX(-50%)' }}>
            <div className="pnl-tip-date">{dayFull(tip.day)}</div>
            <div className="pnl-tip-line"><span className="k"><span className="pnl-tip-sw" style={{ background: 'var(--c-success)' }} />Доход</span><span className="v">{fmtRub(tip.income)}</span></div>
            <div className="pnl-tip-line"><span className="k"><span className="pnl-tip-sw" style={{ background: 'var(--c-danger)' }} />Расход</span><span className="v">{fmtRub(tip.expense)}</span></div>
            <div className="pnl-tip-net"><span>Итог за день</span><span className="mono" style={{ color: tip.net >= 0 ? 'var(--c-success)' : 'var(--c-danger)' }}>{fmtSignedRub(tip.net)} ₽</span></div>
            <div style={{ marginTop: 5, fontSize: 10.5, color: 'var(--c-text-faint)' }}>Нажмите — детализация дня</div>
          </div>
        )}
      </div>
      <div className="pnl-xaxis">
        {data.axis.map((day, i) => <div key={day} className="pnl-xtick">{i % labelEvery === 0 || i === n - 1 ? ddmm(day) : ''}</div>)}
      </div>
      {mode === 'split' && (
        <div className="pnl-legend" style={{ marginTop: 12 }}>
          {incSrc.map((s) => <span key={s.key} className="pnl-legend-it"><span className="pnl-bd-sw" style={{ background: s.color }} />{s.label}</span>)}
          <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--c-border)' }} />
          {expCats.map((c) => <span key={c.key} className="pnl-legend-it"><span className="pnl-bd-sw" style={{ background: c.color }} />{c.label}</span>)}
        </div>
      )}
    </>
  )
}

function BreakdownCard({ icon, title, rows, prevRows, total, compare, goodIsUp }: {
  icon: IconName
  title: string
  rows: { key: string; label: string; amount: number; color: string }[]
  prevRows?: PnlSeries[]
  total: number
  compare: boolean
  goodIsUp: boolean
}) {
  const prevMap = useMemo(() => {
    const m: Record<string, number> = {}
    ;(prevRows ?? []).forEach((r) => { m[r.key] = r.amount })
    return m
  }, [prevRows])
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
          const delta = compare ? pctDelta(r.amount, prevMap[r.key] ?? 0) : null
          return (
            <div key={r.key}>
              <div className="bd-top">
                <span className="bd-name">
                  <span className="pnl-bd-sw" style={{ background: r.color }} />
                  <span className="nm">{r.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--c-text-faint)', flexShrink: 0 }}>· {share}%</span>
                </span>
                <span className="pnl-bd-right">
                  {compare && <Delta delta={delta} goodIsUp={goodIsUp} label="" />}
                  <span className="mono" style={{ fontSize: 12.5, color: 'var(--c-text-muted)', fontWeight: 600 }}>{fmtRub(r.amount)}</span>
                </span>
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

function KpiCard({ icon, label, value, unit, sub, tone, delta, goodIsUp, compare }: {
  icon: IconName
  label: string
  value: string
  unit?: string
  sub?: string
  tone?: string
  delta: number | null
  goodIsUp: boolean
  compare: boolean
}) {
  return (
    <div className="pnl-kpi">
      <span className="pnl-kpi-label"><Icon name={icon} size={13} />{label}</span>
      <span className="pnl-kpi-val" style={{ color: tone }}>{value}{unit && <span className="u">{unit}</span>}</span>
      <div className="pnl-kpi-foot">
        {compare ? <Delta delta={delta} goodIsUp={goodIsUp} /> : (sub && <span>{sub}</span>)}
      </div>
    </div>
  )
}
