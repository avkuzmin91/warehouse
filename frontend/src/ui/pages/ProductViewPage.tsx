import { useParams } from 'react-router-dom'
import { ProductViewFeature } from '../features/dictionaries/ProductViewFeature'

export function ProductViewPage() {
  const { id } = useParams<{ id: string }>()
  if (!id) return null
  return <ProductViewFeature productId={id} />
}
