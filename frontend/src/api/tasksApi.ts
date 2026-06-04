import { request } from './http'

export type TaskKind =
  | 'trip_arrival'
  | 'trip_unload'
  | 'trip_cost'
  | 'receipt_intake'
  | 'receipt_review'

export type TaskItem = {
  kind: TaskKind
  title: string
  doc_type: 'trip' | 'receipt'
  doc_id: string
  doc_number: string
  status: string
  role: string
  since: string | null
}

export type TasksResponse = {
  items: TaskItem[]
  total: number
}

export function getMyTasks(signal?: AbortSignal) {
  return request<TasksResponse>('/tasks', { signal })
}

export function taskLink(task: TaskItem): string {
  return task.doc_type === 'trip'
    ? `/logistics/trips/${task.doc_id}`
    : `/inventory/receipts/${task.doc_id}`
}
