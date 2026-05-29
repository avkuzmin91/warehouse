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
  const [pendingStorage, setPendingStorage] = useState<Record<string, string>>({})
  const [savingStorage, setSavingStorage] = useState<Record<string, boolean>>({})
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

  async function handleSaveLineStorage(lineId: string, zoneId: string) {
    const selectedZone = storageZones.find((z) => z.id === zoneId)
    setSavingStorage((prev) => ({ ...prev, [lineId]: true }))
    try {
      await updateReceiptLine(docId, lineId, {
        storage_zone_id: zoneId || null,
        storage_zone_name: selectedZone?.name ?? null,
      })
      setPendingStorage((prev) => { const next = { ...prev }; delete next[lineId]; return next })
      await onReload()
    } finally {
      setSavingStorage((prev) => { const next = { ...prev }; delete next[lineId]; return next })
    }
  }

  const allDone = lines.length > 0 && lines.every((l) => l.qc_status === 'done')
  const doneLinesCount = lines.filter((l) => l.qc_status === 'done').length

  const totals = lines.reduce(
    (acc, l) => {
      const d = getDraft(l)
      const accepted = l.qc_status === 'done' ? l.accepted : d.accepted
      const defect = l.qc_status === 'done' ? l.defect : d.defect
      const processed = accepted + defect
      acc.planned += l.planned_qty
      acc.accepted += accepted
      acc.defect += defect
      acc.processed += processed
      // Отклонения только по проверенным строкам (qc_status === 'done'), чтобы пересорт не компенсировался
      if (l.qc_status === 'done') {
        acc.surplus += Math.max(0, processed - l.planned_qty)
        acc.shortage += Math.max(0, l.planned_qty - processed)
      }
      return acc
    },
    { planned: 0, accepted: 0, defect: 0, processed: 0, surplus: 0, shortage: 0 },
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
          <div style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
            <button className="btn ghost icon sm" onClick={() => navigate('/inventory/receipts')}>
              <Icon name="arrowLeft" size={14} />
            </button>
            <Badge tone={receiptStatusTone(doc.status) as BadgeTone} dot>
              {RECEIPT_STATUS_LABELS[doc.status]}
            </Badge>
            <span style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
              {doc.doc_number} · {doc.client_name ?? '—'}
            </span>
          </div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span className="mono" style={{ fontWeight: 500 }}>{doc.doc_number}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {isReadonly && (
            <button className="btn ghost" onClick={onReopen} disabled={advancing}>
              <Icon name="arrowLeft" size={14} />Вернуть на проверку
            </button>
          )}
          {!isReadonly && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
              <button
                className="btn primary"
                onClick={() => { if (!allDone) { setShowBlockHint(true) } else { onAdvance() } }}
                disabled={advancing}
              >
                <Icon name="check" size={14} />Завершить проверку
              </button>
              {showBlockHint && !allDone && (
                <div style={{ fontSize: 12, color: 'var(--c-danger)', textAlign: 'right', lineHeight: 1.5 }}>
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
        // Виджет 1: % обработки — НЕ ограничиваем 100%
        const processedPct = totals.planned > 0 ? Math.round(totals.processed / totals.planned * 100) : 0
        // Виджет 2: % принятых — ограничиваем 100%, излишек показываем отдельно
        const acceptedPct = totals.planned > 0 ? Math.min(100, Math.round(totals.accepted / totals.planned * 100)) : 0
        return (
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
            {/* 1. Проверено = объём обработки (принято + брак) */}
            <div className="kpi">
              <div className="kpi-label">Проверено</div>
              <div className="kpi-value">
                {totals.processed}
                <span style={{ fontSize: 14, color: 'var(--c-text-subtle)', fontWeight: 500, marginLeft: 6 }}>/ {totals.planned}</span>
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
                <span style={{ fontSize: 14, color: 'var(--c-text-subtle)', fontWeight: 500, marginLeft: 6 }}>/ {totals.planned}</span>
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Таблица строк */}
          <Card>
            <CardHead>
              <Icon name="boxes" size={15} style={{ color: 'var(--c-accent)' }} />
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
                  <th style={{ width: 170 }}>Хранение</th>
                  <th style={{ width: 55, textAlign: 'right' }}>План</th>
                  <th style={{ width: 124, textAlign: 'right' }}>Принято</th>
                  <th style={{ width: 124, textAlign: 'right' }}>Брак</th>
                  <th style={{ width: 130 }}>Статус</th>
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

                  const processed = isDone ? (line.accepted + line.defect) : (draft.accepted + draft.defect)
                  const defectPct = processed > 0 ? Math.round((isDone ? line.defect : draft.defect) / processed * 100) : 0

                  let surplus = 0
                  let shortage = 0
                  if (isDone) {
                    surplus = Math.max(0, processed - line.planned_qty)
                    shortage = Math.max(0, line.planned_qty - processed)
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
                      <Td>
                        {isReadonly ? (
                          <span>{line.storage_zone_name || '—'}</span>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, width: 166 }}>
                            <div className="storage-cell-combobox">
                              <Combobox
                                value={pendingStorage[line.id] ?? line.storage_zone_id ?? ''}
                                placeholder="Выберите"
                                options={storageZones.map((z) => ({ value: z.id, label: z.name }))}
                                onChange={(value) => setPendingStorage((prev) => ({ ...prev, [line.id]: String(value ?? '') }))}
                                disabled={savingStorage[line.id] || storageZones.length === 0}
                                clearable
                              />
                            </div>
                            {pendingStorage[line.id] !== undefined && pendingStorage[line.id] !== (line.storage_zone_id ?? '') && (
                              <button
                                className="btn ghost icon sm"
                                style={{ color: 'var(--c-accent)', flexShrink: 0 }}
                                disabled={savingStorage[line.id]}
                                onClick={() => void handleSaveLineStorage(line.id, pendingStorage[line.id])}
                                title="Сохранить"
                              >
                                <Icon name="save" size={14} />
                              </button>
                            )}
                          </div>
                        )}
                      </Td>
                      <Td className="num" style={{ color: 'var(--c-text-muted)' }}>{line.planned_qty}</Td>
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
                                  disabled={isCompleting || isSaving}
                                >
                                  <Icon name="check" size={12} />Завершить
                                </button>
                              </div>
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
                  <td className="num" style={{ padding: '10px 12px', fontWeight: 600 }}>{totals.accepted}</td>
                  <td className="num" style={{ padding: '10px 12px', fontWeight: 600, color: totals.defect > 0 ? 'var(--c-warning)' : undefined }}>
                    {totals.defect}
                    {totals.defect > 0 && totals.processed > 0 && (
                      <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--c-text-subtle)', marginLeft: 4 }}>
                        ({Math.round(totals.defect / totals.processed * 100)}%)
                      </span>
                    )}
                  </td>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <CardHead>
              <Icon name="check" size={15} style={{ color: 'var(--c-success)' }} />
              <span className="card-head-title">Готовность</span>
            </CardHead>
            <div style={{ padding: '4px 0' }}>
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
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', fontSize: 13 }}>
                  {c.ok ? (
                    <div style={{ width: 16, height: 16, borderRadius: '50%', background: 'var(--c-success-bg)', color: 'var(--c-success)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon name="check" size={10} />
                    </div>
                  ) : (
                    <div style={{ width: 16, height: 16, borderRadius: '50%', border: '1.5px dashed var(--c-text-faint)', flexShrink: 0 }} />
                  )}
                  <span style={{ color: c.ok ? 'var(--c-text)' : 'var(--c-text-muted)' }}>{c.ok ? c.label : c.error}</span>
                </div>
              ))}
            </div>
          </Card>

        {/* Журнал операций */}
        <div
          className="card"
          style={{ position: 'sticky', top: 0, width: '100%', maxWidth: '100%', boxSizing: 'border-box', maxHeight: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column' }}
        >
          <CardHead style={{ borderBottom: '1px solid var(--c-border)', flexShrink: 0 } as React.CSSProperties}>
            <Icon name="layers" size={15} style={{ color: 'var(--c-accent)' }} />
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
          <div style={{ flex: '1 1 auto', overflow: 'auto', padding: '4px 0' }}>
            {visibleOps.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--c-text-muted)', fontSize: 13 }}>
                {filterLine || filterType ? 'Под фильтр ничего не попало' : 'Нет операций'}
              </div>
            ) : (
              <div style={{ position: 'relative' }}>
                <div style={{ position: 'absolute', left: 22, top: 12, bottom: 12, width: 1, background: 'var(--c-border)' }} />
                {visibleOps.map((op) => (
                  <OpEntry key={op.id} op={op} onFilterLine={(lid) => setFilterLine(lid)} />
                ))}
              </div>
            )}
          </div>
          <div style={{ padding: '8px 12px', borderTop: '1px solid var(--c-border)', background: 'var(--c-bg-sunken)', fontSize: 11, color: 'var(--c-text-subtle)', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <Icon name="shield" size={11} />
            <span>Операции не редактируются. Удаление запрещено.</span>
          </div>
        </div>
        </div>{/* конец правой колонки */}
      </div>

    </div>
  )
}
