import { useNavigate } from 'react-router-dom'
import { listShipmentLines, SHIPMENT_STATUS_TONES } from '../../../api/shipmentsApi'
import type { ShipmentStatus } from '../../../api/shipmentsApi'
import { Table, Td } from '../../data/Table'
import { Pagination } from '../../data/Pagination'
import { Badge } from '../../primitives/Badge'
import type { BadgeTone } from '../../primitives/Badge'
import { SkeletonRows } from '../../primitives/Skeleton'
import { EmptyState } from '../../primitives/EmptyState'
import { fmtDateShort as fmtDate } from '../../../utils/format'
import { useApi } from '../../../hooks/useApi'

const PAGE_SIZE = 50

type Props = {
  search?:    string
  sku?:       string
  clientId?:  string
  status?:    ShipmentStatus | ShipmentStatus[]
  overdue?:   boolean
  dateFrom?:  string
  dateTo?:    string
  page:       number
  onPage:     (p: number) => void
}

export function ShipmentLinesView({ search, sku, clientId, status, overdue, dateFrom, dateTo, page, onPage }: Props) {
  const navigate = useNavigate()
  const statusKey = Array.isArray(status) ? status.join(',') : (status ?? '')

  const { data, loading } = useApi(
    (signal) => listShipmentLines({
      page, limit: PAGE_SIZE,
      search: search?.trim() || undefined,
      sku: sku?.trim() || undefined,
      client_id: clientId || undefined,
      status,
      overdue: overdue || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }, signal),
    [page, search, sku, clientId, statusKey, overdue, dateFrom, dateTo],
  )

  const items = data?.items ?? []
  const total = data?.total ?? 0

  return (
    <>
      <Table>
        <thead>
          <tr>
            <th style={{ width: 120 }}>Номер</th>
            <th>Клиент</th>
            <th>Товар</th>
            <th style={{ width: 150 }}>Магазин</th>
            <th style={{ width: 140 }}>Цвет / Размер</th>
            <th style={{ width: 110 }}>Дата отгрузки</th>
            <th style={{ textAlign: 'right', width: 80 }}>План</th>
            <th style={{ textAlign: 'right', width: 80 }}>Факт</th>
            <th style={{ width: 140 }}>Место</th>
            <th style={{ width: 130 }}>Статус</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <SkeletonRows rows={10} cols={10} />
          ) : items.length === 0 ? (
            <tr><td colSpan={10}>
              <EmptyState title="Товаров нет" sub="Измените фильтры или создайте отгрузку" />
            </td></tr>
          ) : (
            items.map((it) => (
              <tr
                key={it.line_id}
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/inventory/shipments/${it.doc_id}`)}
              >
                <Td className="mono" style={{ fontWeight: 500 }}>{it.doc_number}</Td>
                <Td>{it.client_name ?? '—'}</Td>
                <Td>
                  <div style={{ fontWeight: 500 }}>{it.product_name}</div>
                  <div className="mono t-sub" style={{ fontSize: 11.5 }}>{it.product_sku}</div>
                </Td>
                <Td className="t-sub">{it.store_name ?? '—'}</Td>
                <Td className="t-sub">
                  {[it.color_name, it.size_name].filter(Boolean).join(' / ') || '—'}
                </Td>
                <Td className="mono">{fmtDate(it.ship_date)}</Td>
                <Td className="num">{it.qty.toLocaleString('ru-RU')}</Td>
                <Td className="num">{it.shipped_qty.toLocaleString('ru-RU')}</Td>
                <Td className="t-sub">{it.storage_zone_name ?? '—'}</Td>
                <Td>
                  <Badge tone={SHIPMENT_STATUS_TONES[it.status] as BadgeTone} dot>
                    {it.status_label}
                  </Badge>
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
