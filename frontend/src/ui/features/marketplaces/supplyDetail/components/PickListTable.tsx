import type { MpSupplyPickItem } from '../../../../../api/marketplacesApi'
import { Table, Td } from '../../../../data/Table'
import { Badge } from '../../../../primitives/Badge'
import { EmptyState } from '../../../../primitives/EmptyState'

/** Лист подбора: вариант × суммарное количество, порядок — маршрут обхода.
 *  Именно с ним работает склад, поэтому это вкладка по умолчанию, а не заказы. */
export function PickListTable({ items }: { items: MpSupplyPickItem[] }) {
  if (items.length === 0) {
    return <EmptyState title="В составе нет позиций" sub="Отметьте заказы на фазе «Состав»." />
  }
  return (
    <Table>
      <thead>
        <tr>
          <th style={{ width: 110 }}>Артикул</th>
          <th>Товар</th>
          <th style={{ width: 150 }}>Цвет / размер</th>
          <th style={{ width: 150 }}>Ячейка · маршрут</th>
          <th style={{ width: 76, textAlign: 'right' }}>Нужно</th>
          <th style={{ width: 90, textAlign: 'right' }}>Собрано</th>
          <th style={{ width: 90, textAlign: 'right' }}>Свободно</th>
          <th style={{ width: 90 }}>Заказов</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, i) => (
          <tr key={item.variant_id ?? `unlinked-${i}`}>
            <Td className="mono" style={{ color: 'var(--c-text-muted)' }}>
              {item.product_sku ?? item.offer_id ?? '—'}
            </Td>
            <Td>{item.product_name ?? 'Товар без связки'}</Td>
            <Td style={{ color: 'var(--c-text-muted)' }}>
              {[item.color_name, item.size_name].filter(Boolean).join(' / ') || '—'}
            </Td>
            <Td>
              {!item.linked
                ? <Badge tone="warning">нет в номенклатуре</Badge>
                : item.cells.length === 0
                  ? <Badge tone="warning">без места</Badge>
                  : (
                    <span className="mono" style={{ fontSize: 12 }}>
                      {item.cells[0]}
                      {item.cells.length > 1 && (
                        <span style={{ color: 'var(--c-text-faint)' }}> + {item.cells.slice(1).join(', ')}</span>
                      )}
                    </span>
                  )}
            </Td>
            <Td className="num" style={{ textAlign: 'right' }}>{item.need_qty}</Td>
            <Td
              className="num"
              style={{
                textAlign: 'right',
                color: item.linked && item.remaining_qty === 0 ? 'var(--c-success)' : undefined,
                fontWeight: item.linked && item.remaining_qty === 0 ? 600 : undefined,
              }}
            >
              {item.linked ? item.picked_qty : '—'}
            </Td>
            <Td
              className="num"
              style={{
                textAlign: 'right',
                color: item.shortage_qty > 0 ? 'var(--c-danger)' : undefined,
                fontWeight: item.shortage_qty > 0 ? 600 : undefined,
              }}
            >
              {item.linked ? item.available_qty : '—'}
            </Td>
            <Td>{item.orders_count}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}

/** Итог переводит состав в физику: не «38 заказов», а проходы и ячейки —
 *  величины, по которым видно, влезет ли это в оставшееся время. */
export function PickListTotals({ items, ordersTotal }: { items: MpSupplyPickItem[]; ordersTotal: number }) {
  const need = items.reduce((n, i) => n + i.need_qty, 0)
  const picked = items.reduce((n, i) => n + i.picked_qty, 0)
  const collectable = items.reduce(
    (n, i) => n + Math.min(i.remaining_qty, i.linked ? i.available_qty : 0), 0,
  )
  const cells = new Set(items.flatMap((i) => i.cells)).size
  const noLocation = items.filter((i) => i.linked && i.cells.length === 0).length
  return (
    <div
      className="row gap-8"
      style={{
        padding: '10px 12px', marginTop: 8, background: 'var(--c-bg-sunken)',
        borderRadius: 'var(--r-lg)', fontSize: 12.5, color: 'var(--c-text-muted)', gap: 22,
      }}
    >
      <span>Итого к подбору: <b style={{ color: 'var(--c-text)' }}>{need} шт.</b></span>
      {picked > 0 && (
        <span>Собрано: <b style={{ color: 'var(--c-success)' }}>{picked} шт.</b></span>
      )}
      <span>Ещё собирается: <b style={{ color: 'var(--c-text)' }}>{collectable} шт.</b></span>
      <span>Проходов по складу: <b style={{ color: 'var(--c-text)' }}>{items.length}</b> вместо {ordersTotal}</span>
      <span>Ячеек: <b style={{ color: 'var(--c-text)' }}>{cells}</b></span>
      {noLocation > 0 && <span>Без места: <b style={{ color: 'var(--c-warning)' }}>{noLocation} поз.</b></span>}
    </div>
  )
}
