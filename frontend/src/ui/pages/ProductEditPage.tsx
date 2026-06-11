import { useParams } from 'react-router-dom'
import { ProductEditFeature } from '../features/dictionaries/ProductEditFeature'

export function ProductEditPage() {
  const { id } = useParams<{ id: string }>()
  if (!id) return null
  return <ProductEditFeature id={id} />
}
