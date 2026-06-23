import { Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { listDispatchLines, DISPATCH_STATUS_TONES } from '../../../api/dispatchApi'
import type { DispatchCargoType, DispatchStatus, DispatchLinesListItem } from '../../../api/dispatchApi'
import { Table, Td } from '../../data/Table'
import { Pagination } from '../../data/Pagination'
import { Badge } from '../../primitives/Badge'
import type { BadgeTone } from '../../primitives/Badge'
import { SkeletonRows } from '../../primitives/Skeleton'
import { EmptyState } from '../../primitives/EmptyState'
import { Icon } from '../../primitives/Icon'
import { fmtDateShort as fmtDate, dayGroupKey, dayGroupLabel } from '../../../utils/format'
import { useApi } from '../../../hooks/useApi'

const PAGE_SIZE = 50

/** Группировка строк товаров по дате отгрузки с сохранением порядка выдачи backend. */
function groupLinesByDay(items: DispatchLinesListItem[]) {
  const groups: { key: string; label: string; rows: DispatchLinesListItem[] }[] = []
  for (const it of items) {
    const key = dayGroupKey(it.ship_date)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.rows.push(it)
    else groups.push({ key, label: dayGroupLabel(it.ship_date), rows: [it] })
  }
  return groups
}

type Props = {
  search?:    string
  sku?:       string
  clientId?:  string
  status?:    DispatchStatus
  cargoType?: DispatchCargoType
  dateFrom?:  string
  dateTo?:    string
  page:       number
  onPage:     (p: number) => void
}

export function DispatchLinesView({ search, sku, clientId, status, cargoType, dateFrom, dateTo, page, onPage }: Props) {
  const navigate = useNavigate()

  const { data, loading } = useApi(
    (signal) => listDispatchLines({
      page, limit: PAGE_SIZE,
      search: search?.trim() || undefined,
      sku: sku?.trim() || undefined,
      client_id: clientId || undefined,
      status,
      cargo_type: cargoType,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }, signal),
    [page, search, sku, clientId, status, cargoType, dateFrom, dateTo],
  )

  const items = data?.items ?? []
  const total = data?.total ?? 0

  return (
    <>
      <Table>
        <thead>
          <tr>
            <th style={{ width: 130 }}>Номер</th>
            <th>Клиент</th>
            <th>Товар</th>
            <th style={{ width: 150 }}>Магазин</th>
            <th style={{ width: 140 }}>Цвет / Размер</th>
            <th style={{ width: 110 }}>Дата отгрузки</th>
            <th style={{ textAlign: 'right', width: 80 }}>План</th>
            <th style={{ textAlign: 'right', width: 90 }}>Отгружено</th>
            <th style={{ width: 150 }}>Статус</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <SkeletonRows rows={10} cols={9} />
          ) : items.length === 0 ? (
            <tr><td colSpan={9}>
              <EmptyState title="Товаров нет" sub="Измените фильтры или создайте отгрузку" />
            </td></tr>
          ) : (
            groupLinesByDay(items).map((g) => (
              <Fragment key={g.key}>
                <tr className="list-day-row">
                  <td colSpan={9}>
                    <div className="list-day-head">
                      <span className="list-day-title"><Icon name="calendar" size={14} />{g.label}</span>
                      <span className="list-day-counts"><span className="t-sub">{g.rows.length}</span></span>
                    </div>
                  </td>
                </tr>
                {g.rows.map((it) => (
              <tr
                key={it.line_id}
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/inventory/dispatches/${it.doc_id}`)}
              >
                <Td className="mono" style={{ fontWeight: 500 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {it.doc_number}
                    {it.cargo_type === 'defect' && <Badge tone="warning">Брак</Badge>}
                  </span>
                </Td>
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
                <Td>
                  <Badge tone={DISPATCH_STATUS_TONES[it.status] as BadgeTone} dot>
                    {it.status_label}
                  </Badge>
                </Td>
              </tr>
                ))}
              </Fragment>
            ))
          )}
        </tbody>
      </Table>
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={onPage} />
    </>
  )
}
