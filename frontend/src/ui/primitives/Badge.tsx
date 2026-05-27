import type { CSSProperties, ReactNode } from 'react'

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'accent' | ''

interface BadgeProps {
  tone?: BadgeTone
  dot?: boolean
  children: ReactNode
  style?: CSSProperties
  className?: string
}

export function Badge({ tone = '', dot = false, children, style, className = '' }: BadgeProps) {
  return (
    <span className={`badge ${tone} ${className}`.trim()} style={style}>
      {dot && <span className="dot" />}
      {children}
    </span>
  )
}

export function statusTone(status: string): BadgeTone {
  const map: Record<string, BadgeTone> = {
    draft: '', in_progress: 'info', verified: 'success', done: 'success', cancelled: 'danger',
    packing: 'info', ready: 'accent', shipped: 'success',
    open: 'warning', reported: 'info', returned: 'success',
    pending: '', in: 'info', reviewed: 'success',
  }
  return map[status] ?? ''
}

export const STATUS_LABELS: Record<string, string> = {
  draft: 'Черновик',
  in_progress: 'В работе',
  verified: 'Проверено',
  done: 'Завершено',
  cancelled: 'Аннулирован',
  packing: 'В плане',
  ready: 'На сборке',
  shipped: 'Отгружено',
  open: 'Открыт',
  reported: 'Зафиксирован',
  returned: 'Возвращён',
  pending: 'Ожидает',
  in: 'Получено',
  reviewed: 'Проверено',
}
