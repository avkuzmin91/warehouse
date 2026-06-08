import { useNavigate } from 'react-router-dom'
import { getReceiptLines, RECEIPT_STATUS_LABELS, receiptStatusTone } from '../../../api/receiptsApi'
import type { ReceiptStatus } from '../../../api/receiptsApi'
import { Table, Td } from '../../data/Table'
import { Pagination } from '../../data/Pagination'
import { Badge } from '../../primitives/Badge'
import type { BadgeTone } from '../../primitives/Badge'
import { SkeletonRows } from '../../primitives/Skeleton'
import { EmptyState } from '../../primitives/EmptyState'
import { fmtDate } from '../../../utils/format'
import { useApi } from '../../../hooks/useApi'

const PAGE_SIZE = 50

type Props = {
  search?:    string
  sku?:       string
  clientId?:  string
  status?:    ReceiptStatus
  overdue?:   boolean
  dateFrom?:  string
  dateTo?:    string
  page:       number
  onPage:     (p: number) => void
}

export function ReceiptLinesView({ search, sku, clientId, status, overdue, dateFrom, dateTo, page, onPage }: Props) {
  const navigate = useNavigate()

  const { data, loading } = useApi(
    (signal) => getReceiptLines({
      page, limit: PAGE_SIZE,
      search: search?.trim() || undefined,
      sku: sku?.trim() || undefined,
      client_id: clientId || undefined,
      status,
      overdue: overdue || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }, signal),
    [page, search, sku, clientId, status ?? '', overdue, dateFrom, dateTo],
  )

  const items = data?.items ?? []
  const total = data?.total ?? 0

  return (
    <>
      <Table>
        <thead>
          <tr>
            <th style={{ width: 150 }}>Номер</th>
            <th>Клиент</th>
            <th>Товар</th>
            <th style={{ width: 140 }}>Цвет / Размер</th>
            <th style={{ width: 120 }}>Дата прибытия</th>
            <th style={{ textAlign: 'right', width: 80 }}>План</th>
            <th style={{ textAlign: 'right', width: 80 }}>Факт</th>
            <th style={{ width: 140 }}>Место</th>
            <th style={{ width: 130 }}>Статус</th>
            <th style={{ width: 160 }}>Принято</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <SkeletonRows rows={10} cols={10} />
          ) : items.length === 0 ? (
            <tr><td colSpan={10}>
              <EmptyState title="Товаров нет" sub="Измените фильтры или создайте поступление" />
            </td></tr>
          ) : (
            items.map((it) => (
              <tr
                key={it.line_id}
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/inventory/receipts/${it.doc_id}`)}
              >
                <Td className="mono" style={{ fontWeight: 500 }}>{it.doc_number}</Td>
                <Td>{it.client_name ?? '—'}</Td>
                <Td>
                  <div style={{ fontWeight: 500 }}>{it.product_name}</div>
                  <div className="mono t-sub" style={{ fontSize: 11.5 }}>{it.product_sku}</div>
                </Td>
                <Td className="t-sub">
                  {[it.color_name, it.size_name].filter(Boolean).join(' / ') || '—'}
                </Td>
                <Td className="mono">{fmtDate(it.actual_arrival_date ?? it.arrival_date)}</Td>
                <Td className="num">{it.planned_qty.toLocaleString('ru-RU')}</Td>
                <Td className="num">{it.accepted_qty != null ? it.accepted_qty.toLocaleString('ru-RU') : '—'}</Td>
                <Td className="t-sub">{it.storage_zone_name ?? '—'}</Td>
                <Td>
                  <Badge tone={receiptStatusTone(it.status) as BadgeTone} dot>
                    {RECEIPT_STATUS_LABELS[it.status]}
                  </Badge>
                </Td>
                <Td>
                  {(() => {
                    const accepted = it.accepted_qty ?? 0
                    const pct = it.planned_qty > 0 ? Math.min(100, Math.round(accepted / it.planned_qty * 100)) : 0
                    if (it.status !== 'done') return <span style={{ color: 'var(--c-text-faint)', fontSize: 12 }}>—</span>
                    return (
                      <div style={{ minWidth: 120 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ flex: 1, height: 5, borderRadius: 3, background: 'var(--c-border-strong)', overflow: 'hidden' }}>
                            <div style={{
                              height: '100%', borderRadius: 3,
                              width: `${pct}%`,
                              background: pct === 100 ? 'var(--c-success)' : 'var(--c-accent)',
                              transition: 'width 0.3s',
                            }} />
                          </div>
                          <span style={{ fontSize: 11.5, fontWeight: 600, color: pct === 100 ? 'var(--c-success)' : 'var(--c-text-muted)', fontVariantNumeric: 'tabular-nums', minWidth: 30, textAlign: 'right' }}>
                            {pct}%
                          </span>
                        </div>
                      </div>
                    )
                  })()}
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={onPage} />
    </>
  )
}
