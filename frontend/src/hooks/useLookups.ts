import { useContext } from 'react'
import { LookupsContext, type LookupsState } from './lookupsContext'

/**
 * Доступ к кешированным справочникам (clients, suppliers, carriers, warehouses, unloadingZones).
 * Провайдер монтируется в AppLayout — все защищённые страницы получают данные без повторных fetch'ей.
 */
export function useLookups(): LookupsState {
  return useContext(LookupsContext)
}
