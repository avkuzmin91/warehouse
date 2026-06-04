import { useSearchParams } from 'react-router-dom'
import { TripCreateFeature } from '../features/logistics/TripCreateFeature'
import type { TripDirection } from '../../api/tripsApi'

export function LogisticsTripCreatePage() {
  const [params] = useSearchParams()
  const direction: TripDirection = params.get('dir') === 'outbound' ? 'outbound' : 'inbound'
  return <TripCreateFeature direction={direction} />
}
