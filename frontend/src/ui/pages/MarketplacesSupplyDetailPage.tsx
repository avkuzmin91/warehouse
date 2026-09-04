import { useParams } from 'react-router-dom'
import { MpSupplyDetailFeature } from '../features/marketplaces/supplyDetail/MpSupplyDetailFeature'

export function MarketplacesSupplyDetailPage() {
  const { supplyId } = useParams<{ supplyId: string }>()
  if (!supplyId) return null
  return <MpSupplyDetailFeature supplyId={supplyId} />
}
