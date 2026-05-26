import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAnalyticsAdminDashboard } from '../../api/analyticsApi'
import { me } from '../../api/sessionAuth'
import type { AdminDashboardReport } from '../../api/domainTypes'
import { KPI } from '../primitives/KPI'
import { Card, CardHead, CardBody } from '../primitives/Card'
import { Icon } from '../primitives/Icon'
import { Badge } from '../primitives/Badge'
import { Avatar, getInitials } from '../primitives/Avatar'
import { Skeleton } from '../primitives/Skeleton'
import { EmptyState } from '../primitives/EmptyState'
import { WarehouseMapCard } from '../widgets/WarehouseMapCard'
import { ActivityFeedCard } from '../widgets/ActivityFeedCard'

function formatDate(): string {
  return new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' })
}

export function HomePage() {
  const navigate = useNavigate()
  const [report, setReport] = useState<AdminDashboardReport | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.all([me(), getAnalyticsAdminDashboard()]).then(([, r]) => {
      if (!cancelled) { setReport(r); setLoading(false) }
    }).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const kpis = report ? [
    { label: 'Поступило товара', value: report.total_inflow.toLocaleString('ru-RU'), unit: 'шт' },
    { label: 'Отгружено товара', value: report.total_outflow.toLocaleString('ru-RU'), unit: 'шт' },
    { label: 'На складе сейчас', value: report.stock_total.toLocaleString('ru-RU'), unit: 'шт' },
    { label: 'Активных клиентов', value: String(report.active_clients), unit: '' },
  ] : []

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Сводка по складу MSK-01</div>
          <div className="page-subtitle">Сегодня · {formatDate()}</div>
        </div>
        <div className="row gap-8">
          <button className="btn" onClick={() => navigate('/inventory/receipts/import/excel')}>
            <Icon name="upload" size={14} />Импорт Excel
          </button>
          <button className="btn primary" onClick={() => navigate('/inventory/receipts/new')}>
            <Icon name="plus" size={14} />Новое поступление
          </button>
        </div>
      </div>

      {/* KPI grid */}
      <div className="kpi-grid">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="kpi">
                <Skeleton height={12} width="60%" />
                <Skeleton height={30} width="40%" style={{ marginTop: 8 }} />
              </div>
            ))
          : kpis.map((k) => <KPI key={k.label} {...k} />)
        }
      </div>

      <div className="mt-20" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        {/* Left col */}
        <div className="col gap-16">
          {/* Stock by client */}
          <Card>
            <CardHead>
              <Icon name="chart" size={15} style={{ color: 'var(--c-accent)' }} />
              <div className="card-head-title">Остатки по клиентам</div>
              <div className="right">
                <button className="btn sm ghost" onClick={() => navigate('/analytics')}>
                  Аналитика <Icon name="arrowRight" size={12} />
                </button>
              </div>
            </CardHead>
            <div style={{ padding: '4px 0' }}>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} style={{ padding: '10px 14px', borderBottom: '1px solid var(--c-border)' }}>
                    <Skeleton height={14} width="60%" />
                  </div>
                ))
              ) : report?.stock_by_client?.length ? (
                report.stock_by_client.map((c) => {
                  const max = Math.max(...report.stock_by_client.map((x) => x.stock), 1)
                  const pct = Math.round((c.stock / max) * 100)
                  return (
                    <div key={c.client_id} style={{ padding: '10px 14px', borderBottom: '1px solid var(--c-border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                        <Avatar initials={getInitials(c.client)} />
                        <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>{c.client}</span>
                        <span className="mono" style={{ fontSize: 12.5 }}>{c.stock.toLocaleString('ru-RU')} шт</span>
                      </div>
                      <div className="prog">
                        <div className="prog-fill ok" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })
              ) : (
                <EmptyState title="Нет данных" sub="Данные появятся после первых операций" />
              )}
            </div>
          </Card>

          <WarehouseMapCard />
        </div>

        {/* Right col */}
        <div className="col gap-16">
          <Card>
            <CardHead>
              <Icon name="sparkles" size={15} style={{ color: 'var(--c-accent)' }} />
              <div className="card-head-title">Быстрые действия</div>
            </CardHead>
            <CardBody style={{ padding: 8 }}>
              {[
                { to: '/inventory/receipts/new', icon: 'truckIn' as const, label: 'Принять поступление', sub: 'Создать новый документ' },
                { to: '/inventory/shipments/new', icon: 'truckOut' as const, label: 'Собрать отгрузку', sub: 'По заявке клиента' },
                { to: '/inventory/balances', icon: 'boxes' as const, label: 'Проверить остатки', sub: 'Что и где лежит' },
                { to: '/dictionaries/products/new', icon: 'plus' as const, label: 'Завести товар', sub: 'Новый SKU или вариант' },
              ].map((a) => (
                <div
                  key={a.label}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px', borderRadius: 6, cursor: 'pointer' }}
                  onClick={() => navigate(a.to)}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--c-bg-hover)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = '' }}
                >
                  <div style={{ width: 30, height: 30, borderRadius: 6, background: 'var(--c-accent-bg)', color: 'var(--c-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 30px' }}>
                    <Icon name={a.icon} size={15} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{a.label}</div>
                    <div className="text-xs subtle">{a.sub}</div>
                  </div>
                  <Icon name="chev" size={14} style={{ color: 'var(--c-text-faint)' }} />
                </div>
              ))}
            </CardBody>
          </Card>

          {report && (
            <Card>
              <CardHead>
                <Icon name="chart" size={15} style={{ color: 'var(--c-accent)' }} />
                <div className="card-head-title">Движение по клиентам</div>
              </CardHead>
              <div style={{ padding: '4px 0' }}>
                {report.client_movement.slice(0, 5).map((c, i) => (
                  <div key={c.client_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: i < 4 ? '1px solid var(--c-border)' : 0 }}>
                    <Avatar initials={getInitials(c.client)} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.client}</div>
                    </div>
                    <Badge tone="info" dot>+{c.inflow}</Badge>
                    <Badge tone="success" dot>−{c.outflow}</Badge>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <ActivityFeedCard />
        </div>
      </div>
    </div>
  )
}
