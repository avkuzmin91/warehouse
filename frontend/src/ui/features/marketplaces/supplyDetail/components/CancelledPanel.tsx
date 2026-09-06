import type { MpSupplyDetail } from '../../../../../api/marketplacesApi'
import { Icon } from '../../../../primitives/Icon'

/** Отмена заказа на площадке. Снятие с состава делает синк — здесь видно, что
 *  именно ушло и что после этого осталось на столе. Заказ, уже отданный площадке,
 *  не снимается вовсе: вынуть его оттуда нельзя, разбирают в кабинете продавца. */
export function CancelledPanel({ detail }: { detail: MpSupplyDetail }) {
  const cancelled = detail.orders.filter((o) => o.order_status === 'cancelled')
  const dropped = cancelled.filter((o) => o.state !== 'selected')
  const held = cancelled.filter((o) => o.state === 'selected')
  const debt = detail.doc.return_debt_qty
  if (dropped.length === 0 && held.length === 0) return null

  return (
    <div
      style={{
        border: '1px solid var(--c-danger)', borderRadius: 'var(--r-lg)',
        padding: '12px 14px', marginBottom: 12,
      }}
    >
      {dropped.length > 0 && (
        <div className="row gap-8" style={{ fontSize: 12.5, color: 'var(--c-danger)' }}>
          <Icon name="alert" size={14} />
          <span style={{ flex: 1 }}>
            <b>Отменены площадкой: {dropped.length} заказ(ов)</b> — сняты с поставки автоматически.
            {debt > 0
              ? ` Собранное под них осталось на столе: вернуть на место ${debt} шт. сканом на ТСД.`
              : ' Возвращать нечего — товар с полки не снимали.'}
          </span>
        </div>
      )}
      {dropped.map((o) => (
        <div key={o.order_id} className="row gap-8" style={{ marginTop: 8, alignItems: 'center' }}>
          <span className="mono" style={{ fontSize: 12, minWidth: 130 }}>{o.external_id}</span>
          <span style={{ flex: 1, fontSize: 12.5, color: 'var(--c-text-muted)' }}>{o.summary}</span>
        </div>
      ))}
      {held.length > 0 && (
        <div
          className="row gap-8"
          style={{
            fontSize: 12.5, color: 'var(--c-danger)',
            marginTop: dropped.length > 0 ? 12 : 0,
          }}
        >
          <Icon name="alert" size={14} />
          <span style={{ flex: 1 }}>
            <b>Отменены после передачи площадке: {held.length} заказ(ов)</b> — задание уже
            в поставке продавца, площадка его назад не отдаёт. Состав не меняем, товар едет
            физически: разберите расхождение в кабинете продавца.
          </span>
        </div>
      )}
      {held.map((o) => (
        <div key={o.order_id} className="row gap-8" style={{ marginTop: 8, alignItems: 'center' }}>
          <span className="mono" style={{ fontSize: 12, minWidth: 130 }}>{o.external_id}</span>
          <span style={{ flex: 1, fontSize: 12.5, color: 'var(--c-text-muted)' }}>{o.summary}</span>
        </div>
      ))}
    </div>
  )
}
