import type { IconName } from '../../../primitives/Icon'

/** Кто владеет шагом процесса. Цвет кодирует роль:
 *  менеджер — индиго · кладовщик — синий · нач. смены — янтарный. */
export type ProcessRole = 'manager' | 'warehouse' | 'shift_lead'

export const ROLE_META: Record<ProcessRole, { label: string; icon: IconName; color: string; bg: string }> = {
  manager:    { label: 'Менеджер',   icon: 'user',      color: 'var(--c-accent)',  bg: 'var(--c-accent-bg)' },
  warehouse:  { label: 'Кладовщик',  icon: 'forklift',  color: 'var(--c-info)',    bg: 'var(--c-info-bg)' },
  shift_lead: { label: 'Нач. смены', icon: 'userCheck', color: 'var(--c-warning)', bg: 'var(--c-warning-bg)' },
}

export function roleAccent(role?: ProcessRole | null): string {
  return role ? ROLE_META[role].color : 'var(--c-accent)'
}
