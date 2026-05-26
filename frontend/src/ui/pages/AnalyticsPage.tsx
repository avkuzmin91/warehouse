import { useState, useEffect } from 'react'
import { getAnalyticsAdminDashboard } from '../../api/adminApi'
import type { AdminDashboardReport } from '../../api/domainTypes'
import { ListPage } from '../layouts/ListPage'
import { KPI } from '../primitives/KPI'
import { Skeleton, SkeletonRows } from '../primitives/Skeleton'

function fmt(n: number): string {
  return n.toLocaleString('ru-RU')
}

export function AnalyticsPage() {
  const [report, setReport] = useState<AdminDashboardReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    getAnalyticsAdminDashboard({ movement_clients_limit: 10 })
      .then((r) => { setReport(r); setLoading(false) })
      .catch((e) => { setError(e instanceof Error ? e.message : 'Ошибка'); setLoading(false) })
  }, [])

  if (loading) {
    return (
      <ListPage title="Аналитика">
        <div className="row gap-16" style={{ flexWrap: 'wrap', marginBottom: 24 }}>
          {[1,2,3,4].map((k) => <Skeleton key={k} height={88} width={180} />)}
        </div>
        <SkeletonRows rows={6} />
      </ListPage>
    )
  }

  if (error) {
    return (
      <ListPage title="Аналитика">
        <div style={{ color: 'var(--c-danger)', fontSize: 13 }}>{error}</div>
      </ListPage>
    )
  }

  if (!report) return null

  const stockMax = Math.max(...report.stock_by_client.map((c) => c.stock), 1)

  return (
    <ListPage title="Аналитика" subtitle={`Период: ${report.period.date_from} — ${report.period.date_to}`}>
      <div className="row gap-16" style={{ flexWrap: 'wrap', marginBottom: 28 }}>
        <KPI label="Товаров на складе" value={fmt(report.stock_total)} />
        <KPI label="Поступлений" value={fmt(report.total_inflow)} />
        <KPI label="Отгрузок" value={fmt(report.total_outflow)} />
        <KPI label="Активных клиентов" value={fmt(report.active_clients)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start', maxWidth: 1000 }}>
        <div className="card">
          <div className="card-head"><div className="card-head-title">Остатки по клиентам</div></div>
          <div className="card-body" style={{ paddingTop: 8 }}>
            {report.stock_by_client.length === 0 && (
              <div style={{ color: 'var(--c-text-subtle)', fontSize: 13 }}>Нет данных</div>
            )}
            {report.stock_by_client.map((c) => (
              <div key={c.client_id} style={{ marginBottom: 10 }}>
                <div className="row gap-8" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 13 }}>{c.client}</span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{fmt(c.stock)}</span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: 'var(--c-border)', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    borderRadius: 3,
                    background: 'var(--c-accent)',
                    width: `${Math.round((c.stock / stockMax) * 100)}%`,
                    transition: 'width 400ms',
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><div className="card-head-title">Движение по клиентам</div></div>
          <div className="card-body" style={{ paddingTop: 0 }}>
            {report.client_movement.length === 0 && (
              <div style={{ color: 'var(--c-text-subtle)', fontSize: 13 }}>Нет данных</div>
            )}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '8px 0 4px', color: 'var(--c-text-subtle)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Клиент</th>
                  <th style={{ textAlign: 'right', padding: '8px 0 4px', color: 'var(--c-text-subtle)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Прих.</th>
                  <th style={{ textAlign: 'right', padding: '8px 0 4px', color: 'var(--c-text-subtle)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Отгр.</th>
                </tr>
              </thead>
              <tbody>
                {report.client_movement.map((c) => (
                  <tr key={c.client_id} style={{ borderTop: '1px solid var(--c-border)' }}>
                    <td style={{ padding: '7px 0' }}>{c.client}</td>
                    <td style={{ padding: '7px 0', textAlign: 'right', color: 'var(--c-success)', fontWeight: 500 }}>+{fmt(c.inflow)}</td>
                    <td style={{ padding: '7px 0', textAlign: 'right', color: 'var(--c-danger)', fontWeight: 500 }}>−{fmt(c.outflow)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {report.explanation && (
        <div style={{ marginTop: 20, padding: '12px 16px', background: 'var(--c-surface-2, var(--c-surface))', borderRadius: 8, fontSize: 12.5, color: 'var(--c-text-subtle)', maxWidth: 700 }}>
          {report.explanation}
        </div>
      )}
    </ListPage>
  )
}
