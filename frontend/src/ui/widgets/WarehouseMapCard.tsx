import { Icon } from '../primitives/Icon'
import { Badge } from '../primitives/Badge'
import { WarehouseMap } from './WarehouseMap'

// TODO: считать из реальных данных
const TOTAL_CELLS = 1843
const OVERFLOW_CELLS = 14
const EMPTY_CELLS = 302

export function WarehouseMapCard() {
  return (
    <div className="card">
      <div className="card-head">
        <Icon name="map" size={15} style={{ color: 'var(--c-accent)' }} />
        <div className="card-head-title">Карта склада · MSK-01</div>
        <span className="text-xs subtle" style={{ marginLeft: 6 }}>Зоны A–D, 12×8 ячеек</span>
        <div className="right row gap-8">
          <Badge tone="success" dot>{TOTAL_CELLS} ячеек</Badge>
          <Badge tone="warning" dot>{OVERFLOW_CELLS} переполнено</Badge>
          <Badge dot>{EMPTY_CELLS} свободно</Badge>
        </div>
      </div>
      <div className="card-body" style={{ paddingTop: 0 }}>
        <WarehouseMap />
      </div>
    </div>
  )
}
