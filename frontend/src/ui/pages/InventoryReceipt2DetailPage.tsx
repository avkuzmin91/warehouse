import { useParams } from 'react-router-dom'
import { ReceiptDetailFeature } from '../features/inventory/Receipt2DetailFeature'

export function InventoryReceiptDetailPage() {
  const { docId } = useParams<{ docId: string }>()
  return <ReceiptDetailFeature docId={docId!} />
}
