import { request } from './http'

export type TaskKind =
  | 'trip_arrival'
  | 'trip_unload'
  | 'trip_cost'
  | 'receipt_intake'
  | 'receipt_review'
  | 'shipment_move_in'
  | 'shipment_pack'
  | 'shipment_ship'

export type TaskItem = {
  kind: TaskKind
  title: string
  doc_type: 'trip' | 'receipt' | 'shipment'
  doc_id: string
  doc_number: string
  status: string
  role: string
  direction: 'inbound' | 'outbound' | null
  since: string | null
}

export type TasksResponse = {
  items: TaskItem[]
  total: number
}

export function getMyTasks(params: { limit?: number } = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.limit) sp.set('limit', String(params.limit))
  const q = sp.toString()
  return request<TasksResponse>(`/tasks${q ? `?${q}` : ''}`, { signal })
}

export function taskLink(task: TaskItem): string {
  if (task.doc_type === 'trip')     return `/logistics/trips/${task.doc_id}`
  if (task.doc_type === 'shipment') return `/inventory/shipments/${task.doc_id}`
  return `/inventory/receipts/${task.doc_id}`
}
