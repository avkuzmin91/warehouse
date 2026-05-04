import { useEffect, useMemo, useState } from 'react'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { PageContainer } from '../components/PageContainer'
import { BarChart, LineChart } from '../components/MiniCharts'
import {
  type AnalyticsCommonParams,
  type AnalyticsGroup,
  type BalanceReport,
  type ByTypeReport,
  type ClientActivityReport,
  type DeadStockReport,
  type DictionaryItem,
  type InventoryProductLookup,
  type InventoryProductTypeLookup,
  type MovementReport,
  type StockSnapshotReport,
  type TopProductsReport,
  getAnalyticsBalance,
  getAnalyticsByType,
  getAnalyticsClientActivity,
  getAnalyticsDeadStock,
  getAnalyticsMovement,
  getAnalyticsStockSnapshot,
  getAnalyticsTopProducts,
  getInventoryClients,
  getInventoryProductTypes,
  getInventoryProducts,
} from '../api'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}
function isoMinusDays(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

function fmtPct(value: number | null): string {
  if (value == null) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value}%`
}

function pctTone(value: number | null, positiveIsGood: boolean): string {
  if (value == null || value === 0) return ''
  if (value > 0) return positiveIsGood ? 'qty-positive' : 'qty-zero'
  return positiveIsGood ? 'qty-zero' : 'qty-positive'
}

type Filters = {
  date_from: string
  date_to: string
  client_id: string
  type_id: string
  product_id: string
  group: AnalyticsGroup
  dead_days: number
  top_n: number
}

const DEFAULT_FILTERS: Filters = {
  date_from: isoMinusDays(29),
  date_to: todayIso(),
  client_id: '',
  type_id: '',
  product_id: '',
  group: 'day',
  dead_days: 30,
  top_n: 10,
}

export function AnalyticsPage() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [draftFilters, setDraftFilters] = useState<Filters>(DEFAULT_FILTERS)

  const [clients, setClients] = useState<DictionaryItem[]>([])
  const [types, setTypes] = useState<InventoryProductTypeLookup[]>([])
  const [products, setProducts] = useState<InventoryProductLookup[]>([])

  const [movement, setMovement] = useState<MovementReport | null>(null)
  const [snapshot, setSnapshot] = useState<StockSnapshotReport | null>(null)
  const [top, setTop] = useState<TopProductsReport | null>(null)
  const [dead, setDead] = useState<DeadStockReport | null>(null)
  const [activity, setActivity] = useState<ClientActivityReport | null>(null)
  const [balance, setBalance] = useState<BalanceReport | null>(null)
  const [byType, setByType] = useState<ByTypeReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    Promise.all([getInventoryClients(), getInventoryProductTypes()])
      .then(([cs, ts]) => {
        if (cancelled) return
        setClients(cs)
        setTypes(ts)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    getInventoryProducts(filters.client_id || null)
      .then((rows) => {
        if (!cancelled) setProducts(rows)
      })
      .catch(() => {
        if (!cancelled) setProducts([])
      })
    return () => {
      cancelled = true
    }
  }, [filters.client_id])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    const common: AnalyticsCommonParams = {
      date_from: filters.date_from || undefined,
      date_to: filters.date_to || undefined,
      client_id: filters.client_id || undefined,
      type_id: filters.type_id || undefined,
      product_id: filters.product_id || undefined,
    }
    Promise.all([
      getAnalyticsMovement({ ...common, group: filters.group }),
      getAnalyticsStockSnapshot({
        client_id: filters.client_id || undefined,
        type_id: filters.type_id || undefined,
        product_id: filters.product_id || undefined,
        at_date: filters.date_to || undefined,
        only_positive: true,
        limit: 200,
      }),
      getAnalyticsTopProducts({ ...common, limit: filters.top_n }),
      getAnalyticsDeadStock({
        days: filters.dead_days,
        client_id: filters.client_id || undefined,
        type_id: filters.type_id || undefined,
        limit: 200,
      }),
      getAnalyticsClientActivity({ ...common, limit: 20 }),
      getAnalyticsBalance(common),
      getAnalyticsByType({
        date_from: common.date_from,
        date_to: common.date_to,
        client_id: common.client_id,
      }),
    ])
      .then(([mv, sn, tp, dd, ac, bl, bt]) => {
        if (cancelled) return
        setMovement(mv)
        setSnapshot(sn)
        setTop(tp)
        setDead(dd)
        setActivity(ac)
        setBalance(bl)
        setByType(bt)
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
  }, [filters])

  const lineLabels = useMemo(
    () => (movement?.data ?? []).map((b) => b.period),
    [movement],
  )
  const lineSeries = useMemo(
    () => [
      {
        name: 'Приход',
        color: '#4ade80',
        values: (movement?.data ?? []).map((b) => b.inflow),
      },
      {
        name: 'Расход',
        color: '#ff6b8a',
        values: (movement?.data ?? []).map((b) => b.outflow),
      },
    ],
    [movement],
  )

  return (
    <PageContainer maxWidth={1280} cardClassName="users-card analytics-card">
      <Breadcrumbs />

      <h2 className="auth-card__subtitle" style={{ marginBottom: 12 }}>
        Аналитика по складу
      </h2>

      {/* ===== Фильтры ===== */}
      <div className="analytics-filters">
        <div className="analytics-filters__row">
          <label className="analytics-filters__field">
            <span>С</span>
            <input
              type="date"
              className="field-input"
              value={draftFilters.date_from}
              max={draftFilters.date_to || undefined}
              onChange={(e) =>
                setDraftFilters((f) => ({ ...f, date_from: e.target.value }))
              }
            />
          </label>
          <label className="analytics-filters__field">
            <span>По</span>
            <input
              type="date"
              className="field-input"
              value={draftFilters.date_to}
              min={draftFilters.date_from || undefined}
              onChange={(e) =>
                setDraftFilters((f) => ({ ...f, date_to: e.target.value }))
              }
            />
          </label>
          <label className="analytics-filters__field">
            <span>Группировка</span>
            <select
              className="field-input"
              value={draftFilters.group}
              onChange={(e) =>
                setDraftFilters((f) => ({
                  ...f,
                  group: e.target.value as AnalyticsGroup,
                }))
              }
            >
              <option value="day">По дням</option>
              <option value="week">По неделям</option>
              <option value="month">По месяцам</option>
            </select>
          </label>
          <label className="analytics-filters__field">
            <span>Клиент</span>
            <select
              className="field-input"
              value={draftFilters.client_id}
              onChange={(e) =>
                setDraftFilters((f) => ({
                  ...f,
                  client_id: e.target.value,
                  product_id: '',
                }))
              }
            >
              <option value="">Все</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="analytics-filters__field">
            <span>Тип товара</span>
            <select
              className="field-input"
              value={draftFilters.type_id}
              onChange={(e) =>
                setDraftFilters((f) => ({ ...f, type_id: e.target.value }))
              }
            >
              <option value="">Все</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="analytics-filters__field">
            <span>Товар</span>
            <select
              className="field-input"
              value={draftFilters.product_id}
              onChange={(e) =>
                setDraftFilters((f) => ({ ...f, product_id: e.target.value }))
              }
              disabled={!draftFilters.client_id}
            >
              <option value="">{draftFilters.client_id ? 'Все' : 'Выберите клиента'}</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="analytics-filters__field analytics-filters__field--sm">
            <span>TOP N</span>
            <input
              type="number"
              min={1}
              max={50}
              className="field-input"
              value={draftFilters.top_n}
              onChange={(e) =>
                setDraftFilters((f) => ({
                  ...f,
                  top_n: Math.max(1, Math.min(50, Number(e.target.value) || 10)),
                }))
              }
            />
          </label>
          <label className="analytics-filters__field analytics-filters__field--sm">
            <span>«Мёртвые», дн.</span>
            <input
              type="number"
              min={1}
              max={365}
              className="field-input"
              value={draftFilters.dead_days}
              onChange={(e) =>
                setDraftFilters((f) => ({
                  ...f,
                  dead_days: Math.max(1, Math.min(365, Number(e.target.value) || 30)),
                }))
              }
            />
          </label>
          <div className="analytics-filters__actions">
            <button
              type="button"
              className="btn btn--primary analytics-filters__btn"
              onClick={() => setFilters(draftFilters)}
              disabled={loading}
            >
              Применить
            </button>
            <button
              type="button"
              className="btn btn--secondary analytics-filters__btn"
              onClick={() => {
                setDraftFilters(DEFAULT_FILTERS)
                setFilters(DEFAULT_FILTERS)
              }}
              disabled={loading}
            >
              Сбросить
            </button>
          </div>
        </div>
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {loading ? <p className="auth-card__subtitle">Загрузка...</p> : null}

      {/* ===== KPI: Баланс ===== */}
      {balance ? (
        <section className="analytics-section">
          <h3 className="analytics-section__title">Баланс за период</h3>
          <p className="analytics-section__hint">{balance.explanation}</p>
          <div className="analytics-kpi">
            <KpiCard
              label="Приход"
              value={balance.inflow}
              prev={balance.prev_inflow}
              changePct={balance.inflow_change_pct}
              positiveIsGood
            />
            <KpiCard
              label="Расход"
              value={balance.outflow}
              prev={balance.prev_outflow}
              changePct={balance.outflow_change_pct}
              positiveIsGood={false}
            />
            <KpiCard
              label="Дельта"
              value={balance.delta}
              prev={balance.prev_delta}
              trend={balance.delta_trend}
            />
          </div>
        </section>
      ) : null}

      {/* ===== Движение товаров (line) ===== */}
      {movement ? (
        <section className="analytics-section">
          <h3 className="analytics-section__title">Движение товаров</h3>
          <p className="analytics-section__hint">{movement.explanation}</p>
          {movement.data.length === 0 ? (
            <p className="auth-card__subtitle">Нет данных за период</p>
          ) : (
            <LineChart labels={lineLabels} series={lineSeries} />
          )}
        </section>
      ) : null}

      {/* ===== ТОП товаров (bar) ===== */}
      {top ? (
        <section className="analytics-section">
          <h3 className="analytics-section__title">ТОП товаров по отгрузке</h3>
          <p className="analytics-section__hint">{top.explanation}</p>
          {top.data.length === 0 ? (
            <p className="auth-card__subtitle">Нет отгрузок за период</p>
          ) : (
            <>
              <BarChart
                data={top.data.map((t) => ({ label: t.product, value: t.total_outflow }))}
              />
              <div className="analytics-table-wrap">
                <table className="analytics-table">
                  <thead>
                    <tr>
                      <th>Товар</th>
                      <th>Тип</th>
                      <th className="num">Отгружено</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top.data.map((it) => (
                      <tr key={it.product_id}>
                        <td>{it.product}</td>
                        <td>{it.type_name || '—'}</td>
                        <td className="num">{it.total_outflow}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      ) : null}

      {/* ===== Активность клиентов (bar) ===== */}
      {activity ? (
        <section className="analytics-section">
          <h3 className="analytics-section__title">Активность клиентов</h3>
          <p className="analytics-section__hint">{activity.explanation}</p>
          {activity.data.length === 0 ? (
            <p className="auth-card__subtitle">Нет данных за период</p>
          ) : (
            <BarChart
              color="#aa7cff"
              data={activity.data.map((c) => ({ label: c.client, value: c.total_outflow }))}
            />
          )}
        </section>
      ) : null}

      {/* ===== Разрез по типам (bar + table) ===== */}
      {byType ? (
        <section className="analytics-section">
          <h3 className="analytics-section__title">Разрез по типам товаров</h3>
          <p className="analytics-section__hint">{byType.explanation}</p>
          {byType.data.length === 0 ? (
            <p className="auth-card__subtitle">Нет данных за период</p>
          ) : (
            <div className="analytics-table-wrap">
              <table className="analytics-table">
                <thead>
                  <tr>
                    <th>Тип</th>
                    <th className="num">Остаток</th>
                    <th className="num">Приход</th>
                    <th className="num">Расход</th>
                  </tr>
                </thead>
                <tbody>
                  {byType.data.map((it) => (
                    <tr key={it.type_id ?? '—'}>
                      <td>{it.type_name}</td>
                      <td className="num">{it.stock}</td>
                      <td className="num">{it.inflow}</td>
                      <td className="num">{it.outflow}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {/* ===== Снапшот остатков ===== */}
      {snapshot ? (
        <section className="analytics-section">
          <h3 className="analytics-section__title">
            Срез остатков на {snapshot.at_date}
          </h3>
          <p className="analytics-section__hint">{snapshot.explanation}</p>
          {snapshot.data.length === 0 ? (
            <p className="auth-card__subtitle">Нет позиций с положительным остатком</p>
          ) : (
            <div className="analytics-table-wrap">
              <table className="analytics-table">
                <thead>
                  <tr>
                    <th>Товар</th>
                    <th>Тип</th>
                    <th>Клиент</th>
                    <th>Цвет</th>
                    <th>Размер</th>
                    <th className="num">Остаток</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.data.map((it, i) => (
                    <tr key={`${it.product_id}-${it.color_id ?? ''}-${it.size_id ?? ''}-${i}`}>
                      <td>{it.product}</td>
                      <td>{it.type_name || '—'}</td>
                      <td>{it.client || '—'}</td>
                      <td>{it.color || '—'}</td>
                      <td>{it.size || '—'}</td>
                      <td className="num qty-positive">{it.stock}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {/* ===== Мёртвые остатки ===== */}
      {dead ? (
        <section className="analytics-section">
          <h3 className="analytics-section__title">Мёртвые остатки</h3>
          <p className="analytics-section__hint">{dead.explanation}</p>
          {dead.data.length === 0 ? (
            <p className="auth-card__subtitle">
              Нет товаров без движения ≥ {dead.days_threshold} дней
            </p>
          ) : (
            <div className="analytics-table-wrap">
              <table className="analytics-table">
                <thead>
                  <tr>
                    <th>Товар</th>
                    <th>Клиент</th>
                    <th>Цвет</th>
                    <th>Размер</th>
                    <th className="num">Остаток</th>
                    <th className="num">Дней без движения</th>
                  </tr>
                </thead>
                <tbody>
                  {dead.data.map((it, i) => (
                    <tr key={`${it.product_id}-${it.color_id ?? ''}-${it.size_id ?? ''}-${i}`}>
                      <td>{it.product}</td>
                      <td>{it.client || '—'}</td>
                      <td>{it.color || '—'}</td>
                      <td>{it.size || '—'}</td>
                      <td className="num">{it.stock}</td>
                      <td className="num qty-zero">{it.days_without_movement}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </PageContainer>
  )

  function KpiCard({
    label,
    value,
    prev,
    changePct,
    trend,
    positiveIsGood = true,
  }: {
    label: string
    value: number
    prev: number
    changePct?: number | null
    trend?: 'up' | 'down' | 'flat'
    positiveIsGood?: boolean
  }) {
    const tone = pctTone(changePct ?? null, positiveIsGood)
    let trendIcon = ''
    if (trend === 'up') trendIcon = '▲'
    else if (trend === 'down') trendIcon = '▼'
    return (
      <div className="analytics-kpi__card">
        <div className="analytics-kpi__label">{label}</div>
        <div className="analytics-kpi__value">{value}</div>
        <div className={`analytics-kpi__delta ${tone}`}>
          {changePct != null ? <>vs {prev} ({fmtPct(changePct)})</> : <>vs {prev}</>}
          {trendIcon ? <span style={{ marginLeft: 6 }}>{trendIcon}</span> : null}
        </div>
      </div>
    )
  }
}
