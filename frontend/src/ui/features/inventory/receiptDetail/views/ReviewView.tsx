import { useState } from 'react'
import type React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  RECEIPT_OP_LABELS,
  RECEIPT_STATUS_LABELS,
  completeReceiptLine,
  recordReceiptOp,
  receiptStatusTone,
  reopenReceiptLine,
  updateReceiptLine,
} from '../../../../../api/receiptsApi'
import type { ReceiptDetail, ReceiptLine } from '../../../../../api/receiptsApi'
import type { DictionaryItem } from '../../../../../api/domainTypes'
import { Combobox } from '../../../../data/Combobox'
import { FilterChip } from '../../../../data/FiltersBar'
import { Table, Td } from '../../../../data/Table'
import { Badge } from '../../../../primitives/Badge'
import type { BadgeTone } from '../../../../primitives/Badge'
import { Card, CardBody, CardHead } from '../../../../primitives/Card'
import { Icon } from '../../../../primitives/Icon'
import { fmtDate } from '../../../../../utils/format'
import { useLookups } from '../../../../../hooks/useLookups'
import { ReceiptStepper } from '../../ReceiptStepper'
import { OpEntry } from '../components/OpEntry'

type LineQcDraft = {
  accepted: number
  defect: number
}

type Props = {
  docId: string
  detail: ReceiptDetail
  onReload: () => Promise<void>
  onAdvance: () => void
  onReopen: () => void
  advancing: boolean
}

export function ReviewView({ docId, detail, onReload, onAdvance, onReopen, advancing }: Props) {
  const navigate = useNavigate()
  const { doc, lines, ops } = detail

  const [drafts, setDrafts] = useState<Record<string, LineQcDraft>>({})
  const [completing, setCompleting] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  // Ключ места: `${kind}:${lineId}`, kind ∈ 'storage' | 'good' | 'defect'.
  const [pendingZone, setPendingZone] = useState<Record<string, string>>({})
  const [savingZone, setSavingZone] = useState<Record<string, boolean>>({})
  const [reopening, setReopening] = useState<Record<string, boolean>>({})
  const [lineError, setLineError] = useState<Record<string, string>>({})
  const [filterLine, setFilterLine] = useState<string | null>(null)
  const [filterType, setFilterType] = useState<string | null>(null)
  const [showBlockHint, setShowBlockHint] = useState(false)

  const { unloadingZones: zonesAll } = useLookups()
  const storageZones: DictionaryItem[] = zonesAll.filter((z) => z.is_active && !z.is_deleted)

  function getDraft(line: ReceiptLine): LineQcDraft {
    return drafts[line.id] ?? { accepted: line.accepted, defect: line.defect }
  }

  function setDraftField(lineId: string, field: 'accepted' | 'defect', value: number, serverAccepted: number, serverDefect: number) {
    setDrafts((prev) => {
      const cur = prev[lineId] ?? { accepted: serverAccepted, defect: serverDefect }
      return { ...prev, [lineId]: { ...cur, [field]: Math.max(0, value) } }
    })
  }

  async function handleCompleteClick(line: ReceiptLine) {
    const lineId = line.id
    const draft = getDraft(line)

    setLineError((prev) => { const next = { ...prev }; delete next[lineId]; return next })
    setCompleting((prev) => ({ ...prev, [lineId]: true }))
    try {
      await completeReceiptLine(docId, lineId, { accepted: draft.accepted, defect: draft.defect })
      await onReload()
      setDrafts((prev) => { const next = { ...prev }; delete next[lineId]; return next })
    } catch (e) {
      setLineError((prev) => ({ ...prev, [lineId]: e instanceof Error ? e.message : 'Ошибка' }))
    } finally {
      setCompleting((prev) => { const next = { ...prev }; delete next[lineId]; return next })
    }
  }

  async function handleSaveDraft(line: ReceiptLine) {
    const lineId = line.id
    const draft = getDraft(line)
    const deltaAccepted = draft.accepted - line.accepted
    const deltaDefect = draft.defect - line.defect
    if (deltaAccepted === 0 && deltaDefect === 0) return
    setLineError((prev) => { const next = { ...prev }; delete next[lineId]; return next })
    setSaving((prev) => ({ ...prev, [lineId]: true }))
    try {
      if (deltaAccepted > 0) {
        await recordReceiptOp(docId, { line_id: lineId, op_type: 'receiving', qty: deltaAccepted })
      } else if (deltaAccepted < 0) {
        await recordReceiptOp(docId, { line_id: lineId, op_type: 'receiving_correction', qty: draft.accepted })
      }
      if (deltaDefect > 0) {
        await recordReceiptOp(docId, { line_id: lineId, op_type: 'defect_fix', qty: deltaDefect })
      } else if (deltaDefect < 0) {
        await recordReceiptOp(docId, { line_id: lineId, op_type: 'defect_correction', qty: draft.defect })
      }
      await onReload()
      setDrafts((prev) => { const next = { ...prev }; delete next[lineId]; return next })
    } catch (e) {
      setLineError((prev) => ({ ...prev, [lineId]: e instanceof Error ? e.message : 'РћС€РёР±РєР°' }))
    } finally {
      setSaving((prev) => { const next = { ...prev }; delete next[lineId]; return next })
    }
  }

  async function handleReopen(lineId: string) {
    setReopening((prev) => ({ ...prev, [lineId]: true }))
    try {
      await reopenReceiptLine(docId, lineId)
      await onReload()
      // сбрасываем draft чтобы поля инициализировались от свежего server state
      setDrafts((prev) => { const next = { ...prev }; delete next[lineId]; return next })
    } finally {
      setReopening((prev) => { const next = { ...prev }; delete next[lineId]; return next })
    }
  }

  type ZoneKind = 'storage' | 'good' | 'defect'

  function lineZoneId(line: ReceiptLine, kind: ZoneKind): string | null {
    if (kind === 'good') return line.good_zone_id
    if (kind === 'defect') return line.defect_zone_id
    return line.storage_zone_id
  }
  function lineZoneName(line: ReceiptLine, kind: ZoneKind): string | null {
    if (kind === 'good') return line.good_zone_name
    if (kind === 'defect') return line.defect_zone_name
    return line.storage_zone_name
  }

  async function handleSaveLineZone(lineId: string, kind: ZoneKind, zoneId: string) {
    const key = `${kind}:${lineId}`
    const selectedZone = storageZones.find((z) => z.id === zoneId)
    const payload =
      kind === 'good'
        ? { good_zone_id: zoneId || null, good_zone_name: selectedZone?.name ?? null }
        : kind === 'defect'
        ? { defect_zone_id: zoneId || null, defect_zone_name: selectedZone?.name ?? null }
        : { storage_zone_id: zoneId || null, storage_zone_name: selectedZone?.name ?? null }
    setSavingZone((prev) => ({ ...prev, [key]: true }))
    try {
      await updateReceiptLine(docId, lineId, payload)
      setPendingZone((prev) => { const next = { ...prev }; delete next[key]; return next })
      await onReload()
    } finally {
      setSavingZone((prev) => { const next = { ...prev }; delete next[key]; return next })
    }
  }

  function zoneCell(line: ReceiptLine, kind: ZoneKind) {
    const savedId = lineZoneId(line, kind) ?? ''
    if (isReadonly) return <span>{lineZoneName(line, kind) || '—'}</span>
    const key = `${kind}:${line.id}`
    const cur = pendingZone[key] ?? savedId
    const dirty = pendingZone[key] !== undefined && pendingZone[key] !== savedId
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, width: 166 }}>
        <div className="storage-cell-combobox">
          <Combobox
            value={cur}
            placeholder="Выберите"
            options={storageZones.map((z) => ({ value: z.id, label: z.name }))}
            onChange={(value) => setPendingZone((prev) => ({ ...prev, [key]: String(value ?? '') }))}
            disabled={savingZone[key] || storageZones.length === 0}
            clearable
          />
        </div>
        {dirty && (
          <button
            className="btn ghost icon sm"
            style={{ color: 'var(--c-accent)', flexShrink: 0 }}
            disabled={savingZone[key]}
            onClick={() => void handleSaveLineZone(line.id, kind, pendingZone[key])}
            title="Сохранить"
          >
            <Icon name="save" size={14} />
          </button>
        )}
      </div>
    )
  }

  const allDone = lines.length > 0 && lines.every((l) => l.qc_status === 'done')
  const doneLinesCount = lines.filter((l) => l.qc_status === 'done').length

  const totals = lines.reduce(
    (acc, l) => {
      const d = getDraft(l)
      const accepted = l.qc_status === 'done' ? l.accepted : d.accepted
      const defect = l.qc_status === 'done' ? l.defect : d.defect
      const processed = accepted + defect
      const acceptedQty = l.accepted_qty ?? 0
      acc.planned += l.planned_qty
      acc.acceptedQty += acceptedQty
      acc.accepted += accepted
      acc.defect += defect
      acc.processed += processed
      // Отклонения считаются относительно «Принят» (фактически прибыло), только по проверенным строкам.
      if (l.qc_status === 'done') {
        acc.surplus += Math.max(0, processed - acceptedQty)
        acc.shortage += Math.max(0, acceptedQty - processed)
      }
      return acc
    },
    { planned: 0, acceptedQty: 0, accepted: 0, defect: 0, processed: 0, surplus: 0, shortage: 0 },
  )
  const totalSurplus = totals.surplus
  const totalShortage = totals.shortage

  const visibleOps = ops.filter((op) => {
    if (filterLine && op.line_id !== filterLine) return false
    if (filterType && op.op_type !== filterType) return false
    return true
  })

  const isReadonly = doc.status === 'done'

  return (
    <div className="page">
      <div className="page-header" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="detail-status-row">
            <button className="btn ghost icon sm" onClick={() => navigate('/inventory/receipts')}>
              <Icon name="arrowLeft" size={14} />
            </button>
            <Badge tone={receiptStatusTone(doc.status) as BadgeTone} dot>
              {RECEIPT_STATUS_LABELS[doc.status]}
            </Badge>
            <span className="detail-meta">
              {doc.doc_number} · {doc.client_name ?? '—'}
            </span>
          </div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span className="mono" style={{ fontWeight: 500 }}>{doc.doc_number}</span>
          </div>
        </div>
        <div className="row gap-8">
          {isReadonly && (
            <button className="btn ghost" onClick={onReopen} disabled={advancing}>
              <Icon name="arrowLeft" size={14} />Вернуть на проверку
            </button>
          )}
          {!isReadonly && (
            <div className="detail-actions">
              <button
                className="btn primary"
                onClick={() => { if (!allDone) { setShowBlockHint(true) } else { onAdvance() } }}
                disabled={advancing}
              >
                <Icon name="check" size={14} />Завершить проверку
              </button>
              {showBlockHint && !allDone && (
                <div className="block-reasons">
                  · Осталось проверить строк: {lines.length - doneLinesCount}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <ReceiptStepper status={doc.status} ops={ops} />

      {/* KPI */}
      {(() => {
        // Контроли считаются относительно «Принят» (фактически прибыло), не «План».
        // Виджет 1: % обработки — НЕ ограничиваем 100%
        const processedPct = totals.acceptedQty > 0 ? Math.round(totals.processed / totals.acceptedQty * 100) : 0
        // Виджет 2: % принятых — ограничиваем 100%, излишек показываем отдельно
        const acceptedPct = totals.acceptedQty > 0 ? Math.min(100, Math.round(totals.accepted / totals.acceptedQty * 100)) : 0
        return (
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
            {/* 1. Проверено = объём обработки (принято + брак) */}
            <div className="kpi">
              <div className="kpi-label">Проверено</div>
              <div className="kpi-value">
                {totals.processed}
                <span style={{ fontSize: 14, color: 'var(--c-text-subtle)', fontWeight: 500, marginLeft: 6 }}>/ {totals.acceptedQty}</span>
              </div>
              <div style={{ fontSize: 12, color: processedPct > 100 ? 'var(--c-info, #3b82f6)' : 'var(--c-text-subtle)', marginTop: 2, fontWeight: processedPct > 100 ? 600 : 400 }}>{processedPct}%</div>
              <div className="prog" style={{ marginTop: 6 }}>
                <div className="prog-fill" style={{ width: `${Math.min(100, processedPct)}%` }} />
              </div>
            </div>
            {/* 2. Принято = результат склада */}
            <div className="kpi">
              <div className="kpi-label">Принято</div>
              <div className="kpi-value">
                {totals.accepted}
                <span style={{ fontSize: 14, color: 'var(--c-text-subtle)', fontWeight: 500, marginLeft: 6 }}>/ {totals.acceptedQty}</span>
              </div>
              <div style={{ fontSize: 12, marginTop: 2, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--c-info, #3b82f6)', fontWeight: 600 }}>{acceptedPct}%</span>
                {totalSurplus > 0 && (
                  <span style={{ color: 'var(--c-warning)', fontWeight: 600 }}>+{totalSurplus} сверх плана</span>
                )}
              </div>
              <div className="prog" style={{ marginTop: 6 }}>
                <div className="prog-fill" style={{ width: `${acceptedPct}%` }} />
              </div>
            </div>
            {/* 3. Отклонения = брак, недостача, излишек */}
            <div className="kpi">
              <div className="kpi-label">Отклонения</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
                {totals.defect > 0 && (
                  <div>
                    <span style={{ fontSize: 13, color: 'var(--c-text-subtle)' }}>Брак: </span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-warning)' }}>{totals.defect}</span>
                  </div>
                )}
                {totalShortage > 0 && (
                  <div>
                    <span style={{ fontSize: 13, color: 'var(--c-text-subtle)' }}>Недостача: </span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-warning)' }}>−{totalShortage}</span>
                  </div>
                )}
                {totalSurplus > 0 && (
                  <div>
                    <span style={{ fontSize: 13, color: 'var(--c-text-subtle)' }}>Излишек: </span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-info, #3b82f6)' }}>+{totalSurplus}</span>
                  </div>
                )}
                {totals.defect === 0 && totalShortage === 0 && totalSurplus === 0 && (
                  <div style={{ fontSize: 13, color: 'var(--c-text-subtle)' }}>Нет отклонений</div>
                )}
              </div>
            </div>
            {/* 4. Состав поступления */}
            <div className="kpi">
              <div className="kpi-label">Состав поступления</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', rowGap: 6, columnGap: 10, fontSize: 13, marginTop: 8 }}>
                <span style={{ color: 'var(--c-text-muted)' }}>SKU</span>
                <span style={{ textAlign: 'right', fontWeight: 600 }} className="mono">{detail.state.sku_count}</span>
                <span style={{ color: 'var(--c-text-muted)' }}>Строк</span>
                <span style={{ textAlign: 'right', fontWeight: 600 }} className="mono">{lines.length}</span>
              </div>
            </div>
          </div>
        )
      })()}

      <div className="split-380">
        <div className="col gap-16">
          {/* Таблица строк */}
          <Card>
            <CardHead>
              <Icon name="boxes" size={15} className="ic-accent" />
              <span className="card-head-title">Товары</span>
              <Badge tone="accent" style={{ marginLeft: 6 } as React.CSSProperties}>{lines.length}</Badge>
              {!isReadonly && allDone && (
                <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--c-success)', fontWeight: 500 }}>
                  <Icon name="check" size={12} /> Все строки проверены
                </span>
              )}
            </CardHead>
            <Table>
              <thead>
                <tr>
                  <th style={{ width: 20 }} />
                  <th>Товар</th>
                  <th style={{ width: 150 }}>Место (на проверке)</th>
                  <th style={{ width: 50, textAlign: 'right' }}>План</th>
                  <th style={{ width: 60, textAlign: 'right' }}>Принят</th>
                  <th style={{ width: 110, textAlign: 'right' }}>Годный</th>
                  <th style={{ width: 150 }}>Место (годный)</th>
                  <th style={{ width: 110, textAlign: 'right' }}>Брак</th>
                  <th style={{ width: 150 }}>Место (брак)</th>
                  <th style={{ width: 120 }}>Статус</th>
                  <th style={{ width: 120 }}>Действия</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const draft = getDraft(line)
                  const isDone = line.qc_status === 'done'
                  const hasSavedProgress = line.accepted > 0 || line.defect > 0 || line.ops_count > 0
                  const isInProgress = !isDone && (line.qc_status === 'in_progress' || hasSavedProgress)
                  const isCompleting = completing[line.id] ?? false
                  const isSaving = saving[line.id] ?? false
                  const isReopening = reopening[line.id] ?? false
                  const hasDraftChange = draft.accepted !== line.accepted || draft.defect !== line.defect
                  const lineErr = lineError[line.id]
                  // Места годного/брака обязательны (бэкенд дублирует). Учитываем уже сохранённое место.
                  const needGoodZone = draft.accepted > 0 && !(line.good_zone_id || '').trim()
                  const needDefectZone = draft.defect > 0 && !(line.defect_zone_id || '').trim()
                  const zoneBlocked = needGoodZone || needDefectZone

                  const processed = isDone ? (line.accepted + line.defect) : (draft.accepted + draft.defect)
                  const defectPct = processed > 0 ? Math.round((isDone ? line.defect : draft.defect) / processed * 100) : 0

                  let surplus = 0
                  let shortage = 0
                  if (isDone) {
                    const acceptedQty = line.accepted_qty ?? 0
                    surplus = Math.max(0, processed - acceptedQty)
                    shortage = Math.max(0, acceptedQty - processed)
                  }

                  const statusColor = isDone
                    ? 'var(--c-success)'
                    : isInProgress
                    ? 'var(--c-info, #3b82f6)'
                    : 'var(--c-text-faint)'

                  const statusBg = isDone
                    ? 'var(--c-success-bg)'
                    : isInProgress
                    ? 'color-mix(in oklab, var(--c-info, #3b82f6) 12%, transparent)'
                    : 'transparent'

                  const statusLabel = isDone ? 'Проверено' : isInProgress ? 'В работе' : 'Не начато'

                  return (
                    <tr key={line.id}>
                      <Td>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: isDone ? 'var(--c-success)' : isInProgress ? 'var(--c-info, #3b82f6)' : 'var(--c-border-strong)' }} />
                      </Td>
                      <Td>
                        <div style={{ fontWeight: 500 }}>{line.product_name}</div>
                        <div className="mono" style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
                          {line.product_sku}
                          {line.color_name ? ` · ${line.color_name}` : ''}
                          {line.size_name ? ` · ${line.size_name}` : ''}
                        </div>
                      </Td>
                      <Td>{zoneCell(line, 'storage')}</Td>
                      <Td className="num" style={{ color: 'var(--c-text-muted)' }}>{line.planned_qty}</Td>
                      <Td className="num" style={{ fontWeight: 500 }}>{line.accepted_qty ?? '—'}</Td>
                      <Td style={{ textAlign: 'right' }}>
                        {isDone || isReadonly ? (
                          <span style={{ fontWeight: 500 }}>{line.accepted}</span>
                        ) : (
                          <div style={{ display: 'inline-flex', alignItems: 'center', border: '1px solid var(--c-border-strong)', borderRadius: 'var(--r-md)', height: 26, width: 110, background: 'var(--c-bg-elev)' }}>
                            <button
                              className="btn ghost icon sm"
                              style={{ height: 24, width: 24, border: 0, borderRight: '1px solid var(--c-border)', flexShrink: 0 }}
                              disabled={isCompleting}
                              onClick={() => setDraftField(line.id, 'accepted', draft.accepted - 1, line.accepted, line.defect)}
                            >
                              <Icon name="minus" size={10} />
                            </button>
                            <input
                              inputMode="numeric"
                              value={draft.accepted}
                              disabled={isCompleting}
                              onChange={(e) => {
                                const v = parseInt(e.target.value.replace(/\D/g, '')) || 0
                                setDraftField(line.id, 'accepted', v, line.accepted, line.defect)
                              }}
                              style={{ flex: 1, border: 0, outline: 'none', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, fontVariantNumeric: 'tabular-nums', fontFeatureSettings: "'zero' 0", background: 'transparent', minWidth: 0 }}
                            />
                            <button
                              className="btn ghost icon sm"
                              style={{ height: 24, width: 24, border: 0, borderLeft: '1px solid var(--c-border)', flexShrink: 0 }}
                              disabled={isCompleting}
                              onClick={() => setDraftField(line.id, 'accepted', draft.accepted + 1, line.accepted, line.defect)}
                            >
                              <Icon name="plus" size={10} />
                            </button>
                          </div>
                        )}
                      </Td>
                      <Td>{zoneCell(line, 'good')}</Td>
                      <Td style={{ textAlign: 'right' }}>
                        {isDone || isReadonly ? (
                          <span style={{ fontWeight: 500, color: line.defect > 0 ? 'var(--c-warning)' : undefined }}>
                            {line.defect}
                            <span style={{ fontSize: 11, color: 'var(--c-text-subtle)', fontWeight: 400, marginLeft: 4 }}>({defectPct}%)</span>
                          </span>
                        ) : (
                          <div style={{ display: 'inline-flex', alignItems: 'center', border: '1px solid var(--c-border-strong)', borderRadius: 'var(--r-md)', height: 26, width: 110, background: 'var(--c-bg-elev)' }}>
                            <button
                              className="btn ghost icon sm"
                              style={{ height: 24, width: 24, border: 0, borderRight: '1px solid var(--c-border)', flexShrink: 0 }}
                              disabled={isCompleting}
                              onClick={() => setDraftField(line.id, 'defect', draft.defect - 1, line.accepted, line.defect)}
                            >
                              <Icon name="minus" size={10} />
                            </button>
                            <input
                              inputMode="numeric"
                              value={draft.defect}
                              disabled={isCompleting}
                              onChange={(e) => {
                                const v = parseInt(e.target.value.replace(/\D/g, '')) || 0
                                setDraftField(line.id, 'defect', v, line.accepted, line.defect)
                              }}
                              style={{ flex: 1, border: 0, outline: 'none', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, fontVariantNumeric: 'tabular-nums', fontFeatureSettings: "'zero' 0", background: 'transparent', minWidth: 0, color: draft.defect > 0 ? 'var(--c-warning)' : undefined }}
                            />
                            <button
                              className="btn ghost icon sm"
                              style={{ height: 24, width: 24, border: 0, borderLeft: '1px solid var(--c-border)', flexShrink: 0 }}
                              disabled={isCompleting}
                              onClick={() => setDraftField(line.id, 'defect', draft.defect + 1, line.accepted, line.defect)}
                            >
                              <Icon name="plus" size={10} />
                            </button>
                          </div>
                        )}
                      </Td>
                      <Td>{zoneCell(line, 'defect')}</Td>
                      <Td>
                        <div>
                          <span style={{
                            fontSize: 11.5, fontWeight: 500, padding: '2px 7px', borderRadius: 'var(--r-sm)',
                            color: statusColor, background: statusBg,
                          }}>
                            {statusLabel}
                          </span>
                          {isDone && surplus > 0 && (
                            <div style={{ fontSize: 11, color: 'var(--c-info, #3b82f6)', marginTop: 3 }}>▲ +{surplus} излишек</div>
                          )}
                          {isDone && shortage > 0 && (
                            <div style={{ fontSize: 11, color: 'var(--c-warning)', marginTop: 3 }}>▼ −{shortage} недостача</div>
                          )}
                        </div>
                      </Td>
                      <Td>
                        {!isReadonly && (
                          isDone ? (
                            <button
                              className="btn ghost sm"
                              onClick={() => void handleReopen(line.id)}
                              disabled={isReopening}
                            >
                              <Icon name="edit" size={12} />Редактировать
                            </button>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                              <div style={{ display: 'flex', gap: 4 }}>
                                {hasDraftChange && (
                                  <button
                                    className="btn ghost icon sm"
                                    title="Сохранить без завершения"
                                    onClick={() => void handleSaveDraft(line)}
                                    disabled={isSaving || isCompleting}
                                  >
                                    <Icon name="save" size={14} />
                                  </button>
                                )}
                                <button
                                  className="btn sm primary"
                                  onClick={() => void handleCompleteClick(line)}
                                  disabled={isCompleting || isSaving || zoneBlocked}
                                  title={zoneBlocked ? 'Укажите место хранения' : undefined}
                                >
                                  <Icon name="check" size={12} />Завершить
                                </button>
                              </div>
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
                        )}
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--c-bg-sunken)' }}>
                  <td />
                  <td style={{ padding: '10px 12px', fontWeight: 500, fontSize: 12.5 }}>Итого</td>
                  <td />
                  <td className="num" style={{ padding: '10px 12px', color: 'var(--c-text-muted)' }}>{totals.planned}</td>
                  <td className="num" style={{ padding: '10px 12px', fontWeight: 600 }}>{totals.acceptedQty}</td>
                  <td className="num" style={{ padding: '10px 12px', fontWeight: 600 }}>{totals.accepted}</td>
                  <td />
                  <td className="num" style={{ padding: '10px 12px', fontWeight: 600, color: totals.defect > 0 ? 'var(--c-warning)' : undefined }}>
                    {totals.defect}
                    {totals.defect > 0 && totals.processed > 0 && (
                      <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--c-text-subtle)', marginLeft: 4 }}>
                        ({Math.round(totals.defect / totals.processed * 100)}%)
                      </span>
                    )}
                  </td>
                  <td />
                  <td colSpan={2} style={{ padding: '10px 12px', fontSize: 12 }}>
                    {totalSurplus > 0 && <span style={{ color: 'var(--c-info, #3b82f6)', marginRight: 10 }}>▲ +{totalSurplus} излишек</span>}
                    {totalShortage > 0 && <span style={{ color: 'var(--c-warning)' }}>▼ −{totalShortage} недостача</span>}
                  </td>
                </tr>
              </tfoot>
            </Table>
          </Card>

          {/* Основная информация */}
          <Card>
            <CardHead>
              <Icon name="file" size={15} />
              <span className="card-head-title">Основная информация</span>
            </CardHead>
            <CardBody style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px 24px', fontSize: 12.5 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--c-text-muted)', marginBottom: 2 }}>Клиент</div>
                <div>{doc.client_name ?? '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--c-text-muted)', marginBottom: 2 }}>Поставщик</div>
                <div>{doc.supplier_name || '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--c-text-muted)', marginBottom: 2 }}>Дата прибытия</div>
                <div>{fmtDate(doc.arrival_date)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--c-text-muted)', marginBottom: 2 }}>Стоимость логистики</div>
                <div className="mono">{doc.logistics_cost.toLocaleString('ru-RU')} ₽</div>
              </div>
            </CardBody>
          </Card>
        </div>

        {/* Правая колонка: Готовность + Журнал */}
        <div className="col gap-16">
          <Card>
            <CardHead>
              <Icon name="check" size={15} className="ic-success" />
              <span className="card-head-title">Готовность</span>
            </CardHead>
            <div className="readiness-list">
              {[
                {
                  ok: lines.length > 0,
                  label: `Строк: ${doneLinesCount} / ${lines.length}`,
                  error: 'Нет строк в документе',
                },
                {
                  ok: lines.length > 0 && doneLinesCount === lines.length,
                  label: 'Все строки проверены',
                  error: `Осталось проверить: ${lines.length - doneLinesCount}`,
                },
              ].map((c, i) => (
                <div key={i} className="readiness-row">
                  {c.ok ? (
                    <div className="readiness-dot ok">
                      <Icon name="check" size={10} />
                    </div>
                  ) : (
                    <div className="readiness-dot pending" />
                  )}
                  <span className={`readiness-label ${c.ok ? 'ok' : 'pending'}`}>{c.ok ? c.label : c.error}</span>
                </div>
              ))}
            </div>
          </Card>

        {/* Журнал операций */}
        <div className="card ops-card" style={{ top: 0, maxHeight: 'calc(100vh - 80px)' }}>
          <CardHead>
            <Icon name="layers" size={15} className="ic-accent" />
            <span className="card-head-title">Журнал операций</span>
            <Badge tone="accent" style={{ marginLeft: 6 } as React.CSSProperties}>{ops.length}</Badge>
          </CardHead>
          <div style={{ padding: '8px 12px', display: 'flex', flexWrap: 'wrap', gap: 6, borderBottom: '1px solid var(--c-border)', flexShrink: 0 }}>
            <FilterChip
              label="Тип"
              value={filterType ? (RECEIPT_OP_LABELS[filterType as keyof typeof RECEIPT_OP_LABELS] ?? filterType) : undefined}
              active={!!filterType}
              onClick={() => setFilterType(null)}
              onClear={() => setFilterType(null)}
            />
            <FilterChip
              label="Строка"
              value={filterLine ?? undefined}
              active={!!filterLine}
              onClick={() => setFilterLine(null)}
              onClear={() => setFilterLine(null)}
            />
          </div>
          <div className="ops-card-body">
            {visibleOps.length === 0 ? (
              <div className="ops-card-empty">
                {filterLine || filterType ? 'Под фильтр ничего не попало' : 'Нет операций'}
              </div>
            ) : (
              <div className="ops-timeline">
                {visibleOps.map((op) => (
                  <OpEntry key={op.id} op={op} onFilterLine={(lid) => setFilterLine(lid)} />
                ))}
              </div>
            )}
          </div>
          <div className="ops-card-foot">
            <Icon name="shield" size={11} />
            <span>Операции не редактируются. Удаление запрещено.</span>
          </div>
        </div>
        </div>{/* конец правой колонки */}
      </div>

    </div>
  )
}
