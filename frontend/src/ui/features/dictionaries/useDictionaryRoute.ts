import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { DICTIONARY_TYPES, type DictionaryTypeId } from './types'

const DEFAULT_TYPE: DictionaryTypeId = 'products'
const VALID_IDS = new Set<string>(DICTIONARY_TYPES.map((d) => d.id))

export function useDictionaryRoute(): [DictionaryTypeId, (id: DictionaryTypeId) => void] {
  const [searchParams, setSearchParams] = useSearchParams()

  const raw = searchParams.get('type') ?? ''
  const active: DictionaryTypeId = VALID_IDS.has(raw) ? (raw as DictionaryTypeId) : DEFAULT_TYPE

  const setActive = useCallback(
    (id: DictionaryTypeId) => {
      setSearchParams({ type: id }, { replace: true })
    },
    [setSearchParams],
  )

  return [active, setActive]
}
