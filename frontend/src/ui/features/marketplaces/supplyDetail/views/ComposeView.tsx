import { useMemo, useState } from 'react'
import { setMpSupplyOrders } from '../../../../../api/marketplacesApi'
import type { MpSupplyDetail, MpSupplyOrderItem } from '../../../../../api/marketplacesApi'
import { Table, Td } from '../../../../data/Table'
import { Badge } from '../../../../primitives/Badge'
import { Icon } from '../../../../primitives/Icon'
import { EmptyState } from '../../../../primitives/EmptyState'
import { useToast } from '../../../../feedback/Toast'
import { cutoffTime } from '../../supplyBoard/waves'

type Tab = 'all' | 'ready' | 'problem'

const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'ready', label: 'Готовые' },
  { key: 'problem', label: 'С проблемой' },
]

function blockerBadge(order: MpSupplyOrderItem) {
  if (order.blockers.includes('unlinked')) return <Badge tone="warning">не связан</Badge>
  if (order.blockers.includes('shortage')) return <Badge tone="danger">нет остатка</Badge>
  if (order.blockers.includes('no_location')) return <Badge tone="warning">искать по складу</Badge>
  return <Badge tone="success">готов</Badge>
}

/** Фаза «Состав» — экран выбора. Галочки стоят заранее (иначе каждую волну
 *  пришлось бы отмечать десятки строк руками), но снимаются свободно:
 *  автонабор заполняет форму за менеджера, а не решает за него. */
export function ComposeView({ detail, onChanged }: { detail: MpSupplyDetail; onChanged: () => void }) {
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('all')
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(detail.orders.filter((o) => o.state === 'selected').map((o) => o.order_id)),
  )

  const orders = useMemo(
    () => detail.orders.filter((o) => o.state !== 'pending'),
    [detail.orders],
  )
  const visible = orders.filter((o) => (
    tab === 'all' ? true : tab === 'ready' ? o.blockers.length === 0 : o.blockers.length > 0
  ))
  const readyCount = orders.filter((o) => o.blockers.length === 0).length

  const chosen = orders.filter((o) => selected.has(o.order_id))
  const chosenQty = chosen.reduce((n, o) => n + o.total_qty, 0)
  const chosenCells = new Set(chosen.flatMap((o) => o.cells)).size
  const dirty = (
    chosen.length !== detail.orders.filter((o) => o.state === 'selected').length
    || chosen.some((o) => o.state !== 'selected')
  )

  const toggle = (orderId: string) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(orderId)) next.delete(orderId)
    else next.add(orderId)
    return next
  })

  const save = async () => {
    setSaving(true)
    try {
      await setMpSupplyOrders(detail.doc.id, [...selected])
      toast('Состав сохранён', 'success')
      onChanged()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось сохранить состав', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (orders.length === 0) {
    return (
      <EmptyState
        title="Заказов пока нет"
        sub="Заказы кабинета к этой отсечке попадают сюда сами при синхронизации."
      />
    )
  }

  return (
    <>
      <div className="row gap-8" style={{ marginBottom: 10 }}>
        <div className="tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`tab ${tab === t.key ? 'active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              <span className="tab-count">
                {t.key === 'all' ? orders.length : t.key === 'ready' ? readyCount : orders.length - readyCount}
              </span>
            </button>
          ))}
        </div>
        <div className="row gap-8" style={{ marginLeft: 'auto' }}>
          <button className="btn ghost sm" onClick={() => setSelected(new Set())}>Снять все</button>
          <button
            className="btn sm"
            onClick={() => setSelected(new Set(orders.filter((o) => o.blockers.length === 0).map((o) => o.order_id)))}
          >
            Отметить готовые
          </button>
          <button className="btn primary sm" disabled={saving || !dirty} onClick={save}>
            <Icon name="check" size={13} />Сохранить состав
          </button>
        </div>
      </div>

      <Table>
        <thead>
          <tr>
            <th style={{ width: 34 }} />
            <th style={{ width: 150 }}>№ заказа</th>
            <th style={{ width: 74 }}>Пришёл</th>
            <th>Состав</th>
            <th style={{ width: 190 }}>Где лежит</th>
            <th style={{ width: 150 }}>Готовность</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((order) => (
            <tr
              key={order.order_id}
              onClick={() => toggle(order.order_id)}
              style={{ cursor: 'pointer', background: order.blockers.length ? 'var(--c-bg-sunken)' : undefined }}
            >
              <Td>
                <input
                  type="checkbox"
                  checked={selected.has(order.order_id)}
                  onChange={() => toggle(order.order_id)}
                  onClick={(e) => e.stopPropagation()}
                />
              </Td>
              <Td className="mono" style={{ fontWeight: 600 }}>{order.external_id}</Td>
              <Td className="num" style={{ color: 'var(--c-text-subtle)' }}>{cutoffTime(order.created_at_mp)}</Td>
              <Td>{order.summary}</Td>
              <Td>
                {order.blockers.includes('unlinked')
                  ? <Badge tone="warning">нет в номенклатуре</Badge>
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
              <Td>{blockerBadge(order)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>

      <div
        className="row gap-8"
        style={{
          marginTop: 8, padding: '10px 14px', gap: 20, fontSize: 12.5,
          border: '1px solid var(--c-accent-border)', background: 'var(--c-accent-bg)',
          borderRadius: 'var(--r-lg)', color: 'var(--c-accent-text)',
        }}
      >
        <span>Выбрано <b>{chosen.length} из {orders.length}</b></span>
        <span>{chosenQty} шт.</span>
        <span>{chosenCells} ячеек</span>
        {orders.length - chosen.length > 0 && (
          <span style={{ marginLeft: 'auto' }}>
            Не поедут: <b>{orders.length - chosen.length}</b> — уйдут в следующую поставку кабинета
          </span>
        )}
      </div>
    </>
  )
}
