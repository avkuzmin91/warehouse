import { RECEIPT_OP_LABELS } from '../../../../../api/receiptsApi'
import type { ReceiptOp } from '../../../../../api/receiptsApi'
import { Avatar, getInitials } from '../../../../primitives/Avatar'
import { Icon } from '../../../../primitives/Icon'
import { fmtDateTime } from '../../../../../utils/format'
import { OP_ICONS, OP_TONES } from '../shared/opLabels'

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

type Props = {
  op: ReceiptOp
  onFilterLine: (lineId: string) => void
}

/**
 * Запись в журнале операций поступления.
 * tone, icon, label берутся по op_type из shared/opLabels.
 */
export function OpEntry({ op, onFilterLine }: Props) {
  const tone = OP_TONES[op.op_type] ?? ''
  const iconName = OP_ICONS[op.op_type] ?? 'layers'
  const label = RECEIPT_OP_LABELS[op.op_type as keyof typeof RECEIPT_OP_LABELS] ?? op.op_type

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
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 2, alignItems: 'center' }}>
          <span style={{ fontSize: 12.5, fontWeight: 500 }}>{label}</span>
          {op.line_id && (
            <span
              className="mono"
              style={{ fontSize: 11, color: 'var(--c-accent)', cursor: 'pointer', background: 'var(--c-accent-bg)', padding: '1px 5px', borderRadius: 4 }}
              onClick={() => onFilterLine(op.line_id!)}
              title="Фильтровать по этой строке"
            >
              строка
            </span>
          )}
          {op.qty != null && (
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>{op.qty} шт</span>
          )}
        </div>
        {op.comment && (
          <div style={{ fontSize: 11.5, color: 'var(--c-text-muted)', marginBottom: 3, lineHeight: 1.45 }}>{op.comment}</div>
        )}
        {op.reason && (
          <div style={{ fontSize: 11.5, color: 'var(--c-text-muted)', marginBottom: 3 }}>Причина: {op.reason}</div>
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
