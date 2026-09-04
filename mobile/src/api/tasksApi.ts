import { request } from './http'

// --- Types --- (зеркало backend/modules/tasks/schemas.py)
export type TaskItem = {
  kind: string
  title: string
  doc_type: 'trip' | 'receipt' | 'shipment' | 'dispatch' | 'mp_supply' | 'containers'
  doc_id: string
  doc_number: string
  status: string
  role: string
  direction?: string | null
  eta?: string | null
  vehicle_number?: string | null
  since?: string | null
  priority_rank?: number | null
  is_read?: boolean
}
export type TasksResponse = { items: TaskItem[]; total: number; unread: number }
export type TasksParams = { page?: number; limit?: number }

// --- API functions ---
export function getTasks(params: TasksParams = {}, signal?: AbortSignal): Promise<TasksResponse> {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  sp.set('limit', String(params.limit ?? 20))
  return request<TasksResponse>(`/tasks?${sp.toString()}`, { signal })
}

export function markTaskRead(task: Pick<TaskItem, 'kind' | 'doc_id'>): Promise<{ message: string }> {
  return request<{ message: string }>('/tasks/read', {
    method: 'POST',
    body: JSON.stringify({ kind: task.kind, doc_id: task.doc_id }),
  })
}

export function markAllTasksRead(): Promise<{ message: string }> {
  return request<{ message: string }>('/tasks/read-all', { method: 'POST' })
}

// --- Labels & helpers ---
export const TASK_KIND_LABELS: Record<string, string> = {
  trip_arrival: 'Встретить рейс',
  trip_unload: 'Разгрузка рейса',
  shipment_move_in: 'Передать на упаковку',
  shipment_relocate: 'Разложить по местам',
  shipment_defect_prepare: 'Подготовить брак',
  dispatch_prepare: 'Подготовить отгрузку',
}

/** Иконка-эмодзи по типу задачи — крупная визуальная метка для мобильной карточки. */
export function taskGlyph(kind: string): string {
  if (kind.startsWith('trip')) return '🚚'
  if (kind.startsWith('shipment')) return '📦'
  if (kind.startsWith('receipt')) return '📥'
  return '•'
}
