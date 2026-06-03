import { useNavigate } from 'react-router-dom'
import { Badge } from '../primitives/Badge'
import { Card, CardBody, CardHead } from '../primitives/Card'
import { Icon, type IconName } from '../primitives/Icon'
import { WarehouseMap } from '../widgets/WarehouseMap'
import { MyTasksFeature } from '../features/home/MyTasksFeature'
import { HomeKpiFeature } from '../features/home/HomeKpiFeature'

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

type ActivityTone = 'accent' | 'success' | 'warning' | ''

type ActivityEvent = {
  icon: IconName
  text: string
  meta: string
  time: string
  tone: ActivityTone
}

const activityEvents: ActivityEvent[] = [
  { icon: 'truckIn', text: 'Принято поступление WH-00042', meta: 'Mango Republic · 488 шт', time: '14:32', tone: 'accent' },
  { icon: 'truckOut', text: 'Отгружено SHP-001207', meta: 'Lukomorye OOO → Ozon Хоругвино', time: '12:30', tone: 'success' },
  { icon: 'alert', text: 'Зафиксирован брак DEF-244', meta: 'MNG-TS-01 · 2 шт · Брак шва', time: '14:48', tone: 'warning' },
  { icon: 'user', text: 'Анна Сорокина изменила роль', meta: 'sergey@pack-men.ru: operator → manager', time: '11:02', tone: '' },
  { icon: 'plus', text: 'Создан размер 44', meta: 'Справочник «Размеры»', time: 'вчера', tone: '' },
]

function activityToneBg(tone: ActivityTone): string {
  if (tone === 'accent') return 'var(--c-accent-bg)'
  if (tone === 'success') return 'var(--c-success-bg)'
  if (tone === 'warning') return 'var(--c-warning-bg)'
  return 'var(--c-bg-sunken)'
}

function activityToneColor(tone: ActivityTone): string {
  if (tone === 'accent') return 'var(--c-accent)'
  if (tone === 'success') return 'var(--c-success)'
  if (tone === 'warning') return 'var(--c-warning)'
  return 'var(--c-text-muted)'
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
            <Icon name="plus" size={14} />
            Новое поступление
          </button>
        </div>
      </div>

      <HomeKpiFeature />

      <div className="mt-20" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
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

          <Card>
            <CardHead>
              <Icon name="clock" size={15} style={{ color: 'var(--c-accent)' }} />
              <div className="card-head-title">Лента событий</div>
            </CardHead>
            <CardBody style={{ padding: '4px 0' }}>
              {activityEvents.map((event, index) => (
                <div
                  key={`${event.text}-${event.time}`}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: '10px 14px',
                    borderBottom: index < activityEvents.length - 1 ? '1px solid var(--c-border)' : undefined,
                  }}
                >
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 6,
                      flex: '0 0 24px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: activityToneBg(event.tone),
                      color: activityToneColor(event.tone),
                    }}
                  >
                    <Icon name={event.icon} size={12} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 450 }}>{event.text}</div>
                    <div className="text-xs subtle">{event.meta}</div>
                  </div>
                  <div className="text-xs faint mono" style={{ flex: '0 0 auto' }}>{event.time}</div>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}
