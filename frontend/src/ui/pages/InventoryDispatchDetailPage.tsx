import { useParams } from 'react-router-dom'
import { DispatchDetailFeature } from '../features/inventory/DispatchDetailFeature'

export function InventoryDispatchDetailPage() {
  const { docId } = useParams<{ docId: string }>()
  if (!docId) return null
  return <DispatchDetailFeature docId={docId} />
}
