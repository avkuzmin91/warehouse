import { useNavigate } from 'react-router-dom'
import { Badge } from '../primitives/Badge'
import { Card, CardBody, CardHead } from '../primitives/Card'
import { Icon } from '../primitives/Icon'
import { WarehouseMap } from '../widgets/WarehouseMap'
import { MyTasksFeature } from '../features/home/MyTasksFeature'
import { HomeKpiFeature } from '../features/home/HomeKpiFeature'
import { OperationalPlanFeature } from '../features/home/OperationalPlanFeature'
import { PacmanPlaceholder } from '../features/home/PacmanPlaceholder'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { canEditShipments } from '../../utils/access'

function formatDate(): string {
  return new Date().toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    weekday: 'long',
  })
}

const quickActions = [
  { to: '/inventory/receipts/new', icon: 'truckIn' as const, label: 'Принять поступление', sub: 'Создать новый документ' },
  { to: '/inventory/shipments/new', icon: 'truckOut' as const, label: 'Собрать отгрузку', sub: 'По заявке клиента' },
  { to: '/inventory/balances', icon: 'boxes' as const, label: 'Проверить остатки', sub: 'Что и где лежит' },
  { to: '/dictionaries/products/new', icon: 'plus' as const, label: 'Завести товар', sub: 'Новый SKU или вариант' },
]

export function HomePage() {
  const navigate = useNavigate()
  const { user } = useCurrentUser()
  const canEdit = canEditShipments(user)

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Сводка по складу MSK-01</div>
          <div className="page-subtitle">Сегодня · {formatDate()}</div>
        </div>
        {canEdit && (
          <div className="row gap-8">
            <button className="btn primary" onClick={() => navigate('/inventory/receipts/new')}>
              <Icon name="plus" size={14} />
              Новое поступление
            </button>
          </div>
        )}
      </div>

      <HomeKpiFeature />

      <div className="mt-20" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        <div className="col gap-16">
          <OperationalPlanFeature />

          <MyTasksFeature />

          <Card>
            <CardHead>
              <Icon name="map" size={15} style={{ color: 'var(--c-accent)' }} />
              <div className="card-head-title">Карта склада · MSK-01</div>
              <span className="text-xs subtle" style={{ marginLeft: 6 }}>Зоны A-D, 12x8 ячеек</span>
              <div className="right row gap-8">
                <Badge tone="success" dot>1843 ячейки</Badge>
                <Badge tone="warning" dot>14 переполнено</Badge>
                <Badge dot>302 свободно</Badge>
              </div>
            </CardHead>
            <CardBody style={{ paddingTop: 0 }}>
              <WarehouseMap />
            </CardBody>
          </Card>
        </div>

        <div className="col gap-16">
          {canEdit && (
            <Card>
              <CardHead>
                <Icon name="sparkles" size={15} style={{ color: 'var(--c-accent)' }} />
                <div className="card-head-title">Быстрые действия</div>
              </CardHead>
              <CardBody style={{ padding: 8 }}>
                {quickActions.map((action) => (
                  <div
                    key={action.label}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px', borderRadius: 6, cursor: 'pointer' }}
                    onClick={() => navigate(action.to)}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--c-bg-hover)' }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = '' }}
                  >
                    <div style={{ width: 30, height: 30, borderRadius: 6, background: 'var(--c-accent-bg)', color: 'var(--c-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 30px' }}>
                      <Icon name={action.icon} size={15} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{action.label}</div>
                      <div className="text-xs subtle">{action.sub}</div>
                    </div>
                    <Icon name="chev" size={14} style={{ color: 'var(--c-text-faint)' }} />
                  </div>
                ))}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHead>
              <Icon name="clock" size={15} style={{ color: 'var(--c-accent)' }} />
              <div className="card-head-title">Лента событий</div>
            </CardHead>
            <CardBody style={{ padding: 0 }}>
              <PacmanPlaceholder title="Лента событий" sub="Пакмен уже собирает события" />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}
