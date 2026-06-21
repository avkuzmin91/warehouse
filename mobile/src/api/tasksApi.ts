import { request } from './http'

// --- Types --- (зеркало backend/modules/tasks/schemas.py)
export type TaskItem = {
  kind: string
  title: string
  doc_type: 'trip' | 'receipt' | 'shipment'
  doc_id: string
  doc_number: string
  status: string
  role: string
  direction?: string | null
  eta?: string | null
  vehicle_number?: string | null
  since?: string | null
  priority_rank?: number | null
}
export type TasksResponse = { items: TaskItem[]; total: number }

// --- API functions ---
export function getTasks(limit = 20, signal?: AbortSignal): Promise<TasksResponse> {
  const sp = new URLSearchParams()
  sp.set('limit', String(limit))
  return request<TasksResponse>(`/tasks?${sp.toString()}`, { signal })
}

// --- Labels & helpers ---
export const TASK_KIND_LABELS: Record<string, string> = {
  trip_arrival: 'Встретить рейс',
  trip_unload: 'Разгрузка рейса',
  shipment_move_in: 'Передать на упаковку',
  shipment_relocate: 'Разложить по местам',
  shipment_defect_prepare: 'Подготовить брак',
}

/** Иконка-эмодзи по типу задачи — крупная визуальная метка для мобильной карточки. */
export function taskGlyph(kind: string): string {
  if (kind.startsWith('trip')) return '🚚'
  if (kind.startsWith('shipment')) return '📦'
  if (kind.startsWith('receipt')) return '📥'
  return '•'
}
