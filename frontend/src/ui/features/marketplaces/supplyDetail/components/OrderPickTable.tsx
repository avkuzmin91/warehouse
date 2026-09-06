import { Link } from 'react-router-dom'
import type { MpSupplyOrderItem } from '../../../../../api/marketplacesApi'
import { Table, Td } from '../../../../data/Table'
import { Badge } from '../../../../primitives/Badge'
import { fmtDateShort } from '../../../../../utils/format'
import { cutoffCountdown, cutoffTime } from '../../supplyBoard/waves'

/** Строка «не связан» без выхода на связку — тупик: чинить приходилось по памяти
 *  из другого раздела. Ссылка ведёт в связку товаров кабинета сразу к нужному offer. */
function linksHref(accountId: string, offers: string[]) {
  const sp = new URLSearchParams({ account: accountId, linked: 'unlinked' })
  if (offers.length === 1) sp.set('search', offers[0])
  return `/marketplaces/links?${sp.toString()}`
}

/** Единая таблица выбора заказов: пул новой поставки и состав уже заведённой —
 *  одно решение, поэтому один экран, а не две таблицы с разными колонками. */
export function OrderPickTable({ orders, selected, accountId, onToggle, onToggleAll, disabled }: {
  orders: MpSupplyOrderItem[]
  selected: Set<string>
  accountId: string
  onToggle: (orderId: string) => void
  onToggleAll: () => void
  disabled?: boolean
}) {
  const selectedVisible = orders.filter((o) => selected.has(o.order_id)).length
  const allSelected = orders.length > 0 && selectedVisible === orders.length

  // Номер заказа выделяют мышью, чтобы скопировать, — такой клик не должен снимать галочку.
  const rowClick = (orderId: string) => {
    if ((window.getSelection()?.toString() ?? '').length > 0) return
    onToggle(orderId)
  }

  return (
    <Table>
      <thead>
        <tr>
          <th style={{ width: 34 }}>
            <input
              ref={(el) => { if (el) el.indeterminate = selectedVisible > 0 && !allSelected }}
              type="checkbox"
              checked={allSelected}
              onChange={onToggleAll}
              disabled={disabled || orders.length === 0}
              title={allSelected ? 'Снять выбор' : 'Выбрать все в списке'}
            />
          </th>
          <th style={{ width: 150 }}>№ заказа</th>
          <th style={{ width: 150 }}>Дедлайн</th>
          <th>Состав</th>
          <th style={{ width: 180 }}>Где лежит</th>
          <th style={{ width: 150 }}>Готовность</th>
        </tr>
      </thead>
      <tbody>
        {orders.map((order) => {
          const blocked = order.blockers.length > 0
          const unlinked = order.blockers.includes('unlinked')
          return (
            <tr
              key={order.order_id}
              onClick={() => rowClick(order.order_id)}
              style={{
                cursor: 'pointer',
                background: blocked ? 'var(--c-bg-sunken)' : undefined,
                boxShadow: blocked ? 'inset 3px 0 0 var(--c-warning)' : undefined,
              }}
            >
              <Td>
                <input
                  type="checkbox"
                  checked={selected.has(order.order_id)}
                  disabled={disabled}
                  onChange={() => onToggle(order.order_id)}
                  onClick={(e) => e.stopPropagation()}
                />
              </Td>
              <Td className="mono" style={{ fontWeight: 600 }}>{order.external_id}</Td>
              <Td className="num" style={{ fontSize: 12 }}>
                <div>{fmtDateShort(order.deadline_at)} {cutoffTime(order.deadline_at)}</div>
                <div style={{ color: 'var(--c-text-subtle)', fontSize: 11.5 }}>
                  {cutoffCountdown(order.deadline_at)}
                </div>
              </Td>
              <Td>{order.summary}</Td>
              <Td>
                {unlinked
                  ? <span style={{ color: 'var(--c-text-faint)' }}>—</span>
                  : order.cells.length === 0
                    ? <Badge tone="warning">без места</Badge>
                    : (
                      <span className="mono" style={{ fontSize: 12 }}>
                        {order.cells.slice(0, 2).join(', ')}
                        {order.cells.length > 2 && (
                          <span style={{ color: 'var(--c-text-faint)' }}> +{order.cells.length - 2}</span>
                        )}
                      </span>
                    )}
              </Td>
              <Td>
                {unlinked ? (
                  <Link
                    to={linksHref(accountId, order.unlinked_offers)}
                    onClick={(e) => e.stopPropagation()}
                    title="Открыть связку товаров кабинета"
                    style={{ textDecoration: 'none' }}
                  >
                    <Badge tone="warning">связать товар →</Badge>
                  </Link>
                ) : order.blockers.includes('shortage') ? (
                  <Badge tone="danger">нет остатка</Badge>
                ) : order.blockers.includes('no_location') ? (
                  <Badge tone="warning">искать по складу</Badge>
                ) : (
                  <Badge tone="success">готов</Badge>
                )}
              </Td>
            </tr>
          )
        })}
      </tbody>
    </Table>
  )
}
