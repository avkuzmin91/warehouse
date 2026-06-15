import { createContext } from 'react'
import type { DictionaryItem } from '../api/domainTypes'

export interface LookupsState {
  clients:        DictionaryItem[]
  suppliers:      DictionaryItem[]
  carriers:       DictionaryItem[]
  warehouses:     DictionaryItem[]
  unloadingZones: DictionaryItem[]
  vehicleTypes:   DictionaryItem[]
  positions:      DictionaryItem[]
  /** true пока хотя бы один лукап в процессе первой загрузки. */
  loading:        boolean
  /** Принудительно перечитать все лукапы (например, после правки справочника в админке). */
  reload:         () => void
}

const NOOP = () => {}

export const LookupsContext = createContext<LookupsState>({
  clients:        [],
  suppliers:      [],
  carriers:       [],
  warehouses:     [],
  unloadingZones: [],
  vehicleTypes:   [],
  positions:      [],
  loading:        true,
  reload:         NOOP,
})
