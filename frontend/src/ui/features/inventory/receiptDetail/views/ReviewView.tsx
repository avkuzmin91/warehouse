import { useState } from 'react'
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
import { Icon } from '../../../../primitives/Icon'
import { Drawer } from '../../../../feedback/Drawer'
import { ReadOnlyField } from '../../../inventory/shared/ReadOnlyField'
import { fmtDate } from '../../../../../utils/format'
import { canViewCosts } from '../../../../../utils/access'
import { useCurrentUser } from '../../../../../hooks/useCurrentUser'
import { useBackNav } from '../../../../../hooks/useBackNav'
import { PhaseBlock } from '../../../shared/process/PhaseBlock'
import { DocHeader } from '../../../shared/process/DocHeader'
import { Panel, ReadRow } from '../../../shared/process/processUI'
import { receiptStatusRole } from '../shared/receiptProcess'
import { OpEntry } from '../components/OpEntry'
import { ReceiptLinesTable } from '../components/ReceiptLinesTable'
import { ReceiptRailPanel } from '../components/ReceiptRailPanel'

type Props = {
  detail: ReceiptDetail
  onCloseShort?: () => void
  onExpectRedelivery?: () => void
  advancing: boolean
}

// Поступление завершается на приёмке (done): товар встал на остатки годным «На хранении».
// Брак фиксируется позже при упаковке отгрузки. Вью — только просмотр; для частично
// принятого менеджер может закрыть его с недопоставкой.
export function ReviewView({ detail, onCloseShort, onExpectRedelivery, advancing }: Props) {
  const navigate = useNavigate()
  const goBack = useBackNav('/inventory/receipts')
  const { doc, lines, ops } = detail

  const [filterLine, setFilterLine] = useState<string | null>(null)
  const [filterType, setFilterType] = useState<string | null>(null)
  const [opsDrawerOpen, setOpsDrawerOpen] = useState(false)

  const { user } = useCurrentUser()
  const showCosts = canViewCosts(user)
  const canManage = user?.role === 'admin' || user?.role === 'manager'
  const canCloseShort = canManage && detail.can_close_short && !!onCloseShort
  const canExpectRedelivery = canManage && detail.can_close_short && !!onExpectRedelivery

  const isCancelled = doc.status === 'cancelled'
  const plannedUnits = lines.reduce((s, l) => s + l.planned_qty, 0)
  const arrivedUnits = lines.reduce((s, l) => s + (l.accepted_qty ?? 0), 0)
  const acceptedPct = plannedUnits > 0 ? Math.floor((arrivedUnits / plannedUnits) * 100) : 0
  const shortageUnits = Math.max(0, plannedUnits - arrivedUnits)
  // Недостача показывается только после прибытия всех рейсов: завершённый документ
  // (в т.ч. закрытый с недопоставкой) или гейт close-short (рейсы кончились, привезли
  // меньше плана). Пока рейсы ещё едут — недовоз не финальный, недостачу не пишем.
  const shortageFinal = doc.status === 'done' || detail.can_close_short

  const visibleOps = ops.filter((op) => {
    if (filterLine && op.line_id !== filterLine) return false
    if (filterType && op.op_type !== filterType) return false
    return true
  })

  return (
    <div className="page">
      <DocHeader
        badges={
          <Badge tone={receiptStatusTone(doc.status) as BadgeTone} dot>
            {RECEIPT_STATUS_LABELS[doc.status]}
          </Badge>
        }
        role={receiptStatusRole(doc.status)}
        title={doc.doc_number}
        subtitle={`Поступление · ${doc.client_name ?? '—'}`}
        initiator={{ name: doc.created_by_name, createdAt: doc.created_at }}
        onBack={goBack}
        actions={
          <>
            <button className="btn ghost" onClick={() => setOpsDrawerOpen(true)}>
              <Icon name="layers" size={14} />Журнал
              {ops.length > 0 && <span style={{ marginLeft: 4, opacity: 0.6 }}>({ops.length})</span>}
            </button>
            {canExpectRedelivery && (
              <button className="btn ghost" onClick={onExpectRedelivery} disabled={advancing}>
                <Icon name="truckIn" size={14} />Ожидается довоз
              </button>
            )}
            {canCloseShort && (
              <button className="btn primary" onClick={onCloseShort} disabled={advancing}>
                <Icon name="check" size={14} />Закрыть с недопоставкой
              </button>
            )}
          </>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 332px', gap: 18, alignItems: 'start' }}>
        {/* Left — фазы */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <PhaseBlock icon="file" title="Основная информация" role="manager" state="done">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <ReadOnlyField label="Клиент" value={doc.client_name} />
              <div>
                <div className="field-label"><span>{doc.trips.length > 1 ? 'Рейсы' : 'Рейс'}</span></div>
                {doc.trips.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {doc.trips.map((t) => (
                      <button key={t.id} className="btn ghost sm" onClick={() => navigate(`/logistics/trips/${t.id}`)}
                        style={{ width: '100%', justifyContent: 'flex-start' }}>
                        <Icon name="truckIn" size={13} />{t.number}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 13, fontWeight: 500, minHeight: 30, display: 'flex', alignItems: 'center' }}>—</div>
                )}
              </div>
              <ReadOnlyField label="Дата прибытия (план)" value={fmtDate(doc.arrival_date)} />
              <ReadOnlyField label="Дата прибытия (факт)" value={fmtDate(doc.actual_arrival_date)} />
              {showCosts && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <ReadOnlyField
                    label="Стоимость логистики для клиента, ₽"
                    value={doc.logistics_cost != null ? doc.logistics_cost.toLocaleString('ru-RU') : null}
                    mono
                  />
                </div>
              )}
              <div style={{ gridColumn: '1 / -1' }}>
                <ReadOnlyField label="Комментарий" value={doc.comment} multiline />
              </div>
            </div>
          </PhaseBlock>

          <PhaseBlock
            icon="forklift"
            title={isCancelled ? 'Товары к приёмке' : 'Принятые товары'}
            role="warehouse"
            state="done"
          >
            <ReceiptLinesTable stage="review" lines={lines} />
          </PhaseBlock>
        </div>

        {/* Right — маршрут + итог приёмки */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <ReceiptRailPanel status={doc.status} ops={ops} />

          {!isCancelled && (
            <Panel icon="chart" title="Итог приёмки">
              <div style={{ padding: '0 2px' }}>
                <ReadRow label="План" mono>{plannedUnits} шт</ReadRow>
                <ReadRow label="Принято" mono strong>
                  <span style={{ color: 'var(--c-success)' }}>{arrivedUnits} шт</span>
                </ReadRow>
                <ReadRow label="Выполнение" mono>
                  <span style={{ color: acceptedPct >= 100 ? 'var(--c-success)' : 'var(--c-info)' }}>{acceptedPct}%</span>
                </ReadRow>
                {shortageFinal && shortageUnits > 0 && (
                  <ReadRow label="Недостача" mono strong>
                    <span style={{ color: 'var(--c-danger)' }}>{shortageUnits} шт</span>
                  </ReadRow>
                )}
              </div>
              <div className="prog" style={{ marginTop: 6 }}>
                <div className="prog-fill" style={{ width: `${Math.min(100, acceptedPct)}%` }} />
              </div>
              {!shortageFinal && shortageUnits > 0 ? (
                <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--c-text-subtle)', lineHeight: 1.5 }}>
                  Ожидаются рейсы — недостача определится после прибытия всех.
                </div>
              ) : (
                <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--c-text-subtle)', lineHeight: 1.5 }}>
                  Товар принят и числится годным «На хранении». Брак фиксируется при упаковке отгрузки.
                </div>
              )}
            </Panel>
          )}
        </div>
      </div>

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
