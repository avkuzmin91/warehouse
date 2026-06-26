import { useMemo, useRef, useState } from 'react'
import { getExpenseAnalytics } from '../../../api/expensesApi'
import type { ExpenseAnalyticsCategory } from '../../../api/expensesApi'
import { ListPage } from '../../layouts/ListPage'
import { Icon } from '../../primitives/Icon'
import type { IconName } from '../../primitives/Icon'
import { EmptyState } from '../../primitives/EmptyState'
import { useApi } from '../../../hooks/useApi'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { useFilterParam } from '../../../hooks/useFilterParams'
import { moscowTodayYmd } from '../../../utils/format'

const PRESETS = [7, 14, 30] as const
const DEFAULT_PERIOD = 30

// Цвета статусов оплаты — семантические переменные темы.
const STATUS_COLOR: Record<string, string> = {
  paid: 'var(--c-success)',
  partially_paid: 'var(--c-info)',
  awaiting: 'var(--c-warning)',
  cancelled: 'var(--c-text-faint)',
}

// Палитра категорий: до 20 различимых тонов oklch (единая светлота/насыщенность,
// вращение тона). Семантических переменных темы (≈6) не хватает на стопку из ~20
// сегментов — для категориальной кодировки графика генерируем тона по индексу.
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

// Деньги: суммы хранятся в копейках. Рубли с тонким пробадзелом для KPI/тултипа.
function fmtRub(kopecks: number): string {
  return Math.round(kopecks / 100).toLocaleString('ru-RU').replace(/ /g, ' ')
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

type RenderCat = { key: string; name: string; color: string; isRest: boolean; at: (dayIdx: number) => number }

export function ExpensesAnalyticsFeature() {
  const { user } = useCurrentUser()
  const isFinance = user?.role === 'admin' || user?.role === 'manager'

  const [periodRaw, setPeriodRaw] = useFilterParam('days', String(DEFAULT_PERIOD))
  const period = PRESETS.includes(Number(periodRaw) as 7 | 14 | 30) ? Number(periodRaw) : DEFAULT_PERIOD

  const today = moscowTodayYmd()
  const effTo = today
  const effFrom = shiftYmd(today, -(period - 1))

  const { data, loading, error } = useApi(
    (s) => getExpenseAnalytics({ date_from: effFrom, date_to: effTo }, s),
    [effFrom, effTo],
  )

  // Состояние графика — отключённые категории (по имени; имена уникальны в ответе).
  // Храним «выключенные», а не «включённые», чтобы новые категории при смене периода
  // появлялись включёнными без согласования наборов.
  const [disabled, setDisabled] = useState<Set<string>>(() => new Set())
  const [query, setQuery] = useState('')
  const [groupTail, setGroupTail] = useState(false)
  const [hoverCat, setHoverCat] = useState<string | null>(null)
  const [hoverDay, setHoverDay] = useState<number | null>(null)
  const [tipX, setTipX] = useState(0)
  const plotRef = useRef<HTMLDivElement>(null)

  if (!isFinance) {
    return (
      <ListPage title="Аналитика расходов">
        <EmptyState title="Недостаточно прав" sub="Аналитика расходов доступна администратору и менеджеру." />
      </ListPage>
    )
  }

  function exportCsv() {
    if (!data) return
    const days = data.series.map((p) => p.date)
    const header = ['Дата', ...data.categories.map((c) => c.name)]
    const lines = [header.join(';')]
    days.forEach((d, i) => {
      lines.push([d, ...data.categories.map((c) => String(Math.round((c.series[i] ?? 0) / 100)))].join(';'))
    })
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `expenses-analytics-${effFrom}_${effTo}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const actions = (
    <>
      <div className="preset">
        {PRESETS.map((p) => (
          <button key={p} className={period === p ? 'on' : ''}
            onClick={() => { setPeriodRaw(String(p)); setHoverDay(null) }}>{p} дн.</button>
        ))}
      </div>
      <button className="btn" onClick={exportCsv} disabled={!data || data.categories.length === 0}>
        <Icon name="download" size={14} />Выгрузить
      </button>
    </>
  )

  return (
    <ListPage
      title="Аналитика расходов"
      subtitle={`Период: ${ddmm(effFrom)} — ${ddmm(effTo)} · ${period} дн.`}
      actions={actions}
    >
      {loading && !data ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>Загрузка аналитики…</div>
      ) : error ? (
        <EmptyState title="Не удалось загрузить аналитику" sub={error.message} />
      ) : !data ? null : (
        <AnalyticsBody
          cats={data.categories}
          days={data.series.map((p) => p.date)}
          period={period}
          byStatus={data.by_status}
          disabled={disabled} setDisabled={setDisabled}
          query={query} setQuery={setQuery}
          groupTail={groupTail} setGroupTail={setGroupTail}
          hoverCat={hoverCat} setHoverCat={setHoverCat}
          hoverDay={hoverDay} setHoverDay={setHoverDay}
          tipX={tipX} setTipX={setTipX}
          plotRef={plotRef}
        />
      )}
    </ListPage>
  )
}

function AnalyticsBody({
  cats, days, period, byStatus,
  disabled, setDisabled, query, setQuery, groupTail, setGroupTail,
  hoverCat, setHoverCat, hoverDay, setHoverDay, tipX, setTipX, plotRef,
}: {
  cats: ExpenseAnalyticsCategory[]
  days: string[]
  period: number
  byStatus: { payment_status: string; label: string; amount: number; count: number }[]
  disabled: Set<string>
  setDisabled: (s: Set<string>) => void
  query: string
  setQuery: (s: string) => void
  groupTail: boolean
  setGroupTail: (fn: (v: boolean) => boolean) => void
  hoverCat: string | null
  setHoverCat: (s: string | null) => void
  hoverDay: number | null
  setHoverDay: (n: number | null) => void
  tipX: number
  setTipX: (n: number) => void
  plotRef: React.RefObject<HTMLDivElement | null>
}) {
  // Цвет закреплён за категорией по её позиции в ответе (бэкенд сортирует по сумме убыв.).
  const colorByName = useMemo(() => {
    const m: Record<string, string> = {}
    cats.forEach((c, i) => { m[c.name] = catColor(i) })
    return m
  }, [cats])
  const totalByName = useMemo(() => {
    const m: Record<string, number> = {}
    cats.forEach((c) => { m[c.name] = c.series.reduce((s, v) => s + v, 0) })
    return m
  }, [cats])

  const enabledCats = cats.filter((c) => !disabled.has(c.name))
  const activeCount = enabledCats.length
  const grandTotal = enabledCats.reduce((s, c) => s + totalByName[c.name], 0)

  const toggle = (name: string) => {
    const n = new Set(disabled)
    n.has(name) ? n.delete(name) : n.add(name)
    setDisabled(n)
  }
  const solo = (name: string) => setDisabled(new Set(cats.filter((c) => c.name !== name).map((c) => c.name)))
  const enableAll = () => setDisabled(new Set())
  const clearAll = () => setDisabled(new Set(cats.map((c) => c.name)))
  const top8 = () => {
    const keep = new Set([...cats].sort((a, b) => totalByName[b.name] - totalByName[a.name]).slice(0, 8).map((c) => c.name))
    setDisabled(new Set(cats.filter((c) => !keep.has(c.name)).map((c) => c.name)))
  }

  // Категории для стопки: включённые по убыванию; при «свернуть мелкие» — хвост (<3%) в «Остальные».
  const renderCats: RenderCat[] = useMemo(() => {
    const sorted = [...enabledCats].sort((a, b) => totalByName[b.name] - totalByName[a.name])
    const base = (c: ExpenseAnalyticsCategory): RenderCat => ({
      key: c.name, name: c.name, color: colorByName[c.name], isRest: false, at: (i) => c.series[i] ?? 0,
    })
    if (!groupTail || grandTotal <= 0) return sorted.map(base)
    const thr = grandTotal * 0.03
    const big = sorted.filter((c) => totalByName[c.name] >= thr)
    const small = sorted.filter((c) => totalByName[c.name] < thr)
    const out = big.map(base)
    if (small.length > 1) {
      out.push({
        key: '__rest', name: `Остальные · ${small.length}`, color: 'var(--c-text-faint)', isRest: true,
        at: (i) => small.reduce((s, c) => s + (c.series[i] ?? 0), 0),
      })
    } else if (small.length === 1) {
      out.push(base(small[0]))
    }
    return out
  }, [enabledCats, groupTail, grandTotal, totalByName, colorByName])

  const dayTotals = days.map((_, i) => renderCats.reduce((s, c) => s + c.at(i), 0))
  const peak = Math.max(0, ...dayTotals)
  const axisMax = niceMax(peak)
  const avg = period > 0 ? grandTotal / period : 0
  const gridVals = [1, 0.75, 0.5, 0.25].map((f) => axisMax * f)
  const labelEvery = Math.max(1, Math.ceil(period / 15))

  // Легенда: все категории по убыванию суммы, фильтр по поиску.
  const legendCats = useMemo(() => {
    const q = query.trim().toLowerCase()
    return [...cats]
      .sort((a, b) => totalByName[b.name] - totalByName[a.name])
      .filter((c) => !q || c.name.toLowerCase().includes(q))
  }, [cats, query, totalByName])

  const breakdown = [...enabledCats].sort((a, b) => totalByName[b.name] - totalByName[a.name])
  const bdMax = Math.max(1, ...breakdown.map((c) => totalByName[c.name]))

  const statusTotal = byStatus.reduce((s, r) => s + r.amount, 0)
  const stMax = Math.max(1, ...byStatus.map((r) => r.amount))

  const tip = hoverDay == null ? null : (() => {
    const segs = renderCats.map((c) => ({ name: c.name, color: c.color, v: c.at(hoverDay) }))
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
        <KpiCard icon="coins" label="Начислено за период" value={fmtRub(grandTotal)} unit="₽" sub="по выбранным категориям" />
        <KpiCard icon="calendar" label="В среднем за день" value={fmtRub(avg)} unit="₽" sub={`${period} дн. в периоде`} />
        <KpiCard icon="chart" label="Пик за день" value={fmtRub(peak)} unit="₽" sub="максимум в одном дне" />
        <KpiCard icon="layers" label="Категорий активно" value={`${activeCount}`} unit={`/ ${cats.length}`}
          sub="включено в график" tone={activeCount === 0 ? 'var(--c-warning)' : undefined} />
      </div>

      <div className="an-card" style={{ marginBottom: 16 }}>
        <div className="an-card-head">
          <div className="an-card-ico"><Icon name="chart" size={14} /></div>
          <span className="an-card-title">Динамика по дням</span>
          <span className="an-card-hint" style={{ marginLeft: 8, marginRight: 'auto' }}>наведите столбец — разбивка за день</span>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--c-text-muted)', cursor: 'pointer', userSelect: 'none' }}>
            <span className="lrow-cb" style={{ background: groupTail ? 'var(--c-accent)' : 'transparent', borderColor: groupTail ? 'var(--c-accent)' : 'var(--c-border-strong)' }}>
              {groupTail && <Icon name="check" size={11} />}
            </span>
            Свернуть мелкие в «Остальные»
            <input type="checkbox" checked={groupTail} onChange={() => setGroupTail((v) => !v)} style={{ display: 'none' }} />
          </label>
        </div>

        <div className="hero-split">
          <div className="legend-pane">
            <div className="legend-tools">
              <div className="legend-search">
                <span className="ic"><Icon name="search" size={13} /></span>
                <input className="input sm" style={{ paddingLeft: 28 }} placeholder="Поиск категории…" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <div className="legend-actions">
                <button className="mini-btn" onClick={enableAll}>Все</button>
                <button className="mini-btn" onClick={clearAll}>Сбросить</button>
                <button className="mini-btn" onClick={top8}>Топ-8</button>
              </div>
            </div>
            <div className="legend-list">
              {legendCats.map((c) => {
                const on = !disabled.has(c.name)
                return (
                  <div key={c.name} className={`lrow${on ? '' : ' dim'}`}
                    onClick={() => toggle(c.name)}
                    onMouseEnter={() => setHoverCat(c.name)} onMouseLeave={() => setHoverCat(null)}>
                    <span className="lrow-cb" style={{ background: on ? 'var(--c-accent)' : 'transparent', borderColor: on ? 'var(--c-accent)' : 'var(--c-border-strong)' }}>
                      {on && <Icon name="check" size={11} />}
                    </span>
                    <span className="lrow-sw" style={{ background: colorByName[c.name] }} />
                    <span className="lrow-name">{c.name}</span>
                    <span className="lrow-amt">{fmtShort(totalByName[c.name])}</span>
                    <button className="lrow-solo" onClick={(e) => { e.stopPropagation(); solo(c.name) }}>ТОЛЬКО</button>
                  </div>
                )
              })}
              {legendCats.length === 0 && (
                <div style={{ padding: '20px 8px', fontSize: 12, color: 'var(--c-text-subtle)', textAlign: 'center' }}>
                  {cats.length === 0 ? 'За период начислений нет' : 'Ничего не найдено'}
                </div>
              )}
            </div>
          </div>

          <div className="chart-pane">
            {cats.length === 0 ? (
              <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>
                За выбранный период начислений нет
              </div>
            ) : activeCount === 0 ? (
              <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--c-text-subtle)', fontSize: 13, textAlign: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--c-text)', marginBottom: 4 }}>Категории не выбраны</div>
                  Включите хотя бы одну категорию слева, чтобы увидеть динамику.
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
                        <div key={day} className={`bcol${hoverDay === di ? ' sel' : ''}`} onMouseEnter={() => setHoverDay(di)}>
                          <div className="bstack" style={{ height: `${axisMax > 0 ? (total / axisMax) * 100 : 0}%` }}>
                            {renderCats.map((c) => {
                              const v = c.at(di)
                              if (v <= 0 || total <= 0) return null
                              const dim = hoverCat && !c.isRest && c.name !== hoverCat
                              return <div key={c.key} className="bseg" style={{ height: `${(v / total) * 100}%`, background: c.color, opacity: dim ? 0.16 : 1 }} />
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
                      {tip.segs.slice(0, 6).map((s, i) => (
                        <div key={i} className="an-tip-row">
                          <span className="an-tip-sw" style={{ background: s.color }} />
                          <span className="an-tip-nm">{s.name}</span>
                          <span className="an-tip-vl">{fmtRub(s.v)}</span>
                        </div>
                      ))}
                      {tip.segs.length > 6 && <div className="an-tip-more">…и ещё {tip.segs.length - 6}</div>}
                      {tip.segs.length === 0 && <div className="an-tip-more">Расходов нет</div>}
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
            <span className="an-card-title">По категориям за период</span>
            <span className="an-card-hint">{breakdown.length} активно</span>
          </div>
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {breakdown.length === 0 ? (
              <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>Нет выбранных категорий</div>
            ) : breakdown.slice(0, 12).map((c) => {
              const amt = totalByName[c.name]
              const pct = Math.round((amt / bdMax) * 100)
              const share = grandTotal > 0 ? Math.round((amt / grandTotal) * 100) : 0
              return (
                <div key={c.name}>
                  <div className="bd-top">
                    <span className="bd-name">
                      <span className="lrow-sw" style={{ background: colorByName[c.name] }} />
                      <span className="nm">{c.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--c-text-faint)', flexShrink: 0 }}>· {share}%</span>
                    </span>
                    <span className="mono" style={{ fontSize: 12.5, color: 'var(--c-text-muted)', fontWeight: 600, flexShrink: 0 }}>{fmtRub(amt)}</span>
                  </div>
                  <div className="prog" style={{ height: 7 }}>
                    <div className="prog-fill" style={{ width: `${pct}%`, background: colorByName[c.name] }} />
                  </div>
                </div>
              )
            })}
            {breakdown.length > 12 && (
              <div style={{ fontSize: 11.5, color: 'var(--c-text-faint)', textAlign: 'center' }}>…и ещё {breakdown.length - 12} категорий</div>
            )}
          </div>
        </div>

        <div className="an-card">
          <div className="an-card-head">
            <div className="an-card-ico"><Icon name="wallet" size={14} /></div>
            <span className="an-card-title">По статусу оплаты</span>
            <span className="an-card-hint">обязательства реестра за период</span>
          </div>
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {byStatus.length === 0 ? (
              <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>Нет данных</div>
            ) : byStatus.map((s) => {
              const pct = Math.round((s.amount / stMax) * 100)
              const color = STATUS_COLOR[s.payment_status] ?? 'var(--c-text-subtle)'
              return (
                <div key={s.payment_status}>
                  <div className="bd-top">
                    <span className="bd-name">
                      <span className="lrow-sw" style={{ background: color }} />
                      <span className="nm">{s.label}</span>
                      <span style={{ fontSize: 11, color: 'var(--c-text-faint)', flexShrink: 0 }}>· {s.count}</span>
                    </span>
                    <span className="mono" style={{ fontSize: 12.5, color: 'var(--c-text-muted)', fontWeight: 600, flexShrink: 0 }}>{fmtRub(s.amount)}</span>
                  </div>
                  <div className="prog" style={{ height: 7 }}>
                    <div className="prog-fill" style={{ width: `${pct}%`, background: color }} />
                  </div>
                </div>
              )
            })}
            {byStatus.length > 0 && (
              <div style={{ marginTop: 2, paddingTop: 12, borderTop: '1px solid var(--c-border)', display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                <span style={{ color: 'var(--c-text-muted)' }}>Итого обязательств</span>
                <span className="mono" style={{ fontWeight: 700 }}>{fmtRub(statusTotal)} ₽</span>
              </div>
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
