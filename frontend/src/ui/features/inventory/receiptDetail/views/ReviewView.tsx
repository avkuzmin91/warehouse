import { useState } from 'react'
import type React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  RECEIPT_OP_LABELS,
  RECEIPT_STATUS_LABELS,
  completeReceiptLine,
  receiptStatusTone,
  reopenReceiptLine,
  updateReceiptLine,
} from '../../../../../api/receiptsApi'
import type { ReceiptDetail, ReceiptLine } from '../../../../../api/receiptsApi'
import type { DictionaryItem } from '../../../../../api/domainTypes'
import { FilterChip } from '../../../../data/FiltersBar'
import { Badge } from '../../../../primitives/Badge'
import type { BadgeTone } from '../../../../primitives/Badge'
import { Card, CardBody, CardHead } from '../../../../primitives/Card'
import { Icon } from '../../../../primitives/Icon'
import { fmtDate } from '../../../../../utils/format'
import { useLookups } from '../../../../../hooks/useLookups'
import { ReceiptStepper } from '../../ReceiptStepper'
import { OpEntry } from '../components/OpEntry'
import { ReceiptLinesTable } from '../components/ReceiptLinesTable'

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
  // Ключ места: `${kind}:${lineId}`, kind ∈ 'storage' | 'good' | 'defect'.
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
      await onReload()
    } finally {
      setSavingZone((prev) => { const next = { ...prev }; delete next[key]; return next })
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
      const acceptedQty = l.accepted_qty ?? 0
      acc.planned += l.planned_qty
      acc.acceptedQty += acceptedQty
      acc.accepted += accepted
      acc.defect += defect
      acc.processed += processed
      // Отклонения считаются «на лету» относительно «Принят» (фактически прибыло),
      // в т.ч. по строкам в работе — предварительно (от draft).
      acc.surplus += acceptedQty ? Math.max(0, processed - acceptedQty) : 0
      acc.shortage += acceptedQty ? Math.max(0, acceptedQty - processed) : 0
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
            <ReceiptLinesTable
              stage="review"
              lines={lines}
              zones={storageZones}
              readonly={isReadonly}
              getDraft={(l) => getDraft(l)}
              onDraftField={(l, field, v) => setDraftField(l.id, field, v, l.accepted, l.defect)}
              zoneValue={(l, kind) => lineZoneId(l, kind) ?? ''}
              zoneName={(l, kind) => lineZoneName(l, kind)}
              zoneSaving={(l, kind) => savingZone[`${kind}:${l.id}`] ?? false}
              onZone={(l, kind, v) => void handleSaveLineZone(l.id, kind, v)}
              completing={(l) => completing[l.id] ?? false}
              reopening={(l) => reopening[l.id] ?? false}
              lineError={(l) => lineError[l.id]}
              onComplete={(l) => void handleCompleteClick(l)}
              onReopen={(l) => void handleReopen(l.id)}
            />
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
