import { useState } from 'react'
import type React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  RECEIPT_OP_LABELS,
  RECEIPT_STATUS_LABELS,
  completeReceiptLine,
  receiptStatusTone,
  recordReceiptOp,
  reopenReceiptLine,
  updateReceiptLine,
} from '../../../../../api/receiptsApi'
import type { ReceiptDetail, ReceiptLine } from '../../../../../api/receiptsApi'
import type { DictionaryItem } from '../../../../../api/domainTypes'
import { FilterChip } from '../../../../data/FiltersBar'
import { Alert } from '../../../../primitives/Alert'
import { Badge } from '../../../../primitives/Badge'
import type { BadgeTone } from '../../../../primitives/Badge'
import { Card, CardBody, CardHead } from '../../../../primitives/Card'
import { Icon } from '../../../../primitives/Icon'
import { Drawer } from '../../../../feedback/Drawer'
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
  // Ключ места: `${kind}:${lineId}`, kind ∈ 'storage' | 'good' | 'defect'. Изменения отложены до «Сохранить».
  const [pendingZones, setPendingZones] = useState<Record<string, string>>({})
  const [savingChanges, setSavingChanges] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [reopening, setReopening] = useState<Record<string, boolean>>({})
  const [lineError, setLineError] = useState<Record<string, string>>({})
  const [filterLine, setFilterLine] = useState<string | null>(null)
  const [filterType, setFilterType] = useState<string | null>(null)
  const [showBlockHint, setShowBlockHint] = useState(false)
  const [opsDrawerOpen, setOpsDrawerOpen] = useState(false)

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

    setLineError((prev) => { const next = { ...prev }; delete next[lineId]; return next })
    setCompleting((prev) => ({ ...prev, [lineId]: true }))
    try {
      // Сначала фиксируем отложенные правки (кол-во/места), затем завершаем строку
      // из сохранённого состояния журнала (без body) — иначе бэкенд отклонит по местам.
      if (hasUnsavedChanges) {
        const ok = await handleSaveChanges()
        if (!ok) return
      }
      await completeReceiptLine(docId, lineId)
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

  function zonePayload(kind: ZoneKind, zoneId: string) {
    const selectedZone = storageZones.find((z) => z.id === zoneId)
    if (kind === 'good') return { good_zone_id: zoneId || null, good_zone_name: selectedZone?.name ?? null }
    if (kind === 'defect') return { defect_zone_id: zoneId || null, defect_zone_name: selectedZone?.name ?? null }
    return { storage_zone_id: zoneId || null, storage_zone_name: selectedZone?.name ?? null }
  }

  function effectiveZoneId(line: ReceiptLine, kind: ZoneKind): string {
    return pendingZones[`${kind}:${line.id}`] ?? (lineZoneId(line, kind) ?? '')
  }

  function setPendingZone(lineId: string, kind: ZoneKind, zoneId: string) {
    setPendingZones((prev) => ({ ...prev, [`${kind}:${lineId}`]: zoneId }))
  }

  const hasDirtyQty = lines.some((l) => {
    const d = drafts[l.id]
    return d !== undefined && (d.accepted !== l.accepted || d.defect !== l.defect)
  })
  const hasDirtyZones = Object.keys(pendingZones).some((key) => {
    const sep = key.indexOf(':')
    const kind = key.slice(0, sep) as ZoneKind
    const line = lines.find((l) => l.id === key.slice(sep + 1))
    return !!line && pendingZones[key] !== (lineZoneId(line, kind) ?? '')
  })
  const hasUnsavedChanges = hasDirtyQty || hasDirtyZones

  async function handleSaveChanges(): Promise<boolean> {
    setSaveError('')
    setSavingChanges(true)
    try {
      for (const line of lines) {
        const d = drafts[line.id]
        if (!d) continue
        if (d.accepted !== line.accepted) {
          await recordReceiptOp(docId, { line_id: line.id, op_type: 'receiving_correction', qty: d.accepted })
        }
        if (d.defect !== line.defect) {
          await recordReceiptOp(docId, { line_id: line.id, op_type: 'defect_correction', qty: d.defect })
        }
      }
      for (const key of Object.keys(pendingZones)) {
        const sep = key.indexOf(':')
        const kind = key.slice(0, sep) as ZoneKind
        const lid = key.slice(sep + 1)
        const line = lines.find((l) => l.id === lid)
        if (!line || pendingZones[key] === (lineZoneId(line, kind) ?? '')) continue
        await updateReceiptLine(docId, lid, zonePayload(kind, pendingZones[key]))
      }
      await onReload()
      setDrafts({})
      setPendingZones({})
      return true
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Ошибка сохранения')
      return false
    } finally {
      setSavingChanges(false)
    }
  }

  const allDone = lines.length > 0 && lines.every((l) => l.qc_status === 'done')
  const doneLinesCount = lines.filter((l) => l.qc_status === 'done').length

  // «Проверено» в готовности: объём обработки (годен + брак) против фактически прибывшего.
  // Для строк в работе считаем «на лету» от draft, для завершённых — от сохранённого.
  const checkedUnits = lines.reduce((s, l) => {
    const d = getDraft(l)
    return s + (l.qc_status === 'done' ? l.accepted + l.defect : d.accepted + d.defect)
  }, 0)
  const arrivedUnits = lines.reduce((s, l) => s + (l.accepted_qty ?? 0), 0)
  const checkedPct = arrivedUnits > 0 ? Math.floor((checkedUnits / arrivedUnits) * 100) : 0

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
          <button className="btn ghost" onClick={() => setOpsDrawerOpen(true)}>
            <Icon name="layers" size={14} />Журнал
            {ops.length > 0 && <span style={{ marginLeft: 4, opacity: 0.6 }}>({ops.length})</span>}
          </button>
          {isReadonly && (
            <button className="btn ghost" onClick={onReopen} disabled={advancing}>
              <Icon name="arrowLeft" size={14} />Вернуть на проверку
            </button>
          )}
          {!isReadonly && (
            <div className="detail-actions">
              <div className="detail-actions-row">
                {hasUnsavedChanges && (
                  <button className="btn" onClick={() => void handleSaveChanges()} disabled={savingChanges}>
                    <Icon name="save" size={14} />Сохранить изменения
                  </button>
                )}
                <button
                  className="btn primary"
                  onClick={() => { if (!allDone) { setShowBlockHint(true) } else { onAdvance() } }}
                  disabled={advancing}
                >
                  <Icon name="check" size={14} />Завершить проверку
                </button>
              </div>
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

      {saveError && (
        <Alert tone="danger" icon={false} style={{ marginBottom: 16 }}>{saveError}</Alert>
      )}

      {/* Верхняя строка: Основная информация + Готовность */}
      <div className="split-380" style={{ alignItems: 'stretch', marginBottom: 16 }}>
        <Card>
          <CardHead>
            <Icon name="file" size={15} className="ic-accent" />
            <span className="card-head-title">Основная информация</span>
          </CardHead>
          <CardBody>
            <div className="form-grid-2">
              <div>
                <label className="field-label"><span>Клиент</span></label>
                <input className="input" value={doc.client_name ?? '—'} disabled />
              </div>
              <div>
                <label className="field-label"><span>Поставщик</span></label>
                <input className="input" value={doc.supplier_name || '—'} disabled />
              </div>
              <div>
                <label className="field-label"><span>Дата прибытия</span></label>
                <input className="input" value={fmtDate(doc.arrival_date)} disabled />
              </div>
              <div>
                <label className="field-label"><span>Стоимость логистики, ₽</span></label>
                <input className="input" value={doc.logistics_cost.toLocaleString('ru-RU')} disabled />
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHead>
            <Icon name="check" size={15} className="ic-success" />
            <span className="card-head-title">Готовность</span>
          </CardHead>
          <div style={{ padding: '12px 14px 8px', borderBottom: '1px solid var(--c-border)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 7 }}>
              <span style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>Проверено, ед.</span>
              <span style={{ fontSize: 13 }}>
                <b className="mono">{checkedUnits}</b>
                <span style={{ color: 'var(--c-text-subtle)' }}> / {arrivedUnits}</span>
                <span style={{ marginLeft: 8, fontWeight: 600, color: checkedPct >= 100 ? 'var(--c-success)' : 'var(--c-info, #3b82f6)' }}>{checkedPct}%</span>
              </span>
            </div>
            <div className="prog">
              <div className="prog-fill" style={{ width: `${Math.min(100, checkedPct)}%` }} />
            </div>
          </div>
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
      </div>

      {/* Таблица строк — вся ширина */}
      <Card style={{ marginBottom: 16 }}>
        <CardHead>
          <Icon name="boxes" size={15} className="ic-accent" />
          <span className="card-head-title">Товары к приемке</span>
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
          zoneValue={(l, kind) => effectiveZoneId(l, kind)}
          zoneName={(l, kind) => lineZoneName(l, kind)}
          zoneSaving={() => savingChanges}
          onZone={(l, kind, v) => setPendingZone(l.id, kind, v)}
          completing={(l) => (completing[l.id] ?? false) || savingChanges}
          reopening={(l) => reopening[l.id] ?? false}
          lineError={(l) => lineError[l.id]}
          onComplete={(l) => void handleCompleteClick(l)}
          onReopen={(l) => void handleReopen(l.id)}
        />
      </Card>

      <Drawer
        open={opsDrawerOpen}
        onClose={() => setOpsDrawerOpen(false)}
        title="Журнал операций"
        subtitle={`${ops.length} записей · ${doc.doc_number}`}
        width={460}
        footer={
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--c-text-subtle)' }}>
            <Icon name="shield" size={11} />
            <span>Операции не редактируются. Удаление запрещено.</span>
          </div>
        }
      >
        <div style={{ padding: '4px 0 0', display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
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
        {visibleOps.length === 0 ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--c-text-muted)', fontSize: 13 }}>
            {filterLine || filterType ? 'Под фильтр ничего не попало' : 'Нет операций'}
          </div>
        ) : (
          <div className="ops-timeline">
            {visibleOps.map((op) => (
              <OpEntry key={op.id} op={op} onFilterLine={(lid) => setFilterLine(lid)} />
            ))}
          </div>
        )}
      </Drawer>

    </div>
  )
}
