import { useParams } from 'react-router-dom'
import { CabinetReceiptDetailFeature } from '../../features/cabinet/CabinetReceiptDetailFeature'

export function CabinetReceiptDetailPage() {
  const { docId } = useParams<{ docId: string }>()
  if (!docId) return null
  return <CabinetReceiptDetailFeature docId={docId} />
}
