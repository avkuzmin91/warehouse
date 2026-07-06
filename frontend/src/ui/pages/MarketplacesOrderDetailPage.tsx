import { useParams } from 'react-router-dom'
import { MpOrderDetailFeature } from '../features/marketplaces/MpOrderDetailFeature'

export function MarketplacesOrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>()
  if (!orderId) return null
  return <MpOrderDetailFeature orderId={orderId} />
}
