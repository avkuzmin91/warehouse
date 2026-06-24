import type { TripOp } from '../../../../../api/tripsApi'
import { Avatar, getInitials } from '../../../../primitives/Avatar'
import { Icon } from '../../../../primitives/Icon'
import { fmtDateTime } from '../../../../../utils/format'
import { OP_ICONS, OP_LABELS, OP_TONES } from '../shared/opLabels'

const BG_MAP: Record<string, string> = {
  accent: 'var(--c-accent-bg)',
  success: 'var(--c-success-bg)',
  warning: 'color-mix(in oklab, var(--c-warning) 18%, var(--c-bg))',
  info: 'color-mix(in oklab, var(--c-info) 15%, var(--c-bg))',
  danger: 'color-mix(in oklab, var(--c-danger) 12%, var(--c-bg))',
  '': 'var(--c-bg-sunken)',
}

const BORDER_MAP: Record<string, string> = {
  accent: 'var(--c-accent-border)',
  success: 'color-mix(in oklab, var(--c-success) 35%, transparent)',
  warning: 'color-mix(in oklab, var(--c-warning) 40%, transparent)',
  info: 'color-mix(in oklab, var(--c-info) 35%, transparent)',
  danger: 'color-mix(in oklab, var(--c-danger) 35%, transparent)',
  '': 'var(--c-border)',
}

const COLOR_MAP: Record<string, string> = {
  accent: 'var(--c-accent)',
  success: 'var(--c-success)',
  warning: 'var(--c-warning)',
  info: 'var(--c-info)',
  danger: 'var(--c-danger)',
  '': 'var(--c-text-muted)',
}

/**
 * Запись в журнале операций рейса.
 * (По образцу receiptDetail/shipmentDetail OpEntry; операции рейса — только comment.)
 */
export function OpEntry({ op }: { op: TripOp }) {
  const tone = OP_TONES[op.op_type] ?? ''
  const iconName = OP_ICONS[op.op_type] ?? 'layers'
  const label = OP_LABELS[op.op_type] ?? op.op_type

  const email = op.created_by_email || op.created_by || ''
  const initials = email ? getInitials(email.split('@')[0]) : '?'

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr', padding: '8px 12px 8px 0', position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: 2 }}>
        <div style={{
          width: 22, height: 22, borderRadius: '50%',
          background: BG_MAP[tone] ?? BG_MAP[''],
          border: `1px solid ${BORDER_MAP[tone] ?? BORDER_MAP['']}`,
          color: COLOR_MAP[tone] ?? COLOR_MAP[''],
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative', zIndex: 1, flexShrink: 0,
        }}>
          <Icon name={iconName as never} size={11} />
        </div>
      </div>
      <div style={{ minWidth: 0, paddingTop: 1 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 2 }}>{label}</div>
        {op.comment && (
          <div style={{ fontSize: 11.5, color: 'var(--c-text-muted)', marginBottom: 3, lineHeight: 1.45 }}>{op.comment}</div>
        )}
        <div style={{ display: 'flex', gap: 6, fontSize: 11, color: 'var(--c-text-subtle)', alignItems: 'center' }}>
          {email && <Avatar initials={initials} />}
          {email && <span>{email}</span>}
          {email && <span>·</span>}
          <span className="mono">{fmtDateTime(op.created_at)}</span>
        </div>
      </div>
    </div>
  )
}
