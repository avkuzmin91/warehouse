import { useState, useEffect } from 'react'
import {
  getClientPortalDashboardMetrics,
  getClientPortalDashboardDeadStock,
} from '../../../api/clientPortalApi'
import type { ClientPortalDashboardMetrics } from '../../../api/clientPortalApi'
import type { DeadStockReport } from '../../../api/domainTypes'
import { ListPage } from '../../layouts/ListPage'
import { KPI } from '../../primitives/KPI'
import { SkeletonRows } from '../../primitives/Skeleton'

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}
function isoMinusDays(n: number) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

export function CabinetDashboardPage() {
  const [metrics, setMetrics] = useState<ClientPortalDashboardMetrics | null>(null)
  const [deadStock, setDeadStock] = useState<DeadStockReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const df = isoMinusDays(29)
    const dt = todayIso()
    Promise.all([
      getClientPortalDashboardMetrics({ date_from: df, date_to: dt }),
      getClientPortalDashboardDeadStock({ days: 30 }),
    ])
      .then(([m, ds]) => { setMetrics(m); setDeadStock(ds); setLoading(false) })
      .catch((e) => { setError(e instanceof Error ? e.message : 'Ошибка'); setLoading(false) })
  }, [])

  return (
    <ListPage title="Сводка" subtitle="Личный кабинет клиента">
      {loading ? <SkeletonRows rows={4} /> : error ? (
        <div style={{ color: 'var(--c-danger)', fontSize: 13 }}>{error}</div>
      ) : metrics ? (
        <>
          <div className="row gap-16" style={{ flexWrap: 'wrap', marginBottom: 28 }}>
            <KPI label="Остаток на складе" value={String(metrics.total_stock)} />
            <KPI label="Поступлений за 30 дней" value={String(metrics.period_inflow)} deltaDir="up" />
            <KPI label="Отгрузок за 30 дней" value={String(metrics.period_outflow)} deltaDir="down" />
            {deadStock && deadStock.data.length > 0 && (
              <KPI
                label={`Позиций без движения ≥${deadStock.days_threshold} дн.`}
                value={String(deadStock.data.length)}
              />
            )}
          </div>

          {deadStock && deadStock.data.length > 0 && (
            <div className="card" style={{ maxWidth: 800 }}>
              <div className="card-head"><div className="card-head-title">Мёртвые остатки</div></div>
              <div className="card-body" style={{ paddingTop: 0 }}>
                <div className="t-wrap">
                  <table className="t">
                    <thead>
                      <tr>
                        <th className="th">Товар</th>
                        <th className="th">Цвет</th>
                        <th className="th">Размер</th>
                        <th className="th">Остаток</th>
                        <th className="th">Дней без движения</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deadStock.data.slice(0, 10).map((it, i) => (
                        <tr key={i}>
                          <td className="td">{it.product}</td>
                          <td className="td" style={{ fontSize: 12 }}>{it.color ?? '—'}</td>
                          <td className="td" style={{ fontSize: 12 }}>{it.size ?? '—'}</td>
                          <td className="td" style={{ fontWeight: 500 }}>{it.stock}</td>
                          <td className="td" style={{ color: 'var(--c-danger)' }}>{it.days_without_movement}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      ) : null}
    </ListPage>
  )
}
