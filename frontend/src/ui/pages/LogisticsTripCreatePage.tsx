import { useSearchParams } from 'react-router-dom'
import { TripCreateFeature } from '../features/logistics/TripCreateFeature'
import type { TripDirection, TripCargoType } from '../../api/tripsApi'

export function LogisticsTripCreatePage() {
  const [params] = useSearchParams()
  const direction: TripDirection = params.get('dir') === 'outbound' ? 'outbound' : 'inbound'
  const cargoType: TripCargoType = params.get('cargo') === 'defect' ? 'defect' : 'good'
  return <TripCreateFeature direction={direction} cargoType={cargoType} />
}
