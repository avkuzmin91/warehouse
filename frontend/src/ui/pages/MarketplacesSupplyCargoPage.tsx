import { useParams } from 'react-router-dom'
import { MpSupplyCargoFeature } from '../features/marketplaces/supplyCargo/MpSupplyCargoFeature'

export function MarketplacesSupplyCargoPage() {
  const { supplyId } = useParams<{ supplyId: string }>()
  if (!supplyId) return null
  return <MpSupplyCargoFeature supplyId={supplyId} />
}
