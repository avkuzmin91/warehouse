import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  getInventoryCarriers,
  getInventoryClients,
  getInventorySuppliers,
  getInventoryUnloadingZones,
  getInventoryWarehouses,
} from '../api/inventoryLookupsApi'
import type { DictionaryItem } from '../api/domainTypes'
import { LookupsContext } from './lookupsContext'

/**
 * Кэширует справочники inventory на уровне дерева AppLayout.
 * Все *Create/Edit*-страницы используют их через useLookups() — без отдельных fetch'ей.
 *
 * Перезагрузка: reload() из контекста (например, после изменения списка клиентов в админке).
 */
export function LookupsProvider({ children }: { children: ReactNode }) {
  const [clients,        setClients]        = useState<DictionaryItem[]>([])
  const [suppliers,      setSuppliers]      = useState<DictionaryItem[]>([])
  const [carriers,       setCarriers]       = useState<DictionaryItem[]>([])
  const [warehouses,     setWarehouses]     = useState<DictionaryItem[]>([])
  const [unloadingZones, setUnloadingZones] = useState<DictionaryItem[]>([])
  const [loading,        setLoading]        = useState(true)
  const [reloadTick,     setReloadTick]     = useState(0)

  const reload = useCallback(() => setReloadTick((t) => t + 1), [])

  useEffect(() => {
    const ctrl = new AbortController()
    setLoading(true)
    Promise.all([
      getInventoryClients(ctrl.signal).catch(() => [] as DictionaryItem[]),
      getInventorySuppliers(ctrl.signal).catch(() => [] as DictionaryItem[]),
      getInventoryCarriers(ctrl.signal).catch(() => [] as DictionaryItem[]),
      getInventoryWarehouses(ctrl.signal).catch(() => [] as DictionaryItem[]),
      getInventoryUnloadingZones(ctrl.signal).catch(() => [] as DictionaryItem[]),
    ])
      .then(([cl, su, ca, wh, zo]) => {
        if (ctrl.signal.aborted) return
        setClients(cl)
        setSuppliers(su)
        setCarriers(ca)
        setWarehouses(wh)
        setUnloadingZones(zo)
        setLoading(false)
      })
      .catch(() => { if (!ctrl.signal.aborted) setLoading(false) })
    return () => ctrl.abort()
  }, [reloadTick])

  return (
    <LookupsContext.Provider value={{ clients, suppliers, carriers, warehouses, unloadingZones, loading, reload }}>
      {children}
    </LookupsContext.Provider>
  )
}
