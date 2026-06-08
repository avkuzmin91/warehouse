import { useState } from 'react'
import type React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  RECEIPT_OP_LABELS,
  RECEIPT_STATUS_LABELS,
  receiptStatusTone,
} from '../../../../../api/receiptsApi'
import type { ReceiptDetail } from '../../../../../api/receiptsApi'
import { FilterChip } from '../../../../data/FiltersBar'
import { Badge } from '../../../../primitives/Badge'
import type { BadgeTone } from '../../../../primitives/Badge'
import { Card, CardBody, CardHead } from '../../../../primitives/Card'
import { Icon } from '../../../../primitives/Icon'
import { Drawer } from '../../../../feedback/Drawer'
import { fmtDate } from '../../../../../utils/format'
import { canViewCosts } from '../../../../../utils/access'
import { useCurrentUser } from '../../../../../hooks/useCurrentUser'
import { ReceiptStepper } from '../../ReceiptStepper'
import { OpEntry } from '../components/OpEntry'
import { ReceiptLinesTable } from '../components/ReceiptLinesTable'

type Props = {
  docId: string
  detail: ReceiptDetail
  onReload: () => Promise<void>
  onAdvance: () => void
  advancing: boolean
}

// Поступление завершается на приёмке (done): товар попал в остаток «на проверке».
// Годность/брак определяются позже при упаковке отгрузки. Вью — только просмотр.
export function ReviewView({ detail }: Props) {
  const navigate = useNavigate()
  const { doc, lines, ops } = detail

  const [filterLine, setFilterLine] = useState<string | null>(null)
  const [filterType, setFilterType] = useState<string | null>(null)
  const [opsDrawerOpen, setOpsDrawerOpen] = useState(false)

  const { user } = useCurrentUser()
  const showCosts = canViewCosts(user)

  const plannedUnits = lines.reduce((s, l) => s + l.planned_qty, 0)
  const arrivedUnits = lines.reduce((s, l) => s + (l.accepted_qty ?? 0), 0)
  const acceptedPct = plannedUnits > 0 ? Math.floor((arrivedUnits / plannedUnits) * 100) : 0

  const visibleOps = ops.filter((op) => {
    if (filterLine && op.line_id !== filterLine) return false
    if (filterType && op.op_type !== filterType) return false
    return true
  })

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
        </div>
      </div>

      <ReceiptStepper status={doc.status} ops={ops} />

      <div className="split-380" style={{ alignItems: 'stretch', marginBottom: 16 }}>
        <Card>
          <CardHead>
            <Icon name="file" size={15} className="ic-accent" />
            <span className="card-head-title">Основная информация</span>
          </CardHead>
          <CardBody>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <ReadOnlyInputField label="Клиент" value={doc.client_name} />
              <div>
                <div className="field-label"><span>Рейс</span></div>
                {doc.trip_id ? (
                  <button className="btn ghost sm" onClick={() => navigate(`/logistics/trips/${doc.trip_id}`)}
                    style={{ width: '100%', justifyContent: 'flex-start' }}>
                    <Icon name="truckIn" size={13} />{doc.trip_number}
                  </button>
                ) : (
                  <input className="input" value="—" readOnly style={{ cursor: 'default' }} />
                )}
              </div>
              <ReadOnlyInputField label="Дата прибытия (план)" value={fmtDate(doc.arrival_date)} />
              <ReadOnlyInputField label="Дата прибытия (факт)" value={fmtDate(doc.actual_arrival_date)} />
              {showCosts && (
                <ReadOnlyInputField label="Стоимость логистики для клиента, ₽" value={doc.logistics_cost != null ? doc.logistics_cost.toLocaleString('ru-RU') : null} mono />
              )}
              <div style={{ gridColumn: '1 / -1' }}>
                <div className="field-label"><span>Комментарий</span></div>
                <div style={{ fontSize: 13, fontWeight: 500, minHeight: 30, whiteSpace: 'pre-wrap' }}>
                  {doc.comment || '—'}
                </div>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHead>
            <Icon name="check" size={15} className="ic-success" />
            <span className="card-head-title">Принято</span>
          </CardHead>
          <div style={{ padding: '12px 14px 8px', borderBottom: '1px solid var(--c-border)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 7 }}>
              <span style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>Принято, ед.</span>
              <span style={{ fontSize: 13 }}>
                <b className="mono">{arrivedUnits}</b>
                <span style={{ color: 'var(--c-text-subtle)' }}> / {plannedUnits}</span>
                <span style={{ marginLeft: 8, fontWeight: 600, color: acceptedPct >= 100 ? 'var(--c-success)' : 'var(--c-info, #3b82f6)' }}>{acceptedPct}%</span>
              </span>
            </div>
            <div className="prog">
              <div className="prog-fill" style={{ width: `${Math.min(100, acceptedPct)}%` }} />
            </div>
          </div>
          <div style={{ padding: '12px 14px', fontSize: 12.5, color: 'var(--c-text-subtle)' }}>
            Товар принят и числится «на проверке». Годный/брак определяются при упаковке отгрузки.
          </div>
        </Card>
      </div>

      <Card style={{ marginBottom: 16 }}>
        <CardHead>
          <Icon name="boxes" size={15} className="ic-accent" />
          <span className="card-head-title">Принятые товары</span>
          <Badge tone="accent" style={{ marginLeft: 6 } as React.CSSProperties}>{lines.length}</Badge>
        </CardHead>
        <ReceiptLinesTable stage="review" lines={lines} />
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

function ReadOnlyInputField({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div>
      <div className="field-label"><span>{label}</span></div>
      <input
        className={`input ${mono ? 'mono' : ''}`}
        value={value || '—'}
        readOnly
        style={{ cursor: 'default' }}
      />
    </div>
  )
}
