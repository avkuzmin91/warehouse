import { useParams } from 'react-router-dom'
import { ReceiptDetailFeature } from '../features/inventory/ReceiptDetailFeature'

export function InventoryReceiptDetailPage() {
  const { docId } = useParams<{ docId: string }>()
  return <ReceiptDetailFeature docId={docId!} />
}
