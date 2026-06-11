import type { ReactNode } from 'react'
import { Icon } from '../../../primitives/Icon'
import type { IconName } from '../../../primitives/Icon'
import { RoleChip } from './RoleChip'
import { roleAccent } from './roles'
import type { ProcessRole } from './roles'

/** Фазовый блок формы процесса: шапка (иконка, заголовок, роль, состояние) + тело.
 *  active — заполняется сейчас (рамка-акцент); locked — «заполнит позже» (замок);
 *  done — read-only сводка. accent зависит от роли. */
export type PhaseState = 'active' | 'locked' | 'done'

export function PhaseBlock({ icon, title, role, state = 'active', hint, right, action, children }: {
  icon: IconName
  title: string
  role?: ProcessRole
  state?: PhaseState
  hint?: string
  right?: ReactNode
  action?: ReactNode
  children?: ReactNode
}) {
  const accent = roleAccent(role)
  const isLocked = state === 'locked'
  const isDone = state === 'done'
  return (
    <div style={{
      border: `1px solid ${state === 'active' ? accent : 'var(--c-border)'}`,
      borderRadius: 'var(--r-lg)', background: 'var(--c-bg-elev)', overflow: 'hidden',
      boxShadow: state === 'active' ? `0 0 0 3px color-mix(in oklab, ${accent} 8%, transparent)` : 'none',
      opacity: isLocked ? 0.72 : 1,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 9, padding: '11px 14px',
        borderBottom: '1px solid var(--c-border)',
        background: state === 'active' ? `color-mix(in oklab, ${accent} 5%, var(--c-bg-elev))` : 'var(--c-bg-sunken)',
      }}>
        <div style={{
          width: 24, height: 24, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          background: isDone ? 'var(--c-success-bg)' : isLocked ? 'var(--c-bg-active)' : `color-mix(in oklab, ${accent} 14%, transparent)`,
          color: isDone ? 'var(--c-success)' : isLocked ? 'var(--c-text-faint)' : accent,
        }}>
          {isDone ? <Icon name="check" size={13} /> : isLocked ? <Icon name="lock" size={12} /> : <Icon name={icon} size={14} />}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2 }}>{title}</div>
          {hint && <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', marginTop: 1 }}>{hint}</div>}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {right}
          {isDone && <span style={{ fontSize: 11.5, color: 'var(--c-success)', fontWeight: 500 }}>готово</span>}
          {role && <RoleChip role={role} faded={isLocked} />}
        </div>
      </div>
      {(children || action) && (
        <div style={{ padding: 14 }}>
          {children}
          {action && <div style={{ marginTop: 12 }}>{action}</div>}
        </div>
      )}
    </div>
  )
}
