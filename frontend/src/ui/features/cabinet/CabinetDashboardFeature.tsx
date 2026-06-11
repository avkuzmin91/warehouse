import { useNavigate } from 'react-router-dom'
import {
  CABINET_RECEIPT_STATUS_LABELS,
  cabinetReceiptStatusTone,
  cabinetShipmentStatusLabel,
  cabinetShipmentStatusTone,
  getCabinetSummary,
} from '../../../api/cabinetApi'
import { useApi } from '../../../hooks/useApi'
import { ListPage } from '../../layouts/ListPage'
import { Badge } from '../../primitives/Badge'
import type { BadgeTone } from '../../primitives/Badge'
import { EmptyState } from '../../primitives/EmptyState'
import { Icon } from '../../primitives/Icon'
import { KPI } from '../../primitives/KPI'
import { fmtDate, fmtDateTime } from '../../../utils/format'

export function CabinetDashboardFeature() {
  const navigate = useNavigate()
  const { data, loading, error } = useApi((signal) => getCabinetSummary(signal), [])

  if (error) {
    return (
      <ListPage title="Личный кабинет">
        <EmptyState title="Не удалось загрузить сводку" sub={error.message} />
      </ListPage>
    )
  }

  const totals = data?.totals
  const receipts = data?.active_receipts ?? []
  const shipments = data?.active_shipments ?? []
  const events = data?.events ?? []
  const inWork = (totals?.packing_good ?? 0) + (totals?.ready_good ?? 0)

  return (
    <ListPage
      title="Личный кабинет"
      subtitle="Сводка по вашим товарам и документам"
      actions={
        <>
          <button className="btn ghost sm" onClick={() => navigate('/cabinet/balances')}>
            <Icon name="boxes" size={14} />Остатки
          </button>
          <button className="btn primary sm" onClick={() => navigate('/cabinet/shipments')}>
            <Icon name="boxOut" size={14} />Отгрузки
          </button>
        </>
      }
    >
      <div className="kpi-grid" style={{ marginBottom: 20 }}>
        <KPI
          label="Годный на складе"
          value={loading ? '…' : (totals?.total_good ?? 0).toLocaleString('ru-RU')}
          unit="шт"
        />
        <KPI
          label="Доступно к отгрузке"
          value={loading ? '…' : (totals?.storage_good ?? 0).toLocaleString('ru-RU')}
          valueColor="var(--c-success)"
          unit="шт"
        />
        <KPI
          label="В упаковке и готово"
          value={loading ? '…' : inWork.toLocaleString('ru-RU')}
          valueColor="var(--c-accent)"
          unit="шт"
        />
        <KPI
          label="Брак"
          value={loading ? '…' : (totals?.defect_total ?? 0).toLocaleString('ru-RU')}
          valueColor="var(--c-warning)"
          unit="шт"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'start' }}>
        <section>
          <div className="card-head" style={{ marginBottom: 8 }}>
            <Icon name="clock" size={15} className="ic-accent" />
            <span className="card-head-title">Сейчас в работе</span>
          </div>
          <div className="card" style={{ padding: 12 }}>
            {loading ? (
              <div className="t-sub">Загрузка…</div>
            ) : receipts.length === 0 && shipments.length === 0 ? (
              <div className="t-sub">Активных документов нет</div>
            ) : (
              <>
                {receipts.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => navigate(`/cabinet/receipts/${item.id}`)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--c-border)', cursor: 'pointer' }}
                  >
                    <Icon name="dolly" size={14} style={{ color: 'var(--c-text-subtle)' }} />
                    <span className="mono" style={{ fontWeight: 500 }}>{item.doc_number}</span>
                    <span className="t-sub" style={{ fontSize: 12 }}>
                      {item.arrival_date ? fmtDate(item.arrival_date) : ''}
                    </span>
                    <div className="flex-1" />
                    <Badge tone={cabinetReceiptStatusTone(item.status) as BadgeTone} dot>
                      {CABINET_RECEIPT_STATUS_LABELS[item.status]}
                    </Badge>
                  </div>
                ))}
                {shipments.map((item, index) => (
                  <div
                    key={item.id}
                    onClick={() => navigate(`/cabinet/shipments/${item.id}`)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: index < shipments.length - 1 ? '1px solid var(--c-border)' : 'none', cursor: 'pointer' }}
                  >
                    <Icon name="boxOut" size={14} style={{ color: 'var(--c-text-subtle)' }} />
                    <span className="mono" style={{ fontWeight: 500 }}>{item.doc_number}</span>
                    <span className="t-sub" style={{ fontSize: 12 }}>
                      {item.total_packed_qty > 0 ? `${item.total_packed_qty.toLocaleString('ru-RU')} из ${item.total_qty.toLocaleString('ru-RU')} шт.` : `${item.total_qty.toLocaleString('ru-RU')} шт.`}
                    </span>
                    <div className="flex-1" />
                    <Badge tone={cabinetShipmentStatusTone(item.status) as BadgeTone} dot>
                      {cabinetShipmentStatusLabel(item.status, item.cargo_type)}
                    </Badge>
                  </div>
                ))}
              </>
            )}
          </div>
        </section>

        <section>
          <div className="card-head" style={{ marginBottom: 8 }}>
            <Icon name="pulse" size={15} className="ic-accent" />
            <span className="card-head-title">Последние события</span>
          </div>
          <div className="card" style={{ padding: 12 }}>
            {loading ? (
              <div className="t-sub">Загрузка…</div>
            ) : events.length === 0 ? (
              <div className="t-sub">Событий пока нет</div>
            ) : (
              events.map((e, index) => (
                <div
                  key={`${e.doc_id}-${index}`}
                  onClick={() => navigate(e.doc_kind === 'receipt' ? `/cabinet/receipts/${e.doc_id}` : `/cabinet/shipments/${e.doc_id}`)}
                  style={{ padding: '6px 0', borderBottom: index < events.length - 1 ? '1px solid var(--c-border)' : 'none', cursor: 'pointer' }}
                >
                  <div style={{ fontSize: 13 }}>
                    <span className="mono" style={{ fontWeight: 500 }}>{e.doc_number}</span>
                    {' — '}
                    {e.comment || e.op_type}
                  </div>
                  <div className="t-sub" style={{ fontSize: 11 }}>{fmtDateTime(e.created_at)}</div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </ListPage>
  )
}
