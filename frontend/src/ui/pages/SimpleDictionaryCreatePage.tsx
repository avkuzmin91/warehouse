import { SimpleDictionaryCreateFeature } from '../features/dictionaries/SimpleDictionaryCreateFeature'

interface Props {
  entity: string
}

export function SimpleDictionaryCreatePage({ entity }: Props) {
  return <SimpleDictionaryCreateFeature entity={entity} />
}
