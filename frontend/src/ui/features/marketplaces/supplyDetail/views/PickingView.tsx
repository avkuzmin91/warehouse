import { useState } from 'react'
import { dockMpSupplyOrders, dropMpSupplyOrder } from '../../../../../api/marketplacesApi'
import type { MpSupplyDetail } from '../../../../../api/marketplacesApi'
import { Icon } from '../../../../primitives/Icon'
import { useConfirm } from '../../../../feedback/ConfirmDialog'
import { useToast } from '../../../../feedback/Toast'
import { PickListTable, PickListTotals } from '../components/PickListTable'
import { SupplyOrdersTable } from '../components/SupplyOrdersTable'
import { cutoffTime } from '../../supplyBoard/waves'

/** Фазы «Сборка» / «Передача» и терминальные состояния: тот же лист подбора,
 *  но read-only. Действия менеджера здесь — принять дозагрузку и разобрать
 *  недостачу: сборка не закрывается недособранной, поэтому «товара нет» решается
 *  уменьшением состава, а не недобором. */
export function PickingView({ detail, onChanged }: { detail: MpSupplyDetail; onChanged: () => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [tab, setTab] = useState<'pick' | 'orders'>('pick')
  const [busy, setBusy] = useState(false)
  const selected = detail.orders.filter((o) => o.state === 'selected')
  const pending = detail.orders.filter((o) => o.state === 'pending')
  const picking = detail.doc.status === 'picking'
  const stuck = picking ? selected.filter((o) => !o.ready) : []

  const drop = async (orderId: string, externalId: string) => {
    const ok = await confirm({
      title: 'Снять заказ с поставки?',
      body: `Заказ ${externalId} уйдёт из состава — сборщик перестанет его искать, `
        + 'а заказ вернётся в общий поток и попадёт в следующую поставку кабинета.',
      danger: true,
      confirmLabel: 'Снять',
    })
    if (!ok) return
    setBusy(true)
    try {
      await dropMpSupplyOrder(detail.doc.id, orderId)
      toast(`Заказ ${externalId} снят со сборки`, 'success')
      onChanged()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось снять заказ', 'error')
    } finally {
      setBusy(false)
    }
  }

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

      {picking && (
        <div
          style={{
            padding: '10px 12px', marginBottom: 12, background: 'var(--c-bg-sunken)',
            borderRadius: 'var(--r-lg)', fontSize: 12.5, color: 'var(--c-text-muted)',
          }}
        >
          <span>
            Сборка: <b style={{ color: 'var(--c-text)' }}>{detail.doc.picked_qty} из {detail.doc.total_qty} шт.</b>
          </span>
          <span style={{ marginLeft: 22 }}>
            Сборщик: <b style={{ color: 'var(--c-text)' }}>{detail.doc.picker_name ?? 'не взята'}</b>
          </span>
        </div>
      )}

      {stuck.length > 0 && (
        <div
          style={{
            border: '1px solid var(--c-danger)', borderRadius: 'var(--r-lg)',
            padding: '12px 14px', marginBottom: 12,
          }}
        >
          <div className="row gap-8" style={{ fontSize: 12.5, color: 'var(--c-danger)' }}>
            <Icon name="alert" size={14} />
            <span style={{ flex: 1 }}>
              <b>Недостача: {stuck.length} заказ(ов)</b> — товара на складе нет. Сборка не
              закроется, пока состав не собран целиком: снимите заказ, чтобы поставка уехала
              без него.
            </span>
          </div>
          {stuck.map((o) => (
            <div key={o.order_id} className="row gap-8" style={{ marginTop: 8, alignItems: 'center' }}>
              <span className="mono" style={{ fontSize: 12, minWidth: 130 }}>{o.external_id}</span>
              <span style={{ flex: 1, fontSize: 12.5, color: 'var(--c-text-muted)' }}>{o.summary}</span>
              <button className="btn sm" disabled={busy} onClick={() => drop(o.order_id, o.external_id)}>
                Снять с поставки
              </button>
            </div>
          ))}
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
