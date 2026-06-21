import { request } from './http'

// Минимальная форма справочного элемента — нам нужны только id/name (+ активность).
export type Zone = { id: string; name: string; is_active?: boolean; is_deleted?: boolean }

// Доступно складскому составу (shipment_viewer). Возвращает уже активные строки.
export function getUnloadingZones(signal?: AbortSignal): Promise<Zone[]> {
  return request<Zone[]>('/inventory/lookups/unloading-zones', { signal })
}
