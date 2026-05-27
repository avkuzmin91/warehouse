import { useNavigate } from 'react-router-dom'
import { KPI } from '../primitives/KPI'
import { Card, CardBody, CardHead } from '../primitives/Card'
import { Icon } from '../primitives/Icon'
import { EmptyState } from '../primitives/EmptyState'
import { WarehouseMapCard } from '../widgets/WarehouseMapCard'
import { ActivityFeedCard } from '../widgets/ActivityFeedCard'

function formatDate(): string {
  return new Date().toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    weekday: 'long',
  })
}

export function HomePage() {
  const navigate = useNavigate()

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Сводка по складу MSK-01</div>
          <div className="page-subtitle">Сегодня · {formatDate()}</div>
        </div>
        <div className="row gap-8">
          <button className="btn primary" onClick={() => navigate('/inventory/receipts/new')}>
            <Icon name="plus" size={14} />Новое поступление
          </button>
        </div>
      </div>

      <div className="kpi-grid">
        <KPI label="Поступления" value="Отключено" />
        <KPI label="Отгрузки" value="Отключено" />
        <KPI label="Остатки" value="См. раздел" />
        <KPI label="Аналитика" value="Отключена" />
      </div>

      <div className="mt-20" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        <div className="col gap-16">
          <Card>
            <CardHead>
              <Icon name="chart" size={15} style={{ color: 'var(--c-accent)' }} />
              <div className="card-head-title">Аналитика отключена</div>
            </CardHead>
            <CardBody>
              <EmptyState
                title="Сводные графики недоступны"
                sub="Раздел аналитики отключен. Для работы используйте поступления, отгрузки и текущие остатки."
              />
            </CardBody>
          </Card>

          <WarehouseMapCard />
        </div>

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

          <ActivityFeedCard />
        </div>
      </div>
    </div>
  )
}
