import { useEffect, useMemo, useState } from 'react'
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

export function ClientCabinetDashboardPage() {
  const [dateFrom, setDateFrom] = useState(isoMinusDays(29))
  const [dateTo, setDateTo] = useState(todayIso())
  const [group, setGroup] = useState<AnalyticsGroup>('day')
  const [metrics, setMetrics] = useState<ClientPortalDashboardMetrics | null>(null)
  const [movement, setMovement] = useState<MovementReport | null>(null)
  const [top, setTop] = useState<TopProductsReport | null>(null)
  const [deadStock, setDeadStock] = useState<DeadStockReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    Promise.all([
      getClientPortalDashboardMetrics({ date_from: dateFrom, date_to: dateTo }),
      getClientPortalDashboardMovement({
        date_from: dateFrom,
        date_to: dateTo,
        group,
      }),
      getClientPortalDashboardTopProducts({
        date_from: dateFrom,
        date_to: dateTo,
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
  }, [dateFrom, dateTo, group])

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

  return (
    <div className="cabinet-dashboard">
      <h1 className="cabinet-dashboard__title">Сводка</h1>

      <div className="cabinet-dashboard__toolbar">
        <label className="cabinet-dashboard__field">
          <span className="cabinet-dashboard__label">С</span>
          <input
            type="date"
            className="cabinet-dashboard__input"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </label>
        <label className="cabinet-dashboard__field">
          <span className="cabinet-dashboard__label">По</span>
          <input
            type="date"
            className="cabinet-dashboard__input"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </label>
        <label className="cabinet-dashboard__field">
          <span className="cabinet-dashboard__label">Группировка</span>
          <select
            className="cabinet-dashboard__input"
            value={group}
            onChange={(e) => setGroup(e.target.value as AnalyticsGroup)}
          >
            <option value="day">По дням</option>
            <option value="week">По неделям</option>
            <option value="month">По месяцам</option>
          </select>
        </label>
      </div>

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
