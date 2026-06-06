import { useParams } from 'react-router-dom'
import { CabinetProductViewFeature } from '../../features/cabinet/CabinetProductViewFeature'

export function CabinetProductViewPage() {
  const { id } = useParams<{ id: string }>()
  if (!id) return null
  return <CabinetProductViewFeature productId={id} />
}
