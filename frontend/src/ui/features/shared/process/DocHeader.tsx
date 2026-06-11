import type { ReactNode } from 'react'
import { Icon } from '../../../primitives/Icon'
import { RoleChip } from './RoleChip'
import type { ProcessRole } from './roles'

/** Шапка карточки документа-процесса (отгрузка, поступление): статус-бейджи,
 *  «сейчас у: роль», номер (mono) и контекстные действия справа. */
export function DocHeader({ badges, role, title, subtitle, actions, blockReasons = [], onBack }: {
  /** Статус-бейдж и дополнительные бейджи («Брак», «Ожидает рейс», приоритет). */
  badges: ReactNode
  role?: ProcessRole | null
  title: string
  subtitle?: string
  actions?: ReactNode
  /** Причины блокировки перехода — под всем рядом кнопок, чтобы не сдвигать их. */
  blockReasons?: string[]
  onBack: () => void
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16,
      paddingBottom: 16, marginBottom: 18, borderBottom: '1px solid var(--c-border)',
    }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
          <button className="btn ghost icon sm" onClick={onBack}>
            <Icon name="arrowLeft" size={14} />
          </button>
          {badges}
          {role && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--c-text-muted)' }}>
              <span style={{ color: 'var(--c-text-faint)' }}>·</span> сейчас у: <RoleChip role={role} />
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className="mono" style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' }}>{title}</span>
          {subtitle && <span style={{ fontSize: 13, color: 'var(--c-text-muted)' }}>{subtitle}</span>}
        </div>
      </div>
      {actions && (
        <div className="detail-actions" style={{ flexShrink: 0 }}>
          <div className="detail-actions-row">{actions}</div>
          {blockReasons.length > 0 && (
            <div className="block-reasons">
              {blockReasons.map((r, i) => <div key={i}>· {r}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
