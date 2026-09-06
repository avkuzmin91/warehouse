import { useParams } from 'react-router-dom'
import { MpSupplyPackStationFeature } from '../features/marketplaces/supplyPack/MpSupplyPackStationFeature'

export function MarketplacesSupplyPackPage() {
  const { supplyId } = useParams<{ supplyId: string }>()
  if (!supplyId) return null
  return <MpSupplyPackStationFeature supplyId={supplyId} />
}
