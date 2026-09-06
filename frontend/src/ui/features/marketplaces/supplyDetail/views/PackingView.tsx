import { Link } from 'react-router-dom'
import type { MpSupplyDetail } from '../../../../../api/marketplacesApi'
import { Icon } from '../../../../primitives/Icon'
import { CancelledPanel } from '../components/CancelledPanel'
import { SupplyOrdersTable } from '../components/SupplyOrdersTable'

/** Фаза «Упаковка» глазами менеджера: прогресс по заказам и ошибки площадки.
 *  Сама укладка идёт на станции упаковки — у ПК с принтером этикеток. */
export function PackingView({ detail }: { detail: MpSupplyDetail }) {
  const { doc } = detail
  const selected = detail.orders.filter((o) => o.state === 'selected')
  const failed = selected.filter((o) => o.packed_at && o.mp_error)
  return (
    <>
      <div
        className="row gap-8"
        style={{
          padding: '10px 12px', marginBottom: 12, background: 'var(--c-bg-sunken)',
          borderRadius: 'var(--r-lg)', fontSize: 12.5, color: 'var(--c-text-muted)', alignItems: 'center',
        }}
      >
        <span>
          Упаковано: <b style={{ color: 'var(--c-text)' }}>{doc.orders_packed} из {doc.orders_total}</b>
        </span>
        <span style={{ marginLeft: 16 }}>
          Этикеток: <b style={{ color: 'var(--c-text)' }}>{doc.orders_labeled}</b>
        </span>
        <span style={{ marginLeft: 16 }}>
          Упаковывает: <b style={{ color: 'var(--c-text)' }}>{doc.picker_name ?? 'не взята'}</b>
        </span>
        <span style={{ flex: 1 }} />
        <Link className="btn sm" to={`/marketplaces/supplies/${doc.id}/pack`}>
          <Icon name="barcode" size={13} />Станция упаковки
        </Link>
      </div>

      <CancelledPanel detail={detail} />

      {failed.length > 0 && (
        <div style={{ border: '1px solid var(--c-danger)', borderRadius: 'var(--r-lg)', padding: '12px 14px', marginBottom: 12 }}>
          <div className="row gap-8" style={{ fontSize: 12.5, color: 'var(--c-danger)' }}>
            <Icon name="alert" size={14} />
            <span style={{ flex: 1 }}>
              <b>Площадка ответила ошибкой: {failed.length} заказ(ов)</b> — упаковка не завершится,
              пока у каждого заказа нет этикетки. Повторите отправку на станции упаковки.
            </span>
          </div>
          {failed.map((o) => (
            <div key={o.order_id} className="row gap-8" style={{ marginTop: 6, fontSize: 12.5 }}>
              <span className="mono" style={{ minWidth: 130 }}>{o.external_id}</span>
              <span style={{ color: 'var(--c-text-muted)' }}>{o.mp_error}</span>
            </div>
          ))}
        </div>
      )}

      <SupplyOrdersTable orders={selected} phase="packing" />
    </>
  )
}
