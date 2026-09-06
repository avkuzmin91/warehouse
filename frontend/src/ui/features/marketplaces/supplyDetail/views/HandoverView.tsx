import { Link } from 'react-router-dom'
import type { MpSupplyDetail } from '../../../../../api/marketplacesApi'
import { MP_CARGO_KIND_LABELS, MP_CARGO_STATUS_LABELS } from '../../../../../api/marketplacesApi'
import { Badge } from '../../../../primitives/Badge'
import { Icon } from '../../../../primitives/Icon'
import { CancelledPanel } from '../components/CancelledPanel'
import { SupplyOrdersTable } from '../components/SupplyOrdersTable'

/** Фаза «Передача» и терминальные состояния: грузовые места и где какой заказ.
 *  Формирует ГМ склад на своём экране; здесь — свод и кнопка передачи в шапке. */
export function HandoverView({ detail }: { detail: MpSupplyDetail }) {
  const { doc } = detail
  const selected = detail.orders.filter((o) => o.state === 'selected')
  const loose = selected.filter((o) => o.packed_at && !o.cargo_unit_id)
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
          Грузовых мест: <b style={{ color: 'var(--c-text)' }}>{doc.cargo_units_total}</b>
          {doc.cargo_units_open > 0 && <> · не закрыто {doc.cargo_units_open}</>}
        </span>
        <span style={{ marginLeft: 16 }}>
          Не уложено заказов: <b style={{ color: loose.length ? 'var(--c-danger)' : 'var(--c-text)' }}>{loose.length}</b>
        </span>
        {doc.external_supply_id && (
          <span style={{ marginLeft: 16 }}>
            Поставка площадки: <b className="mono" style={{ color: 'var(--c-text)' }}>{doc.external_supply_id}</b>
          </span>
        )}
        <span style={{ flex: 1 }} />
        {doc.status === 'handover' && (
          <Link className="btn sm" to={`/marketplaces/supplies/${doc.id}/cargo`}>
            <Icon name="boxes" size={13} />Грузовые места
          </Link>
        )}
      </div>

      <CancelledPanel detail={detail} />

      {detail.cargo_units.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {detail.cargo_units.map((u) => (
            <div key={u.id} className="card" style={{ padding: '8px 12px', fontSize: 12.5 }}>
              <div className="row gap-8" style={{ alignItems: 'center' }}>
                <span className="mono" style={{ fontWeight: 700 }}>{u.doc_number}</span>
                <span style={{ color: 'var(--c-text-muted)' }}>{MP_CARGO_KIND_LABELS[u.kind]}</span>
                <Badge tone={u.status === 'closed' ? 'success' : 'warning'}>{MP_CARGO_STATUS_LABELS[u.status]}</Badge>
              </div>
              <div style={{ color: 'var(--c-text-subtle)', marginTop: 2 }}>
                {u.orders_count} заказ(ов) · {u.items_qty} шт.{u.external_id ? ` · ${u.external_id}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      <SupplyOrdersTable orders={selected} phase="handover" />
    </>
  )
}
