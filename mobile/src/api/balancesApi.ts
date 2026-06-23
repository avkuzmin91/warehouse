import { request, requestIdHeaders } from './http'

export type InvOpStatus = 'storage' | 'packing' | 'packed' | 'ready'
export type InvQuality = 'good' | 'defect'

// Остаток по месту хранения: основа экрана «Остатки» (где лежит товар) и выбора
// зоны-источника при передаче на упаковку.
export type ZoneBalance = {
  location_id: string | null
  location_name: string | null
  op_status: InvOpStatus
  quality: InvQuality
  product_id: string
  product_name: string
  product_sku: string
  color_id: string | null
  color_name: string | null
  size_id: string | null
  size_name: string | null
  client_id: string | null
  client_name: string | null
  qty: number
}

export type ZoneBalancesResponse = { items: ZoneBalance[]; truncated: boolean }

// Планируемый к отгрузке остаток (склад + в пути) — источник для выбора позиций
// при создании «Задачи упаковки» / «Отгрузки».
export type PlannableItem = {
  product_id: string
  product_name: string
  product_sku: string
  sku_pending?: boolean
  client_id: string | null
  client_name: string | null
  color_id: string | null
  color_name: string | null
  size_id: string | null
  size_name: string | null
  ready_good: number
  ready_defect: number
  storage_good: number
  storage_defect: number
  in_transit: number
}

export type PlannableParams = { client_id?: string; search?: string; cargo_type?: InvQuality; limit?: number }

export function getPlannableItems(params: PlannableParams = {}, signal?: AbortSignal): Promise<{ items: PlannableItem[] }> {
  const sp = new URLSearchParams()
  if (params.client_id)  sp.set('client_id', params.client_id)
  if (params.search)     sp.set('search', params.search)
  if (params.cargo_type) sp.set('cargo_type', params.cargo_type)
  if (params.limit)      sp.set('limit', String(params.limit))
  const q = sp.toString()
  return request<{ items: PlannableItem[] }>(`/balances/plannable${q ? `?${q}` : ''}`, { signal })
}

export type ZoneBalanceParams = { clientId?: string; search?: string }

// Доступно складскому составу (shipment_viewer). only_positive=true по умолчанию на бэке.
export function getBalancesByZone(
  params: ZoneBalanceParams = {},
  signal?: AbortSignal,
): Promise<ZoneBalancesResponse> {
  const sp = new URLSearchParams()
  if (params.clientId) sp.set('client_id', params.clientId)
  if (params.search) sp.set('search', params.search)
  const q = sp.toString()
  return request<ZoneBalancesResponse>(`/balances/zones${q ? `?${q}` : ''}`, { signal })
}

// Перемещение остатка между местами (оси статуса/качества не меняются). Доступно
// складскому составу — бэк гейтит get_current_manager (включает кладовщика).
export type RelocationPayload = {
  product_id: string
  product_name?: string | null
  product_sku?: string | null
  color_id?: string | null
  color_name?: string | null
  size_id?: string | null
  size_name?: string | null
  client_id?: string | null
  client_name?: string | null
  quality: InvQuality
  from_zone_id: string | null
  to_zone_id: string | null
  qty: number
  comment?: string | null
}

export function createRelocation(payload: RelocationPayload, requestId: string): Promise<{ message: string }> {
  return request<{ message: string }>('/balances/relocations', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: requestIdHeaders(requestId),
  })
}

export const OP_STATUS_LABELS: Record<InvOpStatus, string> = {
  storage: 'На хранении',
  packing: 'На упаковке',
  packed: 'Упакован',
  ready: 'Готов к отгрузке',
}

export const QUALITY_LABELS: Record<InvQuality, string> = {
  good: 'Годный',
  defect: 'Брак',
}
