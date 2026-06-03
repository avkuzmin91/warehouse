import { useParams } from 'react-router-dom'
import { TripDetailFeature } from '../features/logistics/TripDetailFeature'

export function LogisticsTripDetailPage() {
  const { tripId } = useParams<{ tripId: string }>()
  if (!tripId) return null
  return <TripDetailFeature tripId={tripId} />
}
