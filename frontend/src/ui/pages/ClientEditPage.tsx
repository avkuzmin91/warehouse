import { useParams } from 'react-router-dom'
import { ClientEditFeature } from '../features/dictionaries/ClientEditFeature'

export function ClientEditPage() {
  const { id } = useParams<{ id: string }>()
  if (!id) return null
  return <ClientEditFeature id={id} />
}
