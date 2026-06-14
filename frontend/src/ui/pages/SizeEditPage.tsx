import { useParams } from 'react-router-dom'
import { SizeEditFeature } from '../features/dictionaries/SizeEditFeature'

export function SizeEditPage() {
  const { id } = useParams<{ id: string }>()
  if (!id) return null
  return <SizeEditFeature id={id} />
}
