import { useParams } from 'react-router-dom'
import { CabinetShipmentDetailFeature } from '../../features/cabinet/CabinetShipmentDetailFeature'

export function CabinetShipmentDetailPage() {
  const { docId } = useParams<{ docId: string }>()
  if (!docId) return null
  return <CabinetShipmentDetailFeature docId={docId} />
}
