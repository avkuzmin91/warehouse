import { useSearchParams } from 'react-router-dom'
import type { DispatchCargoType } from '../../api/dispatchApi'
import { DispatchCreateFeature } from '../features/inventory/DispatchCreateFeature'

export function InventoryDispatchCreatePage() {
  const [searchParams] = useSearchParams()
  const raw = searchParams.get('cargo')
  const cargoType: DispatchCargoType =
    raw === 'defect' || raw === 'good_unpacked' ? raw : 'good'
  return <DispatchCreateFeature cargoType={cargoType} />
}
