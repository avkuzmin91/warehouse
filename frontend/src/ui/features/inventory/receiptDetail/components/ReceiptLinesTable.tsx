import type { DictionaryItem } from '../../../../../api/domainTypes'
import type { ReceiptLine } from '../../../../../api/receiptsApi'
import { Table, Td } from '../../../../data/Table'
import { Icon } from '../../../../primitives/Icon'
import { NumberStep } from '../../shared/NumberStep'
import { LineIdentityCell } from './LineIdentityCell'
import { ZoneCell } from './ZoneCell'

const groupBorder = '1px solid var(--c-border)'
const tintArr = 'var(--c-bg-sunken)'

type DraftProps = {
  stage: 'draft'
  lines: ReceiptLine[]
  saving: boolean
  plannedQty: (line: ReceiptLine) => number
  plannedDirty: (line: ReceiptLine) => boolean
  onPlannedQty: (line: ReceiptLine, v: number) => void
  onDelete: (line: ReceiptLine) => void
}

type PlannedProps = {
  stage: 'planned'
  lines: ReceiptLine[]
  zones: DictionaryItem[]
  saving: boolean
  plannedQty: (line: ReceiptLine) => number
  plannedDirty: (line: ReceiptLine) => boolean
  onPlannedQty: (line: ReceiptLine, v: number) => void
  accepted: (line: ReceiptLine) => number
  onAccepted: (line: ReceiptLine, v: number) => void
  storageValue: (line: ReceiptLine) => string
  onStorage: (line: ReceiptLine, v: string) => void
  onDelete: (line: ReceiptLine) => void
}

// Review-стадия read-only: годность/брак определяются при упаковке, а не в поступлении.
// Показываем только план и принятое количество (→ остаток «на проверке»).
type ReviewProps = {
  stage: 'review'
  lines: ReceiptLine[]
}

type Props = DraftProps | PlannedProps | ReviewProps

export function ReceiptLinesTable(props: Props) {
  const { stage, lines } = props
  const showAccepted = stage === 'planned' || stage === 'review'
  const showAction = stage !== 'review'
  const hasGroups = showAccepted

  const skuCount = new Set(lines.map((l) => l.product_sku)).size

  const plannedOf = (l: ReceiptLine) =>
    props.stage === 'draft' || props.stage === 'planned' ? props.plannedQty(l) : l.planned_qty
  const acceptedOf = (l: ReceiptLine) =>
    props.stage === 'planned' ? props.accepted(l) : (l.accepted_qty ?? 0)

  let planTotal = 0
  let acceptedTotal = 0
  for (const l of lines) {
    planTotal += plannedOf(l)
    acceptedTotal += acceptedOf(l)
  }

  const colCount = 2 + (showAccepted ? 2 : 0) + (showAction ? 1 : 0)

  return (
    <Table>
      <thead>
        <tr>
          <th rowSpan={hasGroups ? 2 : 1}>Товар</th>
          <th rowSpan={hasGroups ? 2 : 1} style={{ width: stage === 'review' ? 110 : 130, textAlign: 'right' }}>План</th>
          {showAccepted && (
            <th colSpan={2} style={{ background: tintArr, textAlign: 'center', borderLeft: groupBorder }}>
              Принято
            </th>
          )}
          {showAction && (
            <th
              rowSpan={hasGroups ? 2 : 1}
              style={{ width: 56, borderLeft: showAccepted ? groupBorder : undefined }}
            >
              Действие
            </th>
          )}
        </tr>
        {hasGroups && (
          <tr>
            <th style={{ width: 90, textAlign: 'right', background: tintArr, borderLeft: groupBorder }}>Кол-во</th>
            <th style={{ width: 160, background: tintArr }}>Место</th>
          </tr>
        )}
      </thead>
      <tbody>
        {lines.map((line) => (
          <Row key={line.id} {...props} line={line} />
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={colCount} style={{ padding: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '10px 14px',
              background: 'var(--c-bg-sunken)', borderTop: '1px solid var(--c-border)', fontSize: 12.5 }}>
              <span style={{ fontWeight: 700 }}>Итого</span>
              <span style={{ color: 'var(--c-text-subtle)' }}>{skuCount} SKU</span>
              <span style={{ color: 'var(--c-text-subtle)' }}>План <b className="mono" style={{ color: 'var(--c-text)' }}>{planTotal}</b></span>
              {showAccepted && (
                <span style={{ color: 'var(--c-text-subtle)' }}>Принято <b className="mono" style={{ color: 'var(--c-text)' }}>{acceptedTotal}</b></span>
              )}
            </div>
          </td>
        </tr>
      </tfoot>
    </Table>
  )
}

function Row(props: Props & { line: ReceiptLine }) {
  const { line } = props

  return (
    <tr>
      <Td>
        <LineIdentityCell name={line.product_name} sku={line.product_sku} color={line.color_name} size={line.size_name} />
      </Td>
      <Td className="num" style={{ color: 'var(--c-text-muted)' }}>
        {props.stage === 'review'
          ? line.planned_qty
          : (
            <NumberStep
              value={props.plannedQty(line)}
              onChange={(v) => props.onPlannedQty(line, v)}
              tone={props.plannedDirty(line) ? 'accent' : 'normal'}
              disabled={props.saving}
              width={100}
            />
          )}
      </Td>

      {props.stage === 'planned' && (
        <>
          <Td style={{ textAlign: 'right', background: tintArr, borderLeft: groupBorder }}>
            <NumberStep
              value={props.accepted(line)}
              onChange={(v) => props.onAccepted(line, Math.max(0, v))}
              min={0}
              disabled={props.saving}
              width={92}
            />
          </Td>
          <Td style={{ background: tintArr }}>
            <ZoneCell
              value={props.storageValue(line)}
              zones={props.zones}
              onChange={(v) => props.onStorage(line, v)}
              disabled={props.saving}
            />
          </Td>
        </>
      )}

      {props.stage === 'review' && (
        <>
          <Td className="num" style={{ textAlign: 'right', fontWeight: 700, background: tintArr, borderLeft: groupBorder }}>
            {line.accepted_qty ?? '—'}
          </Td>
          <Td style={{ background: tintArr }}>
            <span className="t-sub">{line.storage_zone_name || '—'}</span>
          </Td>
        </>
      )}

      {props.stage !== 'review' && (
        <Td>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <button className="btn ghost icon sm" onClick={() => props.onDelete(line)}>
              <Icon name="trash" size={13} />
            </button>
          </div>
        </Td>
      )}
    </tr>
  )
}
