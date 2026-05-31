import type { DictionaryItem } from '../../../../../api/domainTypes'
import type { ReceiptLine } from '../../../../../api/receiptsApi'
import { Table, Td } from '../../../../data/Table'
import { Icon } from '../../../../primitives/Icon'
import { NumberStep } from '../../shared/NumberStep'
import { LineIdentityCell } from './LineIdentityCell'
import { ZoneCell } from './ZoneCell'

type ZoneKind = 'storage' | 'good' | 'defect'

const groupBorder = '1px solid var(--c-border)'
const tintArr = 'var(--c-bg-sunken)'
const tintGood = 'color-mix(in oklab, var(--c-success) 7%, var(--c-bg-elev))'
const tintDef = 'color-mix(in oklab, var(--c-warning) 8%, var(--c-bg-elev))'

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

type ReviewProps = {
  stage: 'review'
  lines: ReceiptLine[]
  zones: DictionaryItem[]
  readonly: boolean
  getDraft: (line: ReceiptLine) => { accepted: number; defect: number }
  onDraftField: (line: ReceiptLine, field: 'accepted' | 'defect', v: number) => void
  zoneValue: (line: ReceiptLine, kind: ZoneKind) => string
  zoneName: (line: ReceiptLine, kind: ZoneKind) => string | null
  zoneSaving: (line: ReceiptLine, kind: ZoneKind) => boolean
  onZone: (line: ReceiptLine, kind: ZoneKind, v: string) => void
  completing: (line: ReceiptLine) => boolean
  reopening: (line: ReceiptLine) => boolean
  lineError: (line: ReceiptLine) => string | undefined
  onComplete: (line: ReceiptLine) => void
  onReopen: (line: ReceiptLine) => void
}

type Props = DraftProps | PlannedProps | ReviewProps

export function ReceiptLinesTable(props: Props) {
  const { stage, lines } = props
  const showAccepted = stage === 'planned' || stage === 'review'
  const showQc = stage === 'review'
  const hasGroups = showAccepted || showQc
  const actionWidth = stage === 'review' ? 96 : 56

  const skuCount = new Set(lines.map((l) => l.product_sku)).size

  // --- Totals ---
  const plannedOf = (l: ReceiptLine) =>
    props.stage === 'draft' || props.stage === 'planned' ? props.plannedQty(l) : l.planned_qty
  const acceptedOf = (l: ReceiptLine) =>
    props.stage === 'planned' ? props.accepted(l) : (l.accepted_qty ?? 0)

  let planTotal = 0
  let acceptedTotal = 0
  let goodTotal = 0
  let defectTotal = 0
  let surplusTotal = 0
  let shortageTotal = 0
  for (const l of lines) {
    planTotal += plannedOf(l)
    acceptedTotal += acceptedOf(l)
    if (props.stage === 'review') {
      const d = props.getDraft(l)
      const isDone = l.qc_status === 'done'
      const good = isDone ? l.accepted : d.accepted
      const defect = isDone ? l.defect : d.defect
      const processed = good + defect
      const base = l.accepted_qty ?? 0
      goodTotal += good
      defectTotal += defect
      surplusTotal += base ? Math.max(0, processed - base) : 0
      shortageTotal += base ? Math.max(0, base - processed) : 0
    }
  }

  const colCount = 2 + (showAccepted ? 2 : 0) + (showQc ? 5 : 0) + 1

  return (
    <Table>
      <thead>
        <tr>
          <th rowSpan={hasGroups ? 2 : 1}>Товар</th>
          <th rowSpan={hasGroups ? 2 : 1} style={{ width: stage === 'review' ? 50 : 130, textAlign: 'right' }}>План</th>
          {showAccepted && (
            <th colSpan={2} style={{ background: tintArr, textAlign: 'center', borderLeft: groupBorder }}>
              Принято
            </th>
          )}
          {showQc && (
            <>
              <th colSpan={2} style={{ background: tintGood, color: 'var(--c-success)', textAlign: 'center', borderLeft: groupBorder }}>
                Годный товар
              </th>
              <th colSpan={2} style={{ background: tintDef, color: 'var(--c-warning)', textAlign: 'center', borderLeft: groupBorder }}>
                Брак
              </th>
              <th rowSpan={2} style={{ width: 130, borderLeft: groupBorder }}>Статус</th>
            </>
          )}
          <th
            rowSpan={hasGroups ? 2 : 1}
            style={{ width: actionWidth, borderLeft: showAccepted && !showQc ? groupBorder : undefined }}
          >
            Действие
          </th>
        </tr>
        {hasGroups && (
          <tr>
            {showAccepted && (
              <>
                <th style={{ width: 70, textAlign: 'right', background: tintArr, borderLeft: groupBorder }}>Кол-во</th>
                <th style={{ width: 112, background: tintArr }}>Место</th>
              </>
            )}
            {showQc && (
              <>
                <th style={{ width: 92, textAlign: 'right', background: tintGood, borderLeft: groupBorder }}>Кол-во</th>
                <th style={{ width: 112, background: tintGood }}>Место</th>
                <th style={{ width: 92, textAlign: 'right', background: tintDef, borderLeft: groupBorder }}>Кол-во</th>
                <th style={{ width: 112, background: tintDef }}>Место</th>
              </>
            )}
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
              {showQc && (
                <>
                  <span style={{ color: 'var(--c-text-subtle)' }}>Годен <b className="mono" style={{ color: 'var(--c-success)' }}>{goodTotal}</b></span>
                  <span style={{ color: 'var(--c-text-subtle)' }}>Брак <b className="mono" style={{ color: 'var(--c-warning)' }}>{defectTotal}</b></span>
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 16 }}>
                    {surplusTotal === 0 && shortageTotal === 0
                      ? <span style={{ color: 'var(--c-text-faint)' }}>✓ расхождений нет</span>
                      : <>
                          {surplusTotal > 0 && <span style={{ color: 'var(--c-info, #3b82f6)' }}>▲ +{surplusTotal} излишек</span>}
                          {shortageTotal > 0 && <span style={{ color: 'var(--c-warning)' }}>▼ −{shortageTotal} недостача</span>}
                        </>}
                  </div>
                </>
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
              onChange={(v) => props.onPlannedQty(line, Math.max(1, v))}
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

      {props.stage === 'review' && <ReviewCells {...props} line={line} />}

      <Td style={{ borderLeft: props.stage === 'planned' ? groupBorder : undefined }}>
        {props.stage === 'review'
          ? <ReviewAction {...props} line={line} />
          : (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <button className="btn ghost icon sm" onClick={() => props.onDelete(line)}>
                <Icon name="trash" size={13} />
              </button>
            </div>
          )}
      </Td>
    </tr>
  )
}

function ReviewCells(props: ReviewProps & { line: ReceiptLine }) {
  const { line } = props
  const draft = props.getDraft(line)
  const isDone = line.qc_status === 'done'
  const lockQty = isDone || props.readonly

  const processed = isDone ? line.accepted + line.defect : draft.accepted + draft.defect
  const base = line.accepted_qty ?? 0
  const surplus = base ? Math.max(0, processed - base) : 0
  const shortage = base ? Math.max(0, base - processed) : 0
  const matched = processed === base && base > 0
  const preliminary = !isDone

  const isInProgress = !isDone && (line.qc_status === 'in_progress' || line.accepted > 0 || line.defect > 0 || line.ops_count > 0)
  const statusColor = isDone ? 'var(--c-success)' : isInProgress ? 'var(--c-info, #3b82f6)' : 'var(--c-text-faint)'
  const statusBg = isDone
    ? 'var(--c-success-bg)'
    : isInProgress
    ? 'color-mix(in oklab, var(--c-info, #3b82f6) 12%, transparent)'
    : 'transparent'
  const statusLabel = isDone ? 'Проверено' : isInProgress ? 'В работе' : 'Не начато'

  const zoneCell = (kind: ZoneKind) => (
    <ZoneCell
      value={props.zoneValue(line, kind)}
      zones={props.zones}
      onChange={(v) => props.onZone(line, kind, v)}
      disabled={props.zoneSaving(line, kind)}
      readonly={props.readonly}
      readonlyLabel={props.zoneName(line, kind)}
    />
  )

  return (
    <>
      <Td className="num" style={{ textAlign: 'right', fontWeight: 700, background: tintArr, borderLeft: groupBorder }}>
        {line.accepted_qty ?? '—'}
      </Td>
      <Td style={{ background: tintArr }}>{zoneCell('storage')}</Td>

      <Td style={{ textAlign: 'right', background: tintGood, borderLeft: groupBorder }}>
        {lockQty ? (
          <span className="num" style={{ fontWeight: 500 }}>{line.accepted}</span>
        ) : (
          <NumberStep
            value={draft.accepted}
            onChange={(v) => props.onDraftField(line, 'accepted', v)}
            min={0}
            disabled={props.completing(line)}
            width={92}
          />
        )}
      </Td>
      <Td style={{ background: tintGood }}>{zoneCell('good')}</Td>

      <Td style={{ textAlign: 'right', background: tintDef, borderLeft: groupBorder }}>
        {lockQty ? (
          <span className="num" style={{ fontWeight: 500, color: line.defect > 0 ? 'var(--c-warning)' : undefined }}>{line.defect}</span>
        ) : (
          <NumberStep
            value={draft.defect}
            onChange={(v) => props.onDraftField(line, 'defect', v)}
            min={0}
            tone={draft.defect > 0 ? 'warning' : 'normal'}
            disabled={props.completing(line)}
            width={92}
          />
        )}
      </Td>
      <Td style={{ background: tintDef }}>{zoneCell('defect')}</Td>

      <Td style={{ borderLeft: groupBorder }}>
        <div>
          <span style={{ fontSize: 11.5, fontWeight: 500, padding: '2px 7px', borderRadius: 'var(--r-sm)', color: statusColor, background: statusBg }}>
            {statusLabel}
          </span>
          {surplus > 0 && (
            <div style={{ fontSize: 11, color: 'var(--c-info, #3b82f6)', marginTop: 3, opacity: preliminary ? 0.85 : 1 }}
              title={preliminary ? 'Предварительно — зафиксируется при завершении' : undefined}>
              ▲ +{surplus} излишек
            </div>
          )}
          {shortage > 0 && (
            <div style={{ fontSize: 11, color: 'var(--c-warning)', marginTop: 3, opacity: preliminary ? 0.85 : 1 }}
              title={preliminary ? 'Предварительно — зафиксируется при завершении' : undefined}>
              ▼ −{shortage} недостача
            </div>
          )}
          {matched && (isDone || isInProgress) && (
            <div style={{ fontSize: 11, color: 'var(--c-text-subtle)', marginTop: 3 }}>= сходится</div>
          )}
        </div>
      </Td>
    </>
  )
}

function ReviewAction(props: ReviewProps & { line: ReceiptLine }) {
  const { line } = props
  const draft = props.getDraft(line)
  const isDone = line.qc_status === 'done'

  if (isDone) {
    return (
      <button className="btn ghost sm" onClick={() => props.onReopen(line)} disabled={props.reopening(line) || props.readonly}>
        <Icon name="edit" size={12} />Изменить
      </button>
    )
  }

  const needGoodZone = draft.accepted > 0 && !props.zoneValue(line, 'good').trim()
  const needDefectZone = draft.defect > 0 && !props.zoneValue(line, 'defect').trim()
  const zoneBlocked = needGoodZone || needDefectZone
  const lineErr = props.lineError(line)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
      <button
        className="btn sm primary"
        onClick={() => props.onComplete(line)}
        disabled={props.completing(line) || zoneBlocked}
        title={zoneBlocked ? 'Укажите место хранения' : undefined}
      >
        Завершить
      </button>
      {zoneBlocked && (
        <div style={{ fontSize: 11, color: 'var(--c-text-subtle)', maxWidth: 160 }}>
          {needGoodZone ? 'Укажите место годного' : 'Укажите место брака'}
        </div>
      )}
      {lineErr && (
        <div style={{ fontSize: 11, color: 'var(--c-danger)', maxWidth: 160 }}>{lineErr}</div>
      )}
    </div>
  )
}
