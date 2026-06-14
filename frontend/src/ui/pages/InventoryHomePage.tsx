import { useNavigate } from 'react-router-dom'
import { Icon } from '../primitives/Icon'
import { Card, CardBody } from '../primitives/Card'

export function InventoryHomePage() {
  const navigate = useNavigate()
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Склад</div>
          <div className="page-subtitle">Операции и остатки</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, maxWidth: 800 }}>
        {[
          { to: '/inventory/receipts', icon: 'truckIn' as const, label: 'Поступления', sub: 'Список и приёмка товара' },
          { to: '/inventory/shipments', icon: 'truckOut' as const, label: 'Отгрузки', sub: 'Сборка заказов клиентов' },
          { to: '/inventory/balances', icon: 'boxes' as const, label: 'Остатки', sub: 'Что и где лежит на складе' },
        ].map((item) => (
          <Card key={item.to} style={{ cursor: 'pointer' }}>
            <CardBody>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 14 }}
                onClick={() => navigate(item.to)}
              >
                <div style={{ width: 40, height: 40, borderRadius: 8, background: 'var(--c-accent-bg)', color: 'var(--c-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 40px' }}>
                  <Icon name={item.icon} size={20} />
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{item.label}</div>
                  <div className="text-sm subtle">{item.sub}</div>
                </div>
                <Icon name="chev" size={16} style={{ marginLeft: 'auto', color: 'var(--c-text-faint)' }} />
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  )
}
