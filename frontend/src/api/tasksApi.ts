import { request } from './http'

export type TaskKind =
  | 'trip_arrival'
  | 'trip_unload'
  | 'trip_cost'
  | 'receipt_intake'
  | 'receipt_review'
  | 'receipt_close_short'
  | 'shipment_accept'
  | 'shipment_move_in'
  | 'shipment_pack'
  | 'shipment_relocate'
  | 'shipment_defect_prepare'
  | 'dispatch_prepare'

export type TaskItem = {
  kind: TaskKind
  title: string
  doc_type: 'trip' | 'receipt' | 'shipment' | 'dispatch'
  doc_id: string
  doc_number: string
  status: string
  role: string
  direction: 'inbound' | 'outbound' | null
  eta: string | null
  vehicle_number: string | null
  since: string | null
  priority_rank: number | null
  is_read: boolean
}

export type TasksResponse = {
  items: TaskItem[]
  total: number
  unread: number
}

export function getMyTasks(params: { limit?: number } = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.limit) sp.set('limit', String(params.limit))
  const q = sp.toString()
  return request<TasksResponse>(`/tasks${q ? `?${q}` : ''}`, { signal })
}

export function markTaskRead(task: Pick<TaskItem, 'kind' | 'doc_id'>) {
  return request<{ message: string }>('/tasks/read', {
    method: 'POST',
    body: JSON.stringify({ kind: task.kind, doc_id: task.doc_id }),
  })
}

export function markAllTasksRead() {
  return request<{ message: string }>('/tasks/read-all', { method: 'POST' })
}

export function taskLink(task: TaskItem): string {
  if (task.doc_type === 'trip')     return `/logistics/trips/${task.doc_id}`
  if (task.doc_type === 'shipment') return `/inventory/shipments/${task.doc_id}`
  if (task.doc_type === 'dispatch') return `/inventory/dispatches/${task.doc_id}`
  return `/inventory/receipts/${task.doc_id}`
}
