import type { MpSupplyOrderItem } from '../../../../../api/marketplacesApi'
import { Table, Td } from '../../../../data/Table'
import { Badge } from '../../../../primitives/Badge'
import { EmptyState } from '../../../../primitives/EmptyState'
import { cutoffTime } from '../../supplyBoard/waves'

/** Заказный разрез поставки — нужен на упаковке и при разборе отмены,
 *  поэтому вторая вкладка, а не первая. */
export function SupplyOrdersTable({ orders }: { orders: MpSupplyOrderItem[] }) {
  if (orders.length === 0) return <EmptyState title="Заказов нет" />
  return (
    <Table>
      <thead>
        <tr>
          <th style={{ width: 150 }}>№ заказа</th>
          <th style={{ width: 74 }}>Пришёл</th>
          <th>Состав</th>
          <th style={{ width: 190 }}>Где лежит</th>
          <th style={{ width: 130 }}>Готовность</th>
        </tr>
      </thead>
      <tbody>
        {orders.map((order) => (
          <tr key={order.order_id}>
            <Td className="mono" style={{ fontWeight: 600 }}>{order.external_id}</Td>
            <Td className="num" style={{ color: 'var(--c-text-subtle)' }}>{cutoffTime(order.created_at_mp)}</Td>
            <Td>{order.summary}</Td>
            <Td className="mono" style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>
              {order.cells.length ? order.cells.join(', ') : '—'}
            </Td>
            <Td>
              {order.ready
                ? <Badge tone="success">готов</Badge>
                : <Badge tone="danger">{order.blockers.includes('unlinked') ? 'не связан' : 'нет остатка'}</Badge>}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
