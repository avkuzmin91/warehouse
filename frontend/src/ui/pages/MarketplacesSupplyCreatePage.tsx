import { useSearchParams } from 'react-router-dom'
import { MpSupplyCreateFeature } from '../features/marketplaces/supplyCreate/MpSupplyCreateFeature'

export function MarketplacesSupplyCreatePage() {
  const [searchParams] = useSearchParams()
  const accountId = searchParams.get('account') ?? ''
  return <MpSupplyCreateFeature accountId={accountId} />
}
