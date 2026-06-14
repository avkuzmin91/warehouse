import { Icon } from '../../../primitives/Icon'
import { ROLE_META } from './roles'
import type { ProcessRole } from './roles'

export type { ProcessRole } from './roles'

export function RoleChip({ role, faded = false }: { role: ProcessRole; faded?: boolean }) {
  const m = ROLE_META[role]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, height: 20, padding: '0 8px 0 6px',
      borderRadius: 99, fontSize: 11.5, fontWeight: 500, whiteSpace: 'nowrap',
      color: faded ? 'var(--c-text-subtle)' : m.color,
      background: faded ? 'var(--c-bg-sunken)' : m.bg,
    }}>
      <Icon name={m.icon} size={12} />{m.label}
    </span>
  )
}
