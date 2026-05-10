import { useEffect, useMemo, useState } from 'react'
import { ApplyFiltersIcon, ResetFiltersIcon } from '../components/CollectionActions'
import { DateRangeFilter } from '../components/DateRangeFilter'
import { DictionaryFilterCombobox } from '../components/DictionaryFilterCombobox'
import { BarChart, LineChart } from '../components/MiniCharts'
import {
  type AnalyticsGroup,
  type ClientPortalDashboardMetrics,
  type DeadStockReport,
  type MovementReport,
  type TopProductsReport,
  getClientPortalDashboardDeadStock,
  getClientPortalDashboardMetrics,
  getClientPortalDashboardMovement,
  getClientPortalDashboardTopProducts,
} from '../api'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function isoMinusDays(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

function formatDeadStockLastMovement(iso: string | null): string {
  if (!iso?.trim()) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
}

type PeriodPreset = 'today' | 'last7' | 'last30' | 'last90' | 'last365' | 'custom'

function rangeForPreset(preset: Exclude<PeriodPreset, 'custom'>): { date_from: string; date_to: string } {
  const to = todayIso()
  if (preset === 'today') return { date_from: to, date_to: to }
  if (preset === 'last7') return { date_from: isoMinusDays(6), date_to: to }
  if (preset === 'last30') return { date_from: isoMinusDays(29), date_to: to }
  if (preset === 'last90') return { date_from: isoMinusDays(89), date_to: to }
  return { date_from: isoMinusDays(364), date_to: to }
}

function detectPreset(dateFrom: string, dateTo: string): PeriodPreset {
  const to = todayIso()
  if (dateFrom === to && dateTo === to) return 'today'
  if (dateFrom === isoMinusDays(6) && dateTo === to) return 'last7'
  if (dateFrom === isoMinusDays(29) && dateTo === to) return 'last30'
  if (dateFrom === isoMinusDays(89) && dateTo === to) return 'last90'
  if (dateFrom === isoMinusDays(364) && dateTo === to) return 'last365'
  return 'custom'
}

type CabinetDashFilters = {
  date_from: string
  date_to: string
  /** Не задан — в запрос уходит «день». */
  group?: AnalyticsGroup
}

const DEFAULT_FILTERS: CabinetDashFilters = {
  ...rangeForPreset('last30'),
  group: 'day',
}

const GROUP_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Шаг графика' },
  { value: 'day', label: 'День' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
]

function filtersEqual(a: CabinetDashFilters, b: CabinetDashFilters): boolean {
  return (
    a.date_from === b.date_from &&
    a.date_to === b.date_to &&
    a.group === b.group
  )
}

function normalizeCommittedFilters(f: CabinetDashFilters): CabinetDashFilters {
  return { ...f, group: f.group ?? 'day' }
}

export function ClientCabinetDashboardPage() {
  const [draftFilters, setDraftFilters] = useState<CabinetDashFilters>(DEFAULT_FILTERS)
  const [committedFilters, setCommittedFilters] = useState<CabinetDashFilters>(DEFAULT_FILTERS)

  const dirty = useMemo(() => !filtersEqual(draftFilters, committedFilters), [draftFilters, committedFilters])

  const [metrics, setMetrics] = useState<ClientPortalDashboardMetrics | null>(null)
  const [movement, setMovement] = useState<MovementReport | null>(null)
  const [top, setTop] = useState<TopProductsReport | null>(null)
  const [deadStock, setDeadStock] = useState<DeadStockReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const activePreset = detectPreset(draftFilters.date_from, draftFilters.date_to)

  const committedGroup = committedFilters.group ?? 'day'

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    const df = committedFilters.date_from
    const dt = committedFilters.date_to
    Promise.all([
      getClientPortalDashboardMetrics({ date_from: df, date_to: dt }),
      getClientPortalDashboardMovement({
        date_from: df,
        date_to: dt,
        group: committedGroup,
      }),
      getClientPortalDashboardTopProducts({
        date_from: df,
        date_to: dt,
        limit: 8,
      }),
    ])
      .then(([m, mv, tp]) => {
        if (cancelled) return
        setMetrics(m)
        setMovement(mv)
        setTop(tp)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Ошибка загрузки')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [committedFilters.date_from, committedFilters.date_to, committedGroup])

  useEffect(() => {
    let cancelled = false
    getClientPortalDashboardDeadStock({ days: 30 })
      .then((ds) => {
        if (!cancelled) setDeadStock(ds)
      })
      .catch(() => {
        if (!cancelled) setDeadStock(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const lineProps = useMemo(() => {
    if (!movement?.data?.length) {
      return { labels: [] as string[], series: [] as { name: string; color: string; values: number[] }[] }
    }
    const labels = movement.data.map((b) => b.period)
    return {
      labels,
      series: [
        { name: 'Поступления', color: 'var(--chart-in, #2e7d32)', values: movement.data.map((b) => b.inflow) },
        { name: 'Отгрузки', color: 'var(--chart-out, #c62828)', values: movement.data.map((b) => b.outflow) },
      ],
    }
  }, [movement])

  const barData = useMemo(() => {
    if (!top?.data?.length) return []
    return top.data.map((r) => ({
      label: r.product.length > 22 ? `${r.product.slice(0, 20)}…` : r.product,
      value: r.total_outflow,
    }))
  }, [top])

  const deadStockSummary = useMemo(() => {
    if (!deadStock?.data?.length) return null
    const positions = deadStock.data.length
    const units = deadStock.data.reduce((s, r) => s + r.stock, 0)
    return { positions, units, days: deadStock.days_threshold }
  }, [deadStock])

  function applyFilters() {
    const next = normalizeCommittedFilters(draftFilters)
    setCommittedFilters(next)
    setDraftFilters(next)
  }

  function resetAllFilters() {
    setDraftFilters(DEFAULT_FILTERS)
    setCommittedFilters(DEFAULT_FILTERS)
  }

  return (
    <div className="cabinet-dashboard">
      <h1 className="cabinet-dashboard__title">Сводка</h1>

      <div className="analytics-admin-filters cabinet-dashboard__filters">
        <div className="analytics-admin-filters__grid analytics-admin-filters__grid--cabinet">
          <div className="analytics-admin-filters__cell analytics-admin-filters__cell--range">
            <span className="analytics-admin-filters__label">Период</span>
            <DateRangeFilter
              placeholder="Период"
              dateFrom={draftFilters.date_from}
              dateTo={draftFilters.date_to}
              disabled={loading}
              className="analytics-admin-filters__date-range"
              quickPresets={[
                { label: 'Сегодня', ...rangeForPreset('today') },
                { label: '7 дней', ...rangeForPreset('last7') },
                { label: '30 дней', ...rangeForPreset('last30') },
                { label: '90 дней', ...rangeForPreset('last90') },
                { label: '1 год', ...rangeForPreset('last365') },
              ]}
              onChange={(next) => {
                if (next.date_from === undefined && next.date_to === undefined) {
                  setDraftFilters((f) => ({ ...f, ...rangeForPreset('last30') }))
                  return
                }
                setDraftFilters((f) => ({
                  ...f,
                  date_from: next.date_from ?? f.date_from,
                  date_to: next.date_to ?? f.date_to,
                }))
              }}
            />
          </div>

          <div className="analytics-admin-filters__cell analytics-admin-filters__cell--step">
            <span className="analytics-admin-filters__label">Шаг графика</span>
            <DictionaryFilterCombobox
              name="analytics_group"
              options={GROUP_FILTER_OPTIONS}
              valueStr={draftFilters.group ?? ''}
              onSelectChange={(_name, v) =>
                setDraftFilters((f) => ({
                  ...f,
                  group: v === null ? undefined : (v as AnalyticsGroup),
                }))
              }
              disabled={loading}
              listPortal
              openListAfterClear
              ariaLabel="Шаг графика"
            />
          </div>

          <div className="analytics-admin-filters__cell analytics-admin-filters__cell--actions">
            <span className="analytics-admin-filters__label analytics-admin-filters__label--spacer" aria-hidden>
              {'\u00a0'}
            </span>
            <div className="analytics-admin-filters__actions-toolbar">
              <button
                type="button"
                className="btn btn--secondary collection-actions__icon-btn collection-actions__reset-filters analytics-admin-filters__toolbar-icon"
                disabled={loading}
                onClick={resetAllFilters}
                aria-label="Сбросить фильтры"
                title="Сбросить фильтры"
              >
                <ResetFiltersIcon />
              </button>
              <button
                type="button"
                className="btn btn--primary collection-actions__icon-btn analytics-admin-filters__apply-icon analytics-admin-filters__toolbar-icon"
                disabled={loading || !dirty}
                onClick={applyFilters}
                aria-label="Применить фильтры"
                title="Применить фильтры"
              >
                <ApplyFiltersIcon />
              </button>
            </div>
          </div>
        </div>
      </div>

      {activePreset === 'custom' ? (
        <p className="analytics-admin-filters__preset-note">Выбран произвольный период</p>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}
      {loading && !metrics ? <p className="auth-card__subtitle">Загрузка...</p> : null}

      {metrics ? (
        <div className="cabinet-dashboard__tiles">
          <div className="cabinet-dashboard__tile">
            <div className="cabinet-dashboard__tile-label">Текущий остаток</div>
            <div className="cabinet-dashboard__tile-value">{metrics.total_stock}</div>
          </div>
          <div className="cabinet-dashboard__tile">
            <div className="cabinet-dashboard__tile-label">Поступления за период</div>
            <div className="cabinet-dashboard__tile-value cabinet-dashboard__tile-value--in">
              {metrics.period_inflow}
            </div>
          </div>
          <div className="cabinet-dashboard__tile">
            <div className="cabinet-dashboard__tile-label">Отгрузки за период</div>
            <div className="cabinet-dashboard__tile-value cabinet-dashboard__tile-value--out">
              {metrics.period_outflow}
            </div>
          </div>
          {deadStockSummary ? (
            <>
              <div className="cabinet-dashboard__tile cabinet-dashboard__tile--dead-stock">
                <div className="cabinet-dashboard__tile-label">
                  Позиций без движения ≥{deadStockSummary.days} дн.
                </div>
                <div className="cabinet-dashboard__tile-value cabinet-dashboard__tile-value--dead-stock">
                  {deadStockSummary.positions}
                </div>
              </div>
              <div className="cabinet-dashboard__tile cabinet-dashboard__tile--dead-stock">
                <div className="cabinet-dashboard__tile-label">Штук в мёртвых остатках</div>
                <div className="cabinet-dashboard__tile-value cabinet-dashboard__tile-value--dead-stock">
                  {deadStockSummary.units}
                </div>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {movement && lineProps.labels.length > 0 ? (
        <section className="cabinet-dashboard__section">
          <h2 className="cabinet-dashboard__section-title">Приход и расход</h2>
          <LineChart labels={lineProps.labels} series={lineProps.series} width={720} height={220} />
        </section>
      ) : null}

      {top && barData.length > 0 ? (
        <section className="cabinet-dashboard__section">
          <h2 className="cabinet-dashboard__section-title">Топ товаров по отгрузке</h2>
          <BarChart data={barData} width={720} height={220} color="#7f9bff" />
        </section>
      ) : null}

      {deadStock && deadStock.data.length > 0 ? (
        <section className="cabinet-dashboard__section cabinet-dashboard__section--dead-stock">
          <h2 className="cabinet-dashboard__section-title">Позиции в мёртвых остатках</h2>
          <p className="cabinet-dashboard__dead-hint">{deadStock.explanation}</p>
          <div className="analytics-table-wrap">
            <table className="analytics-table">
              <thead>
                <tr>
                  <th>Товар</th>
                  <th>Цвет</th>
                  <th>Размер</th>
                  <th className="num">Остаток, шт.</th>
                  <th className="num">Дней без движения</th>
                  <th>Последнее движение</th>
                </tr>
              </thead>
              <tbody>
                {deadStock.data.map((it, i) => (
                  <tr key={`${it.product_id}-${it.color_id ?? ''}-${it.size_id ?? ''}-${i}`}>
                    <td>{it.product}</td>
                    <td>{it.color || '—'}</td>
                    <td>{it.size || '—'}</td>
                    <td className="num">{it.stock}</td>
                    <td className="num qty-zero">{it.days_without_movement}</td>
                    <td>{formatDeadStockLastMovement(it.last_movement_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  )
}
