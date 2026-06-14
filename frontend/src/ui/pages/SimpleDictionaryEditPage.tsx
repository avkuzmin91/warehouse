import { useParams } from 'react-router-dom'
import { SimpleDictionaryEditFeature } from '../features/dictionaries/SimpleDictionaryEditFeature'

interface Props {
  entity: string
}

export function SimpleDictionaryEditPage({ entity }: Props) {
  const { id } = useParams<{ id: string }>()
  if (!id) return null
  return <SimpleDictionaryEditFeature entity={entity} id={id} />
}
