import { Badge } from '../primitives/Badge'
import { Card, CardBody, CardHead } from '../primitives/Card'
import { Icon } from '../primitives/Icon'
import { WarehouseMap } from '../widgets/WarehouseMap'
import { MyTasksFeature } from '../features/home/MyTasksFeature'
import { HomeKpiFeature } from '../features/home/HomeKpiFeature'
import { OperationalPlanFeature } from '../features/home/OperationalPlanFeature'
import { PacmanPlaceholder } from '../features/home/PacmanPlaceholder'

function formatDate(): string {
  return new Date().toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    weekday: 'long',
  })
}

export function HomePage() {
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Сводка по складу MSK-01</div>
          <div className="page-subtitle">Сегодня · {formatDate()}</div>
        </div>
      </div>

      <HomeKpiFeature />

      <div className="mt-20" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(320px, 1fr)', gap: 16 }}>
        <div className="col gap-16">
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
          <OperationalPlanFeature />

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
