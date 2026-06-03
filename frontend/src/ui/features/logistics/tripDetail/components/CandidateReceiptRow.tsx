import type { ReceiptListItem } from '../../../../../api/receiptsApi'
import { Icon } from '../../../../primitives/Icon'
import { Badge } from '../../../../primitives/Badge'
import { fmtDateShort } from '../../../../../utils/format'

/** Строка-кандидат на привязку: кастомный чекбокс, клиент, номер, SKU/шт, дата, бейдж «В плане». */
export function CandidateReceiptRow({ item, checked, onToggle }: {
  item: ReceiptListItem
  checked: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left',
        padding: '10px 11px', borderRadius: 'var(--r-lg)', cursor: 'pointer',
        border: `1px solid ${checked ? 'var(--c-accent)' : 'var(--c-border)'}`,
        background: checked ? 'var(--c-accent-bg)' : 'var(--c-bg-elev)',
        boxShadow: checked ? '0 0 0 3px color-mix(in oklab, var(--c-accent) 8%, transparent)' : 'none',
        transition: 'background 80ms, border-color 80ms, box-shadow 80ms', fontFamily: 'inherit',
      }}
    >
      <span style={{
        width: 18, height: 18, borderRadius: 5, flexShrink: 0,
        border: `1.5px solid ${checked ? 'var(--c-accent)' : 'var(--c-border-strong)'}`,
        background: checked ? 'var(--c-accent)' : 'var(--c-bg-elev)',
        color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {checked && <Icon name="check" size={12} />}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontWeight: 500, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {item.client_name ?? 'Без клиента'}
          </span>
          <span className="mono" style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', flexShrink: 0 }}>{item.doc_number}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>{item.sku_count} SKU · {item.total_planned} шт</span>
          {item.arrival_date && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
              <Icon name="calendar" size={11} />{fmtDateShort(item.arrival_date)}
            </span>
          )}
        </div>
      </div>
      <Badge tone="info" dot>В плане</Badge>
    </button>
  )
}
