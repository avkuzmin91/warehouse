import { getCabinetReceipt, CABINET_RECEIPT_STATUS_LABELS, cabinetReceiptStatusTone } from '../../../api/cabinetApi'
import { useApi } from '../../../hooks/useApi'
import { Table, Td } from '../../data/Table'
import { DetailPage } from '../../layouts/DetailPage'
import { Badge } from '../../primitives/Badge'
import type { BadgeTone } from '../../primitives/Badge'
import { EmptyState } from '../../primitives/EmptyState'
import { Icon } from '../../primitives/Icon'
import { SkeletonRows } from '../../primitives/Skeleton'
import { fmtDate } from '../../../utils/format'
import { CabinetTimeline, CabinetTrack, CellProg, cabinetOpTone, cabinetReceiptTrack } from './shared/cabinetUI'

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
  const totals = data?.totals
  const shortfall = doc?.status === 'done' && (totals?.total_accepted ?? 0) < (totals?.total_planned ?? 0)
  const track = doc ? cabinetReceiptTrack(doc.status) : null

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
      <div className="card" style={{ padding: '18px 22px', marginBottom: 16 }}>
        {track && <CabinetTrack {...track} />}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 16,
          ...(track ? { marginTop: 20, paddingTop: 18, borderTop: '1px solid var(--c-border)' } : {}),
        }}>
          <div>
            <div className="t-sub">Дата прибытия (план)</div>
            <div className="dt" style={{ fontWeight: 500, color: 'var(--c-text)' }}>{fmtDate(doc?.arrival_date ?? null)}</div>
          </div>
          <div>
            <div className="t-sub">Дата прибытия (факт)</div>
            {doc?.actual_arrival_date
              ? <div className="dt" style={{ fontWeight: 500, color: 'var(--c-text)' }}>{fmtDate(doc.actual_arrival_date)}</div>
              : <div className="dash" style={{ fontWeight: 500 }}>—</div>}
          </div>
          <div>
            <div className="t-sub">ТТН</div>
            <div className="mono" style={{ fontWeight: 500 }}>{doc?.ttn || '—'}</div>
          </div>
          <div>
            <div className="t-sub">План, шт</div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{(totals?.total_planned ?? 0).toLocaleString('ru-RU')}</div>
          </div>
          <div>
            <div className="t-sub">Принято, шт</div>
            <div style={{ fontWeight: 600, fontSize: 15, color: shortfall ? 'var(--c-warning)' : doc?.status === 'done' ? 'var(--c-success)' : undefined }}>
              {(totals?.total_accepted ?? 0).toLocaleString('ru-RU')}
              {shortfall && (
                <span className="short-flag" style={{ marginLeft: 8 }}>
                  <Icon name="alert" size={11} />расхождение −{((totals?.total_planned ?? 0) - (totals?.total_accepted ?? 0)).toLocaleString('ru-RU')}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="split-360" style={{ gridTemplateColumns: '1fr 340px' }}>
        <section>
          <Table>
            <thead>
              <tr>
                <th>Товар</th>
                <th style={{ width: 90, textAlign: 'right' }}>План</th>
                <th style={{ width: 200, textAlign: 'right' }}>Принято</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={4} cols={3} />
              ) : (data?.lines ?? []).length === 0 ? (
                <tr><Td colSpan={3}><EmptyState title="Строк нет" /></Td></tr>
              ) : (
                (data?.lines ?? []).map((l, index) => {
                  const lineShort = doc?.status === 'done' && (l.accepted_qty ?? 0) < l.planned_qty
                  return (
                    <tr key={index} style={lineShort ? { background: 'color-mix(in oklab, var(--c-warning) 6%, transparent)' } : undefined}>
                      <Td>
                        <div style={{ fontWeight: 500 }}>{l.product_name}</div>
                        <div className="t-sub mono">
                          {[l.product_sku, l.color_name, l.size_name].filter(Boolean).join(' · ')}
                        </div>
                      </Td>
                      <Td className="num">{l.planned_qty.toLocaleString('ru-RU')}</Td>
                      <Td className="num">
                        <div className="cellprog">
                          <span style={{ fontWeight: lineShort ? 600 : 500, color: lineShort ? 'var(--c-warning)' : undefined }}>
                            {l.accepted_qty != null ? l.accepted_qty.toLocaleString('ru-RU') : '—'}
                            {lineShort && <span style={{ fontSize: 11 }}> (−{(l.planned_qty - (l.accepted_qty ?? 0)).toLocaleString('ru-RU')})</span>}
                          </span>
                          {l.accepted_qty != null && (
                            <CellProg
                              value={l.accepted_qty}
                              max={l.planned_qty}
                              color={lineShort ? 'var(--c-warning)' : 'var(--c-success)'}
                            />
                          )}
                        </div>
                      </Td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </Table>
        </section>

        <section className="card" style={{ padding: '12px 16px' }}>
          <div className="row gap-8" style={{ marginBottom: 4 }}>
            <Icon name="pulse" size={14} className="ic-accent" />
            <span className="card-head-title">История</span>
          </div>
          {loading ? (
            <div className="t-sub">Загрузка…</div>
          ) : (data?.ops ?? []).length === 0 ? (
            <div className="t-sub" style={{ padding: '6px 0' }}>Событий пока нет</div>
          ) : (
            <CabinetTimeline
              items={(data?.ops ?? []).map((op) => ({
                text: op.comment || op.op_type,
                createdAt: op.created_at,
                tone: cabinetOpTone(op.op_type),
              }))}
            />
          )}
        </section>
      </div>
    </DetailPage>
  )
}
