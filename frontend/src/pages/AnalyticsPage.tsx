import { useEffect, useId, useMemo, useState } from 'react'
import { ApplyFiltersIcon, ResetFiltersIcon } from '../components/CollectionActions'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { PageContainer } from '../components/PageContainer'
import { DateRangeFilter } from '../components/DateRangeFilter'
import { DictionaryFilterCombobox } from '../components/DictionaryFilterCombobox'
import { DictionaryMultiSelect } from '../components/DictionaryMultiSelect'
import {
  HorizontalBarChart,
  LineChart,
  StackedHorizontalBarChart,
} from '../components/MiniCharts'
import './AnalyticsPage.css'
import {
  type AdminDashboardReport,
  type AnalyticsCommonParams,
  type AnalyticsGroup,
  type DictionaryItem,
  type MovementReport,
} from '../api/domainTypes'
import { getInventoryClients } from '../api/inventoryApi'
import { getAnalyticsAdminDashboard, getAnalyticsMovement } from '../api/analyticsApi'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function isoMinusDays(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

function fmtQty(n: number): string {
  return new Intl.NumberFormat('ru-RU').format(n)
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

type Filters = {
  date_from: string
  date_to: string
  client_ids: string[]
  /** Не задан — шаг сброшен в форме; в запрос применяется «день». */
  group?: AnalyticsGroup
}

const DEFAULT_FILTERS: Filters = {
  ...rangeForPreset('last30'),
  client_ids: [],
  group: 'day',
}

const GROUP_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Шаг графика' },
  { value: 'day', label: 'День' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
]

function sortedIds(ids: string[]): string[] {
  return [...ids].map((x) => x.trim()).filter(Boolean).sort()
}

function filtersEqual(a: Filters, b: Filters): boolean {
  return (
    a.date_from === b.date_from &&
    a.date_to === b.date_to &&
    a.group === b.group &&
    sortedIds(a.client_ids).join('\0') === sortedIds(b.client_ids).join('\0')
  )
}

function normalizeCommittedFilters(f: Filters): Filters {
  return { ...f, group: f.group ?? 'day' }
}

function DashboardSkeleton() {
  return (
    <div className="analytics-dash-skeleton" aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Загрузка аналитики</span>
      <div className="analytics-dash-skeleton__kpis">
        <div className="analytics-dash-skeleton__kpi" />
        <div className="analytics-dash-skeleton__kpi" />
        <div className="analytics-dash-skeleton__kpi" />
        <div className="analytics-dash-skeleton__kpi" />
      </div>
      <div className="analytics-dash-skeleton__chart" />
      <div className="analytics-dash-skeleton__split">
        <div className="analytics-dash-skeleton__chart" />
        <div className="analytics-dash-skeleton__chart" />
      </div>
      <div className="analytics-dash-skeleton__chart" />
      <div className="analytics-dash-skeleton__split">
        <div className="analytics-dash-skeleton__chart" />
        <div className="analytics-dash-skeleton__chart" />
      </div>
    </div>
  )
}

export function AnalyticsPage() {
  const formId = useId()
  const clientsLegendId = `${formId}-clients-legend`

  const [draftFilters, setDraftFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [committedFilters, setCommittedFilters] = useState<Filters>(DEFAULT_FILTERS)

  const dirty = useMemo(() => !filtersEqual(draftFilters, committedFilters), [draftFilters, committedFilters])

  const [clients, setClients] = useState<DictionaryItem[]>([])

  const [dash, setDash] = useState<AdminDashboardReport | null>(null)
  const [movement, setMovement] = useState<MovementReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const activePreset = detectPreset(draftFilters.date_from, draftFilters.date_to)

  useEffect(() => {
    let cancelled = false
    getInventoryClients()
      .then((cs) => {
        if (!cancelled) setClients(cs)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const common: AnalyticsCommonParams = useMemo(
    () => ({
      date_from: committedFilters.date_from,
      date_to: committedFilters.date_to,
      client_ids: committedFilters.client_ids.length ? committedFilters.client_ids : undefined,
    }),
    [committedFilters.date_from, committedFilters.date_to, committedFilters.client_ids],
  )

  const committedGroup = committedFilters.group ?? 'day'

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    Promise.all([
      getAnalyticsAdminDashboard({
        ...common,
        movement_clients_limit: 14,
      }),
      getAnalyticsMovement({ ...common, group: committedGroup }),
    ])
      .then(([d, mv]) => {
        if (!cancelled) {
          setDash(d)
          setMovement(mv)
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setDash(null)
          setMovement(null)
          setError(e instanceof Error ? e.message : 'Ошибка загрузки')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [common, committedGroup])

  const lineLabels = useMemo(() => (movement?.data ?? []).map((b) => b.period), [movement])
  const lineSeries = useMemo(
    () => [
      {
        name: 'Поступления',
        color: '#22c55e',
        values: (movement?.data ?? []).map((b) => b.inflow),
      },
      {
        name: 'Отгрузки',
        color: '#ea580c',
        values: (movement?.data ?? []).map((b) => b.outflow),
      },
    ],
    [movement],
  )

  const stockBars = useMemo(
    () =>
      (dash?.stock_by_client ?? []).map((r) => ({
        label: r.client || r.client_id,
        value: r.stock,
      })),
    [dash],
  )

  const stackedClients = useMemo(
    () =>
      (dash?.client_movement ?? []).map((r) => ({
        label: r.client || r.client_id,
        inflow: r.inflow,
        outflow: r.outflow,
      })),
    [dash],
  )

  const topByShipment = useMemo(() => {
    const rows = [...(dash?.client_movement ?? [])]
    rows.sort((a, b) => b.outflow - a.outflow)
    return rows.slice(0, 10).map((r) => ({
      label: r.client || r.client_id,
      value: r.outflow,
    }))
  }, [dash])

  const topByStock = useMemo(
    () =>
      (dash?.stock_by_client ?? [])
        .slice(0, 10)
        .map((r) => ({ label: r.client || r.client_id, value: r.stock })),
    [dash],
  )

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
    <PageContainer maxWidth={1280} cardClassName="users-card analytics-card analytics-dash">
      <Breadcrumbs />

      <div className="analytics-admin-filters">
        <div className="analytics-admin-filters__grid">
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

          <div className="analytics-admin-filters__cell analytics-admin-filters__cell--clients">
            <fieldset className="product-colors-fieldset analytics-admin-filters__clients-fieldset">
              <legend className="field-label analytics-admin-filters__filters-legend" id={clientsLegendId}>
                Клиенты
              </legend>
              <DictionaryMultiSelect
                id={`${formId}-clients-ms`}
                aria-labelledby={clientsLegendId}
                items={clients}
                selectedIds={draftFilters.client_ids}
                onChange={(ids) => setDraftFilters((f) => ({ ...f, client_ids: ids }))}
                sortMode="alphabet"
                disabled={loading}
                placeholder="Все клиенты"
                allowClearAll
              />
            </fieldset>
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

      {error ? <p className="error-text analytics-dash__error">{error}</p> : null}

      {loading ? <DashboardSkeleton /> : null}

      {!loading && dash ? (
        <>
          <section className="analytics-dash-kpi" aria-label="Ключевые показатели">
            <article className="analytics-dash-kpi__card">
              <span className="analytics-dash-kpi__emoji" aria-hidden>
                📦
              </span>
              <div className="analytics-dash-kpi__meta">
                <span className="analytics-dash-kpi__label">Поступило</span>
                <span className="analytics-dash-kpi__value">{fmtQty(dash.total_inflow)}</span>
              </div>
            </article>
            <article className="analytics-dash-kpi__card">
              <span className="analytics-dash-kpi__emoji" aria-hidden>
                🚚
              </span>
              <div className="analytics-dash-kpi__meta">
                <span className="analytics-dash-kpi__label">Отгружено</span>
                <span className="analytics-dash-kpi__value">{fmtQty(dash.total_outflow)}</span>
              </div>
            </article>
            <article className="analytics-dash-kpi__card">
              <span className="analytics-dash-kpi__emoji" aria-hidden>
                🏷
              </span>
              <div className="analytics-dash-kpi__meta">
                <span className="analytics-dash-kpi__label">Остаток</span>
                <span className="analytics-dash-kpi__value">{fmtQty(dash.stock_total)}</span>
                <span className="analytics-dash-kpi__hint">на {dash.at_date}</span>
              </div>
            </article>
            <article className="analytics-dash-kpi__card">
              <span className="analytics-dash-kpi__emoji" aria-hidden>
                👥
              </span>
              <div className="analytics-dash-kpi__meta">
                <span className="analytics-dash-kpi__label">Клиенты</span>
                <span className="analytics-dash-kpi__value">{fmtQty(dash.active_clients)}</span>
                <span className="analytics-dash-kpi__hint">активные</span>
              </div>
            </article>
          </section>

          <section className="analytics-dash-panel">
            <h2 className="analytics-dash-panel__title">Динамика</h2>
            {movement && movement.data.length > 0 ? (
              <LineChart labels={lineLabels} series={lineSeries} height={260} yLabel="шт." />
            ) : (
              <p className="analytics-dash-panel__empty">Нет операций в периоде</p>
            )}
          </section>

          <section className="analytics-dash-panel">
            <h2 className="analytics-dash-panel__title">Остатки по клиентам</h2>
            {stockBars.length > 0 ? (
              <HorizontalBarChart items={stockBars} barColor="#64748b" />
            ) : (
              <p className="analytics-dash-panel__empty">Нет данных</p>
            )}
          </section>

          <section className="analytics-dash-panel">
            <h2 className="analytics-dash-panel__title">Баланс по клиентам</h2>
            <p className="analytics-dash-panel__subtitle">
              Поступления и отгрузки за период (топ по объёму движений).
            </p>
            {stackedClients.length > 0 ? (
              <StackedHorizontalBarChart
                items={stackedClients}
                inflowColor="#38bdf8"
                outflowColor="#fb923c"
              />
            ) : (
              <p className="analytics-dash-panel__empty">Нет данных</p>
            )}
          </section>

          <div className="analytics-dash-split">
            <section className="analytics-dash-panel analytics-dash-panel--compact">
              <h2 className="analytics-dash-panel__title analytics-dash-panel__title--sm">
                Топ по отгрузкам
              </h2>
              {topByShipment.length > 0 ? (
                <HorizontalBarChart
                  items={topByShipment}
                  barColor="#ea580c"
                  rowHeight={44}
                  labelWidth={228}
                  labelFontSize={15}
                  valueFontSize={14}
                  labelMaxChars={34}
                />
              ) : (
                <p className="analytics-dash-panel__empty">—</p>
              )}
            </section>
            <section className="analytics-dash-panel analytics-dash-panel--compact">
              <h2 className="analytics-dash-panel__title analytics-dash-panel__title--sm">
                Топ по остаткам
              </h2>
              {topByStock.length > 0 ? (
                <HorizontalBarChart
                  items={topByStock}
                  barColor="#475569"
                  rowHeight={44}
                  labelWidth={228}
                  labelFontSize={15}
                  valueFontSize={14}
                  labelMaxChars={34}
                />
              ) : (
                <p className="analytics-dash-panel__empty">—</p>
              )}
            </section>
          </div>
        </>
      ) : null}
    </PageContainer>
  )
}
