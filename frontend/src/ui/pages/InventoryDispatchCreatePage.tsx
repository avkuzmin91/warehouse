import { useSearchParams } from 'react-router-dom'
import { DispatchCreateFeature } from '../features/inventory/DispatchCreateFeature'

export function InventoryDispatchCreatePage() {
  const [searchParams] = useSearchParams()
  const cargoType = searchParams.get('cargo') === 'defect' ? 'defect' : 'good'
  return <DispatchCreateFeature cargoType={cargoType} />
}
