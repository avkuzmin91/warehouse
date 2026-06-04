import type { ShipmentLine } from '../../../../api/shipmentsApi'
import { Icon } from '../../../primitives/Icon'
import { EmptyState } from '../../../primitives/EmptyState'

const COL_HEAD: React.CSSProperties = {
  textTransform: 'uppercase',
  fontSize: 10.5,
  letterSpacing: '0.04em',
  color: 'var(--c-text-faint)',
  fontWeight: 600,
  textAlign: 'left',
  padding: '0 0 6px',
}

function variantOf(line: ShipmentLine): string | null {
  return [line.color_name, line.size_name].filter(Boolean).join(' · ') || null
}

/** Таблица строк отгрузки (раскрытие строки в карточке рейса). */
export function ShipmentLinesTable({ lines, loading, error, onRetry }: {
  lines: ShipmentLine[]
  loading?: boolean
  error?: boolean
  onRetry?: () => void
}) {
  if (error) {
    return (
      <EmptyState
        title="Не удалось загрузить состав"
        sub="Повторите попытку"
        action={<button className="btn ghost sm" onClick={onRetry}><Icon name="refresh" size={13} />Повторить</button>}
      />
    )
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ height: 28, borderRadius: 6, background: 'var(--c-bg-sunken)', opacity: 1 - i * 0.18 }} />
        ))}
      </div>
    )
  }

  if (lines.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--c-text-faint)', padding: '6px 0' }}>
        <Icon name="boxOut" size={14} style={{ flexShrink: 0 }} />
        <span>Строки не заданы</span>
      </div>
    )
  }

  const totalQty = lines.reduce((s, l) => s + l.qty, 0)

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
      <thead>
        <tr>
          <th style={{ ...COL_HEAD, width: 28 }}>№</th>
          <th style={COL_HEAD}>SKU · товар</th>
          <th style={{ ...COL_HEAD, textAlign: 'right' }}>кол-во, шт</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line, i) => {
          const variant = variantOf(line)
          return (
            <tr key={line.id}>
              <td style={{ padding: '5px 0', verticalAlign: 'top', fontFamily: 'var(--font-code)', fontSize: 11.5, color: 'var(--c-text-faint)' }}>
                {i + 1}
              </td>
              <td style={{ padding: '5px 8px', verticalAlign: 'top' }}>
                <div style={{ fontWeight: 500 }}>
                  {line.product_name}
                  {variant && <span style={{ color: 'var(--c-text-faint)', fontWeight: 400 }}> · {variant}</span>}
                </div>
                <div className="mono" style={{ fontSize: 10.5, color: 'var(--c-text-faint)', marginTop: 1 }}>{line.product_sku}</div>
              </td>
              <td className="mono" style={{ padding: '5px 0', verticalAlign: 'top', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {line.qty}
              </td>
            </tr>
          )
        })}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={3} style={{ borderTop: '1.5px solid var(--c-border-strong)', paddingTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', color: 'var(--c-text-subtle)' }}>
              <span>Итого</span>
              <span className="mono" style={{ fontWeight: 600, color: 'var(--c-text)', fontVariantNumeric: 'tabular-nums' }}>
                {lines.length} SKU · {totalQty} шт
              </span>
            </div>
          </td>
        </tr>
      </tfoot>
    </table>
  )
}
