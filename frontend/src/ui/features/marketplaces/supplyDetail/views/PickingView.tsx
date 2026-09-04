import { useState } from 'react'
import { dockMpSupplyOrders } from '../../../../../api/marketplacesApi'
import type { MpSupplyDetail } from '../../../../../api/marketplacesApi'
import { Icon } from '../../../../primitives/Icon'
import { useToast } from '../../../../feedback/Toast'
import { PickListTable, PickListTotals } from '../components/PickListTable'
import { SupplyOrdersTable } from '../components/SupplyOrdersTable'
import { cutoffTime } from '../../supplyBoard/waves'

/** Фазы «Сборка» / «Передача» и терминальные состояния: тот же лист подбора,
 *  но read-only. Единственное действие менеджера здесь — принять дозагрузку. */
export function PickingView({ detail, onChanged }: { detail: MpSupplyDetail; onChanged: () => void }) {
  const toast = useToast()
  const [tab, setTab] = useState<'pick' | 'orders'>('pick')
  const [busy, setBusy] = useState(false)
  const selected = detail.orders.filter((o) => o.state === 'selected')
  const pending = detail.orders.filter((o) => o.state === 'pending')

  const dock = async () => {
    setBusy(true)
    try {
      await dockMpSupplyOrders(detail.doc.id, pending.map((o) => o.order_id))
      toast(`Добавлено в сборку: ${pending.length}`, 'success')
      onChanged()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось добавить заказы', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {pending.length > 0 && (
        <div
          style={{
            border: '1px solid var(--c-accent-border)', background: 'var(--c-accent-bg)',
            borderRadius: 'var(--r-lg)', padding: '12px 14px', marginBottom: 12,
          }}
        >
          <div className="row gap-8" style={{ fontSize: 12.5, color: 'var(--c-accent-text)' }}>
            <Icon name="inbox" size={14} />
            <span style={{ flex: 1 }}>
              <b>Дозагрузка: {pending.length} заказ(ов)</b> подъехали в идущую сборку —
              добавятся дельтой в ту же задачу кладовщика, без второго прохода по стеллажам.
            </span>
            <button className="btn primary sm" disabled={busy} onClick={dock}>
              Добавить в сборку
            </button>
          </div>
          <div className="mono" style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', marginTop: 8 }}>
            {pending.map((o) => `${o.external_id} · ${cutoffTime(o.created_at_mp)}`).join('   ')}
          </div>
        </div>
      )}

      <div className="row gap-8" style={{ marginBottom: 10 }}>
        <div className="tabs">
          <button className={`tab ${tab === 'pick' ? 'active' : ''}`} onClick={() => setTab('pick')}>
            Лист подбора<span className="tab-count">{detail.pick_list.length}</span>
          </button>
          <button className={`tab ${tab === 'orders' ? 'active' : ''}`} onClick={() => setTab('orders')}>
            Заказы<span className="tab-count">{selected.length}</span>
          </button>
        </div>
      </div>

      {tab === 'pick' ? (
        <>
          <PickListTable items={detail.pick_list} />
          <PickListTotals items={detail.pick_list} ordersTotal={selected.length} />
        </>
      ) : (
        <SupplyOrdersTable orders={selected} />
      )}
    </>
  )
}
