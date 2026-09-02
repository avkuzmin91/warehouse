import { useSearchParams } from 'react-router-dom'
import { ShipmentCreateFeature } from '../features/inventory/ShipmentCreateFeature'

export function InventoryShipmentCreatePage() {
  const [searchParams] = useSearchParams()
  const cargoType = searchParams.get('cargo') === 'defect' ? 'defect' : 'good'
  const taskKind = searchParams.get('task') === 'putaway' ? 'putaway' : 'packing'
  return <ShipmentCreateFeature cargoType={cargoType} taskKind={taskKind} />
}
