import type { MpSupplyOrderItem } from '../../../../../api/marketplacesApi'
import { Table, Td } from '../../../../data/Table'
import { Badge } from '../../../../primitives/Badge'
import { EmptyState } from '../../../../primitives/EmptyState'
import { cutoffTime } from '../../supplyBoard/waves'

type Phase = 'pick' | 'packing' | 'handover'

function packState(order: MpSupplyOrderItem) {
  if (!order.packed_at) return <Badge tone="">не упакован</Badge>
  if (order.mp_error) return <Badge tone="danger">ошибка площадки</Badge>
  if (!order.label_url) return <Badge tone="warning">без этикетки</Badge>
  return <Badge tone="success">этикетка</Badge>
}

/** Заказный разрез поставки — нужен на упаковке и при разборе отмены,
 *  поэтому вторая вкладка, а не первая. На упаковке и передаче вместо «Где лежит»
 *  показывается состояние заказа: упакован / этикетка / грузовое место. */
export function SupplyOrdersTable({ orders, phase = 'pick' }: { orders: MpSupplyOrderItem[]; phase?: Phase }) {
  if (orders.length === 0) return <EmptyState title="Заказов нет" />
  const later = phase !== 'pick'
  return (
    <Table>
      <thead>
        <tr>
          <th style={{ width: 150 }}>№ заказа</th>
          <th style={{ width: 74 }}>Пришёл</th>
          <th>Состав</th>
          {later ? (
            <>
              <th style={{ width: 130 }}>Упаковка</th>
              <th style={{ width: 150 }}>Этикетка</th>
              <th style={{ width: 120 }}>Грузовое место</th>
            </>
          ) : (
            <>
              <th style={{ width: 190 }}>Где лежит</th>
              <th style={{ width: 130 }}>Готовность</th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {orders.map((order) => (
          <tr key={order.order_id} style={order.order_status === 'cancelled' ? { opacity: 0.65 } : undefined}>
            <Td className="mono" style={{ fontWeight: 600 }}>
              {order.external_id}
              {order.order_status === 'cancelled' && (
                <Badge tone="danger" style={{ marginLeft: 8 }}>отменён площадкой</Badge>
              )}
            </Td>
            <Td className="num" style={{ color: 'var(--c-text-subtle)' }}>{cutoffTime(order.created_at_mp)}</Td>
            <Td>{order.summary}</Td>
            {later ? (
              <>
                <Td>{packState(order)}</Td>
                <Td className="mono" style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>
                  {order.label_barcode ?? '—'}
                </Td>
                <Td className="mono" style={{ fontSize: 12 }}>
                  {order.cargo_unit_number ?? <span style={{ color: 'var(--c-text-subtle)' }}>—</span>}
                </Td>
              </>
            ) : (
              <>
                <Td className="mono" style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>
                  {order.cells.length ? order.cells.join(', ') : '—'}
                </Td>
                <Td>
                  {order.ready
                    ? <Badge tone="success">готов</Badge>
                    : <Badge tone="danger">{order.blockers.includes('unlinked') ? 'не связан' : 'нет остатка'}</Badge>}
                </Td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
