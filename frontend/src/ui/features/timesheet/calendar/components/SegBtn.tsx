import type { ReactNode } from 'react'
import { Icon, type IconName } from '../../../../primitives/Icon'

type Props = {
  active: boolean
  onClick?: () => void
  icon: IconName
  tone?: 'danger'
  disabled?: boolean
  children: ReactNode
}

export function SegBtn({ active, onClick, icon, tone, disabled, children }: Props) {
  const accent = tone === 'danger' ? 'var(--c-danger)' : 'var(--c-accent)'
  const accentBg = tone === 'danger' ? 'var(--c-danger-bg)' : 'var(--c-accent-bg)'
  const accentText = tone === 'danger' ? 'var(--c-danger)' : 'var(--c-accent-text)'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1, height: 34, borderRadius: 'var(--r-md)', cursor: disabled ? 'default' : 'pointer',
        border: `1px solid ${active ? accent : 'var(--c-border-strong)'}`,
        background: active ? accentBg : 'var(--c-bg-elev)',
        color: active ? accentText : 'var(--c-text-muted)',
        fontSize: 12.5, fontWeight: 500,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <Icon name={icon} size={13} />{children}
    </button>
  )
}
