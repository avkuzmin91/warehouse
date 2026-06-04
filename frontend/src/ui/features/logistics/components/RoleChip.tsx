import { Icon } from '../../../primitives/Icon'
import type { IconName } from '../../../primitives/Icon'

/** Кто владеет шагом рейса. Цвет кодирует роль: менеджер — индиго, кладовщик — синий. */
export type TripRole = 'manager' | 'warehouse'

const ROLE_META: Record<TripRole, { label: string; icon: IconName; color: string; bg: string }> = {
  manager:   { label: 'Менеджер',  icon: 'user',     color: 'var(--c-accent)', bg: 'var(--c-accent-bg)' },
  warehouse: { label: 'Кладовщик', icon: 'forklift', color: 'var(--c-info)',   bg: 'var(--c-info-bg)' },
}

export function RoleChip({ role, faded = false }: { role: TripRole; faded?: boolean }) {
  const m = ROLE_META[role]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, height: 20, padding: '0 8px 0 6px',
      borderRadius: 99, fontSize: 11.5, fontWeight: 500,
      color: faded ? 'var(--c-text-subtle)' : m.color,
      background: faded ? 'var(--c-bg-sunken)' : m.bg,
    }}>
      <Icon name={m.icon} size={12} />{m.label}
    </span>
  )
}
