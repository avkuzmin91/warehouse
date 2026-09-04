import { useParams } from 'react-router-dom'
import { BoxDetailFeature } from '../features/inventory/BoxDetailFeature'

export function InventoryBoxDetailPage() {
  const { boxId } = useParams<{ boxId: string }>()
  if (!boxId) return null
  return <BoxDetailFeature boxId={boxId} />
}
