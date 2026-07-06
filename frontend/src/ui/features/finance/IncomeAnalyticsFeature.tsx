import { useMemo, useRef, useState } from 'react'
import { getIncomeAnalytics } from '../../../api/pnlApi'
import type { IncomeAnalytics } from '../../../api/pnlApi'
import { ListPage } from '../../layouts/ListPage'
import { FiltersBar, FilterCombobox } from '../../data/FiltersBar'
import { DateRange } from '../../data/DateRange'
import { Icon } from '../../primitives/Icon'
import type { IconName } from '../../primitives/Icon'
import { EmptyState } from '../../primitives/EmptyState'
import { useApi } from '../../../hooks/useApi'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { useLookups } from '../../../hooks/useLookups'
import { useFilterParam, useFilterParamsActions } from '../../../hooks/useFilterParams'
import { moscowTodayYmd } from '../../../utils/format'
import { AnalyticsTabs } from './AnalyticsTabs'
import { PnlDayDrawer } from './pnl/PnlDayDrawer'

const PRESETS = [7, 14, 30] as const
const DEFAULT_PERIOD = 30

// Цвета источников дохода закреплены по смыслу (те же, что в отчёте «Доходы и расходы»):
// упаковка зелёная, логистика синяя, палеты янтарные.
const SOURCE_COLOR: Record<string, string> = {
  packing_good: 'oklch(0.70 0.13 150)',
  packing_defect: 'oklch(0.60 0.10 160)',
  logistics: 'oklch(0.66 0.13 250)',
  pallets: 'oklch(0.74 0.13 80)',
  boxes: 'oklch(0.70 0.14 40)',
  extra: 'oklch(0.66 0.14 310)',
  storage: 'oklch(0.68 0.12 200)',
}
function sourceColor(key: string): string {
  return SOURCE_COLOR[key] ?? 'var(--c-accent)'
}
// Палитра клиентов: различимые тона oklch по индексу (как catColor в аналитике расходов).
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

function ymdToUtc(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)

const MONTHS_GEN = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const DOW_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

function ddmm(ymd: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}` : ymd
}
function fmtDayFull(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return `${d} ${MONTHS_GEN[m - 1]}, ${DOW_SHORT[dow]}`
}

// Деньги: суммы хранятся в копейках.
function fmtRub(kopecks: number): string {
  return Math.round(kopecks / 100).toLocaleString('ru-RU')
}
function fmtShort(kopecks: number): string {
  const v = kopecks / 100
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1).replace('.', ',') + ' млн'
  if (v >= 1000) return Math.round(v / 1000) + ' тыс'
  return String(Math.round(v))
}
function niceMax(v: number): number {
  if (v <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / p
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return m * p
}

export function IncomeAnalyticsFeature() {
  const { user } = useCurrentUser()
  const isFinance = user?.role === 'admin' || user?.role === 'manager'
  const isAdmin = user?.role === 'admin'
  const { clients } = useLookups()

  const [periodRaw] = useFilterParam('days', String(DEFAULT_PERIOD))
  const period = PRESETS.includes(Number(periodRaw) as 7 | 14 | 30) ? Number(periodRaw) : DEFAULT_PERIOD
  const [clientId, setClientId] = useFilterParam('client', '')
  const [fromRaw, setFromRaw] = useFilterParam('from', '')
  const [toRaw, setToRaw] = useFilterParam('to', '')
  const { setMany } = useFilterParamsActions()

  const customFrom = isYmd(fromRaw) ? fromRaw : ''
  const customTo = isYmd(toRaw) ? toRaw : ''
  const hasCustom = Boolean(customFrom || customTo)

  const today = moscowTodayYmd()
  let effFrom = hasCustom ? (customFrom || customTo) : shiftYmd(today, -(period - 1))
  let effTo = hasCustom ? (customTo || customFrom) : today
  if (effFrom > effTo) [effFrom, effTo] = [effTo, effFrom]
  const periodDays = Math.round((ymdToUtc(effTo) - ymdToUtc(effFrom)) / 86_400_000) + 1

  const { data, loading, error } = useApi(
    (s) => getIncomeAnalytics({ date_from: effFrom, date_to: effTo, client_id: clientId || undefined }, s),
    [effFrom, effTo, clientId],
  )

  // Состояние графика — отключённые источники (по key). Храним «выключенные», чтобы новые
  // источники при смене периода появлялись включёнными.
  const [disabled, setDisabled] = useState<Set<string>>(() => new Set())
  const [hoverSrc, setHoverSrc] = useState<string | null>(null)
  const [hoverDay, setHoverDay] = useState<number | null>(null)
  const [selDay, setSelDay] = useState<string | null>(null)
  const [tipX, setTipX] = useState(0)
  const plotRef = useRef<HTMLDivElement>(null)

  if (!isFinance) {
    return (
      <ListPage title="Аналитика доходов">
        <AnalyticsTabs active="income" />
        <EmptyState title="Недостаточно прав" sub="Аналитика доходов доступна администратору и менеджеру." />
      </ListPage>
    )
  }

  function exportCsv() {
    if (!data) return
    const days = data.series.map((p) => p.date)
    const header = ['Дата', ...data.sources.map((s) => s.name)]
    const lines = [header.join(';')]
    days.forEach((d, i) => {
      lines.push([d, ...data.sources.map((s) => String(Math.round((s.series[i] ?? 0) / 100)))].join(';'))
    })
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `income-analytics-${effFrom}_${effTo}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const actions = (
    <>
      <div className="preset">
        {PRESETS.map((p) => (
          <button key={p} className={!hasCustom && period === p ? 'on' : ''}
            onClick={() => { setMany({ days: p === DEFAULT_PERIOD ? null : String(p), from: null, to: null }); setHoverDay(null); setSelDay(null) }}>{p} дн.</button>
        ))}
      </div>
      <DateRange
        from={customFrom}
        to={customTo}
        onFromChange={(v) => { setFromRaw(v); setHoverDay(null); setSelDay(null) }}
        onToChange={(v) => { setToRaw(v); setHoverDay(null); setSelDay(null) }}
        onClear={() => { setMany({ from: null, to: null }); setHoverDay(null); setSelDay(null) }}
      />
      {isAdmin && (
        <button className="btn" onClick={exportCsv} disabled={!data || data.sources.length === 0}>
          <Icon name="download" size={14} />Выгрузить
        </button>
      )}
    </>
  )

  return (
    <ListPage
      title="Аналитика доходов"
      subtitle={`Период: ${ddmm(effFrom)} — ${ddmm(effTo)} · ${periodDays} дн.`}
      actions={actions}
    >
      <AnalyticsTabs active="income" />
      <FiltersBar>
        <FilterCombobox
          label="Клиент"
          value={clientId}
          options={[{ value: '', label: 'Все клиенты' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
          onChange={(v) => setClientId(v)}
          placeholder="Поиск клиента…"
        />
      </FiltersBar>
      {loading && !data ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>Загрузка аналитики…</div>
      ) : error ? (
        <EmptyState title="Не удалось загрузить аналитику" sub={error.message} />
      ) : !data ? null : (
        <>
          <AnalyticsBody
            data={data}
            period={periodDays}
            disabled={disabled} setDisabled={setDisabled}
            hoverSrc={hoverSrc} setHoverSrc={setHoverSrc}
            hoverDay={hoverDay} setHoverDay={setHoverDay}
            tipX={tipX} setTipX={setTipX}
            plotRef={plotRef}
            onSelectDay={setSelDay}
          />
          <PnlDayDrawer
            day={selDay}
            from={effFrom}
            to={effTo}
            mode="income"
            clientId={clientId || undefined}
            onClose={() => setSelDay(null)}
          />
        </>
      )}
    </ListPage>
  )
}

function AnalyticsBody({
  data, period,
  disabled, setDisabled, hoverSrc, setHoverSrc, hoverDay, setHoverDay, tipX, setTipX, plotRef, onSelectDay,
}: {
  data: IncomeAnalytics
  period: number
  disabled: Set<string>
  setDisabled: (s: Set<string>) => void
  hoverSrc: string | null
  setHoverSrc: (s: string | null) => void
  hoverDay: number | null
  setHoverDay: (n: number | null) => void
  tipX: number
  setTipX: (n: number) => void
  plotRef: React.RefObject<HTMLDivElement | null>
  onSelectDay: (day: string) => void
}) {
  const sources = data.sources
  const days = data.series.map((p) => p.date)

  const totalByKey = useMemo(() => {
    const m: Record<string, number> = {}
    sources.forEach((s) => { m[s.key] = s.series.reduce((a, v) => a + v, 0) })
    return m
  }, [sources])

  const enabled = sources.filter((s) => !disabled.has(s.key))
  const activeCount = enabled.length
  const grandTotal = enabled.reduce((a, s) => a + totalByKey[s.key], 0)

  const toggle = (key: string) => {
    const n = new Set(disabled)
    n.has(key) ? n.delete(key) : n.add(key)
    setDisabled(n)
  }
  const solo = (key: string) => setDisabled(new Set(sources.filter((s) => s.key !== key).map((s) => s.key)))
  const enableAll = () => setDisabled(new Set())
  const clearAll = () => setDisabled(new Set(sources.map((s) => s.key)))

  const renderSrc = [...enabled].sort((a, b) => totalByKey[b.key] - totalByKey[a.key])
  const dayTotals = days.map((_, i) => renderSrc.reduce((s, src) => s + (src.series[i] ?? 0), 0))
  const peak = Math.max(0, ...dayTotals)
  const axisMax = niceMax(peak)
  const avg = period > 0 ? grandTotal / period : 0
  const gridVals = [1, 0.75, 0.5, 0.25].map((f) => axisMax * f)
  const labelEvery = Math.max(1, Math.ceil(period / 15))

  const legend = [...sources].sort((a, b) => totalByKey[b.key] - totalByKey[a.key])
  const breakdown = [...enabled].sort((a, b) => totalByKey[b.key] - totalByKey[a.key])
  const bdMax = Math.max(1, ...breakdown.map((s) => totalByKey[s.key]))

  const byClient = data.by_client
  const clientMax = Math.max(1, ...byClient.map((c) => c.amount))

  const tip = hoverDay == null ? null : (() => {
    const segs = renderSrc.map((s) => ({ name: s.name, color: sourceColor(s.key), v: s.series[hoverDay] ?? 0 }))
      .filter((s) => s.v > 0).sort((a, b) => b.v - a.v)
    return { day: days[hoverDay], total: dayTotals[hoverDay], segs }
  })()

  const onPlotMove = (e: React.MouseEvent) => {
    const r = plotRef.current?.getBoundingClientRect()
    if (r) setTipX(e.clientX - r.left)
  }
  const plotWidth = () => plotRef.current?.clientWidth || 600

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <KpiCard icon="coins" label="Получено за период" value={fmtRub(grandTotal)} unit="₽" sub="по выбранным источникам" />
        <KpiCard icon="calendar" label="В среднем за день" value={fmtRub(avg)} unit="₽" sub={`${period} дн. в периоде`} />
        <KpiCard icon="chart" label="Пик за день" value={fmtRub(peak)} unit="₽" sub="максимум в одном дне" />
        <KpiCard icon="layers" label="Источников активно" value={`${activeCount}`} unit={`/ ${sources.length}`}
          sub="включено в график" tone={activeCount === 0 ? 'var(--c-warning)' : undefined} />
      </div>

      <div className="an-card" style={{ marginBottom: 16 }}>
        <div className="an-card-head">
          <div className="an-card-ico"><Icon name="chart" size={14} /></div>
          <span className="an-card-title">Динамика по дням</span>
          <span className="an-card-hint" style={{ marginLeft: 8, marginRight: 'auto' }}>наведите столбец — разбивка за день</span>
        </div>

        <div className="hero-split">
          <div className="legend-pane">
            <div className="legend-tools">
              <div className="legend-actions" style={{ marginLeft: 'auto' }}>
                <button className="mini-btn" onClick={enableAll}>Все</button>
                <button className="mini-btn" onClick={clearAll}>Сбросить</button>
              </div>
            </div>
            <div className="legend-list">
              {legend.map((s) => {
                const on = !disabled.has(s.key)
                return (
                  <div key={s.key} className={`lrow${on ? '' : ' dim'}`}
                    onClick={() => toggle(s.key)}
                    onMouseEnter={() => setHoverSrc(s.key)} onMouseLeave={() => setHoverSrc(null)}>
                    <span className="lrow-cb" style={{ background: on ? 'var(--c-accent)' : 'transparent', borderColor: on ? 'var(--c-accent)' : 'var(--c-border-strong)' }}>
                      {on && <Icon name="check" size={11} />}
                    </span>
                    <span className="lrow-sw" style={{ background: sourceColor(s.key) }} />
                    <span className="lrow-name">{s.name}</span>
                    <span className="lrow-amt">{fmtShort(totalByKey[s.key])}</span>
                    <button className="lrow-solo" onClick={(e) => { e.stopPropagation(); solo(s.key) }}>ТОЛЬКО</button>
                  </div>
                )
              })}
              {legend.length === 0 && (
                <div style={{ padding: '20px 8px', fontSize: 12, color: 'var(--c-text-subtle)', textAlign: 'center' }}>
                  За период дохода нет
                </div>
              )}
            </div>
          </div>

          <div className="chart-pane">
            {sources.length === 0 ? (
              <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>
                За выбранный период дохода нет
              </div>
            ) : activeCount === 0 ? (
              <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--c-text-subtle)', fontSize: 13, textAlign: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--c-text)', marginBottom: 4 }}>Источники не выбраны</div>
                  Включите хотя бы один источник слева, чтобы увидеть динамику.
                </div>
              </div>
            ) : (
              <>
                <div className="plot" ref={plotRef} onMouseMove={onPlotMove} onMouseLeave={() => setHoverDay(null)}>
                  {gridVals.map((gv, i) => (
                    <div key={i} className="gridline" style={{ top: `${(1 - gv / axisMax) * 100}%` }}>
                      <span className="yl">{fmtShort(gv)}</span>
                    </div>
                  ))}
                  <div className="gridline" style={{ top: '100%' }}><span className="yl">0</span></div>

                  <div className="bars">
                    {days.map((day, di) => {
                      const total = dayTotals[di]
                      return (
                        <div key={day} className={`bcol${hoverDay === di ? ' sel' : ''}`} onMouseEnter={() => setHoverDay(di)} onClick={() => onSelectDay(day)}>
                          <div className="bstack" style={{ height: `${axisMax > 0 ? (total / axisMax) * 100 : 0}%` }}>
                            {renderSrc.map((s) => {
                              const v = s.series[di] ?? 0
                              if (v <= 0 || total <= 0) return null
                              const dim = hoverSrc && s.key !== hoverSrc
                              return <div key={s.key} className="bseg" style={{ height: `${(v / total) * 100}%`, background: sourceColor(s.key), opacity: dim ? 0.16 : 1 }} />
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {tip && (
                    <div className="an-tip" style={{
                      left: Math.max(96, Math.min(tipX, plotWidth() - 8)), top: 4,
                      transform: tipX > plotWidth() - 130 ? 'translateX(-100%)' : 'translateX(-50%)',
                    }}>
                      <div className="an-tip-date">{fmtDayFull(tip.day)}</div>
                      <div className="an-tip-total">{fmtRub(tip.total)} ₽</div>
                      {tip.segs.map((s, i) => (
                        <div key={i} className="an-tip-row">
                          <span className="an-tip-sw" style={{ background: s.color }} />
                          <span className="an-tip-nm">{s.name}</span>
                          <span className="an-tip-vl">{fmtRub(s.v)}</span>
                        </div>
                      ))}
                      {tip.segs.length === 0 && <div className="an-tip-more">Дохода нет</div>}
                      <div style={{ marginTop: 5, fontSize: 10.5, color: 'var(--c-text-faint)' }}>Нажмите — детализация дня</div>
                    </div>
                  )}
                </div>

                <div className="xaxis">
                  {days.map((day, di) => (
                    <div key={day} className="xtick">{di % labelEvery === 0 || di === period - 1 ? ddmm(day) : ''}</div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
        <div className="an-card">
          <div className="an-card-head">
            <div className="an-card-ico"><Icon name="coins" size={14} /></div>
            <span className="an-card-title">По источникам за период</span>
            <span className="an-card-hint">{breakdown.length} активно</span>
          </div>
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {breakdown.length === 0 ? (
              <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>Нет выбранных источников</div>
            ) : breakdown.map((s) => {
              const amt = totalByKey[s.key]
              const pct = Math.round((amt / bdMax) * 100)
              const share = grandTotal > 0 ? Math.round((amt / grandTotal) * 100) : 0
              return (
                <div key={s.key}>
                  <div className="bd-top">
                    <span className="bd-name">
                      <span className="lrow-sw" style={{ background: sourceColor(s.key) }} />
                      <span className="nm">{s.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--c-text-faint)', flexShrink: 0 }}>· {share}%</span>
                    </span>
                    <span className="mono" style={{ fontSize: 12.5, color: 'var(--c-text-muted)', fontWeight: 600, flexShrink: 0 }}>{fmtRub(amt)}</span>
                  </div>
                  <div className="prog" style={{ height: 7 }}>
                    <div className="prog-fill" style={{ width: `${pct}%`, background: sourceColor(s.key) }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="an-card">
          <div className="an-card-head">
            <div className="an-card-ico"><Icon name="users" size={14} /></div>
            <span className="an-card-title">По клиентам за период</span>
            <span className="an-card-hint">{byClient.length} {byClient.length === 1 ? 'клиент' : 'клиентов'}</span>
          </div>
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {byClient.length === 0 ? (
              <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>Нет данных</div>
            ) : byClient.slice(0, 12).map((c, i) => {
              const pct = Math.round((c.amount / clientMax) * 100)
              const share = data.total_amount > 0 ? Math.round((c.amount / data.total_amount) * 100) : 0
              const color = catColor(i)
              return (
                <div key={c.id ?? `none-${i}`}>
                  <div className="bd-top">
                    <span className="bd-name">
                      <span className="lrow-sw" style={{ background: color }} />
                      <span className="nm">{c.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--c-text-faint)', flexShrink: 0 }}>· {share}%</span>
                    </span>
                    <span className="mono" style={{ fontSize: 12.5, color: 'var(--c-text-muted)', fontWeight: 600, flexShrink: 0 }}>{fmtRub(c.amount)}</span>
                  </div>
                  <div className="prog" style={{ height: 7 }}>
                    <div className="prog-fill" style={{ width: `${pct}%`, background: color }} />
                  </div>
                </div>
              )
            })}
            {byClient.length > 12 && (
              <div style={{ fontSize: 11.5, color: 'var(--c-text-faint)', textAlign: 'center' }}>…и ещё {byClient.length - 12} клиентов</div>
            )}
          </div>
        </div>
      </div>
    </>
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
