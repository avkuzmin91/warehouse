import { getCabinetReceipt, CABINET_RECEIPT_STATUS_LABELS, cabinetReceiptStatusTone } from '../../../api/cabinetApi'
import { useApi } from '../../../hooks/useApi'
import { Table, Td } from '../../data/Table'
import { DetailPage } from '../../layouts/DetailPage'
import { Badge } from '../../primitives/Badge'
import type { BadgeTone } from '../../primitives/Badge'
import { EmptyState } from '../../primitives/EmptyState'
import { SkeletonRows } from '../../primitives/Skeleton'
import { fmtDate, fmtDateTime } from '../../../utils/format'

interface Props {
  docId: string
}

export function CabinetReceiptDetailFeature({ docId }: Props) {
  const { data, loading, error } = useApi((signal) => getCabinetReceipt(docId, signal), [docId])

  if (error) {
    return (
      <DetailPage title="Поступление" backTo="/cabinet/receipts">
        <EmptyState title="Документ недоступен" sub={error.message} />
      </DetailPage>
    )
  }

  const doc = data?.doc
  const shortfall = doc?.status === 'done' && (data?.totals.total_accepted ?? 0) < (data?.totals.total_planned ?? 0)

  return (
    <DetailPage
      title={doc ? `Поступление ${doc.doc_number}` : 'Поступление'}
      backTo="/cabinet/receipts"
      actions={doc && (
        <Badge tone={cabinetReceiptStatusTone(doc.status) as BadgeTone} dot>
          {CABINET_RECEIPT_STATUS_LABELS[doc.status]}
        </Badge>
      )}
    >
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14 }}>
          <div>
            <div className="t-sub">Дата прибытия (план)</div>
            <div style={{ fontWeight: 500 }}>{fmtDate(doc?.arrival_date ?? null)}</div>
          </div>
          <div>
            <div className="t-sub">Дата прибытия (факт)</div>
            <div style={{ fontWeight: 500 }}>{fmtDate(doc?.actual_arrival_date ?? null)}</div>
          </div>
          <div>
            <div className="t-sub">ТТН</div>
            <div className="mono" style={{ fontWeight: 500 }}>{doc?.ttn || '—'}</div>
          </div>
          <div>
            <div className="t-sub">План, шт.</div>
            <div className="num" style={{ fontWeight: 500 }}>{(data?.totals.total_planned ?? 0).toLocaleString('ru-RU')}</div>
          </div>
          <div>
            <div className="t-sub">Принято, шт.</div>
            <div className="num" style={{ fontWeight: 500, color: shortfall ? 'var(--c-warning)' : undefined }}>
              {(data?.totals.total_accepted ?? 0).toLocaleString('ru-RU')}
              {shortfall && <span style={{ fontSize: 11, marginLeft: 6 }}>расхождение</span>}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        <section>
          <div className="card-head" style={{ marginBottom: 8 }}>
            <span className="card-head-title">Товары</span>
          </div>
          <Table>
            <thead>
              <tr>
                <th>Товар</th>
                <th style={{ width: 90, textAlign: 'right' }}>План</th>
                <th style={{ width: 90, textAlign: 'right' }}>Принято</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={4} cols={3} />
              ) : (data?.lines ?? []).length === 0 ? (
                <tr><Td colSpan={3}><EmptyState title="Строк нет" /></Td></tr>
              ) : (
                (data?.lines ?? []).map((l, index) => {
                  const lineShortfall = doc?.status === 'done' && (l.accepted_qty ?? 0) < l.planned_qty
                  return (
                    <tr key={index} style={lineShortfall ? { background: 'color-mix(in oklab, var(--c-warning) 6%, transparent)' } : undefined}>
                      <Td>
                        <div style={{ fontWeight: 500 }}>{l.product_name}</div>
                        <div className="t-sub mono">
                          {[l.product_sku, l.color_name, l.size_name].filter(Boolean).join(' · ')}
                        </div>
                      </Td>
                      <Td className="num">{l.planned_qty.toLocaleString('ru-RU')}</Td>
                      <Td className="num" style={lineShortfall ? { color: 'var(--c-warning)', fontWeight: 600 } : undefined}>
                        {l.accepted_qty != null ? l.accepted_qty.toLocaleString('ru-RU') : '—'}
                      </Td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </Table>
        </section>

        <section>
          <div className="card-head" style={{ marginBottom: 8 }}>
            <span className="card-head-title">События</span>
          </div>
          <div className="card" style={{ padding: 12 }}>
            {loading ? (
              <div className="t-sub">Загрузка…</div>
            ) : (data?.ops ?? []).length === 0 ? (
              <div className="t-sub">Событий пока нет</div>
            ) : (
              (data?.ops ?? []).map((op, index) => (
                <div key={index} style={{ padding: '6px 0', borderBottom: index < (data?.ops.length ?? 0) - 1 ? '1px solid var(--c-border)' : 'none' }}>
                  <div style={{ fontSize: 13 }}>{op.comment || op.op_type}</div>
                  <div className="t-sub" style={{ fontSize: 11 }}>{fmtDateTime(op.created_at)}</div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </DetailPage>
  )
}
