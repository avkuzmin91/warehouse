import { Avatar, getInitials } from '../../../primitives/Avatar'
import { fmtDateTime } from '../../../../utils/format'

/** Инициатор документа-процесса: кто завёл (создатель) + когда. Единое поле для всех
 *  карточек (поступление, упаковка, отгрузка, рейс) — рендерится под номером в шапке. */
export function InitiatorLine({ name, createdAt }: { name?: string | null; createdAt?: string | null }) {
  if (!name && !createdAt) return null
  const base = name ? (name.includes('@') ? name.split('@')[0] : name) : ''
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 8, fontSize: 12, color: 'var(--c-text-subtle)' }}>
      {name && <Avatar initials={getInitials(base)} />}
      <span style={{ color: 'var(--c-text-muted)' }}>Инициатор</span>
      {name && <span style={{ color: 'var(--c-text)', fontWeight: 500 }}>{name}</span>}
      {createdAt && (
        <>
          <span style={{ color: 'var(--c-text-faint)' }}>·</span>
          <span className="mono">{fmtDateTime(createdAt)}</span>
        </>
      )}
    </div>
  )
}
