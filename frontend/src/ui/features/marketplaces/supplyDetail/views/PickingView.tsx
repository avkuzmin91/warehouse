import { useState } from 'react'
import {
  dockMpSupplyOrders,
  dropMpSupplyOrder,
  getMpSupplyCandidates,
} from '../../../../../api/marketplacesApi'
import type { MpSupplyDetail } from '../../../../../api/marketplacesApi'
import { useApi } from '../../../../../hooks/useApi'
import { Icon } from '../../../../primitives/Icon'
import { useConfirm } from '../../../../feedback/ConfirmDialog'
import { useToast } from '../../../../feedback/Toast'
import { CancelledPanel } from '../components/CancelledPanel'
import { LabelsPanel } from '../components/LabelsPanel'
import { PickListTable, PickListTotals } from '../components/PickListTable'
import { SupplyOrdersTable } from '../components/SupplyOrdersTable'
import { cutoffTime } from '../../supplyBoard/waves'

/** Фазы «Сборка» / «Передача» и терминальные состояния: тот же лист подбора,
 *  но read-only. Действия менеджера здесь — добрать заказы из пула, пока приём
 *  открыт, и разобрать недостачу: сборка не закрывается недособранной, поэтому
 *  «товара нет» решается уменьшением состава, а не недобором. */
export function PickingView({ detail, onChanged }: { detail: MpSupplyDetail; onChanged: () => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [tab, setTab] = useState<'pick' | 'orders'>('pick')
  const [busy, setBusy] = useState(false)
  const selected = detail.orders.filter((o) => o.state === 'selected')
  const picking = detail.doc.status === 'picking'
  const stuck = picking ? selected.filter((o) => !o.ready) : []
  // Добрать можно, только пока приём открыт: сборщик не должен получать новые
  // строки, когда уже идёт к последнему стеллажу.
  const canDock = picking && !detail.doc.intake_closed_at
  const { data: poolData } = useApi(
    (signal) => (canDock
      ? getMpSupplyCandidates(detail.doc.id, signal)
      : Promise.resolve({ items: [] })),
    [detail.doc.id, detail.doc.updated_at, canDock],
  )
  const pending = [
    ...detail.orders.filter((o) => o.state === 'pending'),
    ...(poolData?.items ?? []),
  ]
  const [docking, setDocking] = useState<Set<string>>(new Set())
  const toggleDock = (orderId: string) => setDocking((prev) => {
    const next = new Set(prev)
    if (next.has(orderId)) next.delete(orderId)
    else next.add(orderId)
    return next
  })

  const drop = async (orderId: string, externalId: string) => {
    const ok = await confirm({
      title: 'Снять заказ с поставки?',
      body: `Заказ ${externalId} уйдёт из состава — сборщик перестанет его искать, `
        + 'а заказ вернётся в свободный пул кабинета и его возьмёт другая поставка.',
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
    const ids = [...docking]
    if (ids.length === 0) return
    setBusy(true)
    try {
      await dockMpSupplyOrders(detail.doc.id, ids)
      toast(`Добавлено в сборку: ${ids.length}`, 'success')
      setDocking(new Set())
      onChanged()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось добавить заказы', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {canDock && pending.length > 0 && (
        <div
          style={{
            border: '1px solid var(--c-accent-border)', background: 'var(--c-accent-bg)',
            borderRadius: 'var(--r-lg)', padding: '12px 14px', marginBottom: 12,
          }}
        >
          <div className="row gap-8" style={{ fontSize: 12.5, color: 'var(--c-accent-text)' }}>
            <Icon name="inbox" size={14} />
            <span style={{ flex: 1 }}>
              <b>Свободных заказов кабинета: {pending.length}</b> — можно добрать в идущую
              сборку дельтой в ту же задачу кладовщика, без второго прохода по стеллажам.
            </span>
            <button className="btn primary sm" disabled={busy || docking.size === 0} onClick={dock}>
              Добрать выбранные{docking.size > 0 ? ` (${docking.size})` : ''}
            </button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: 8 }}>
            {pending.map((o) => (
              <label
                key={o.order_id}
                className="mono"
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5,
                  color: 'var(--c-text-muted)', cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={docking.has(o.order_id)}
                  onChange={() => toggleDock(o.order_id)}
                />
                {o.external_id} · {cutoffTime(o.created_at_mp)}
                {!o.ready && <span style={{ color: 'var(--c-warning)' }}>с проблемой</span>}
              </label>
            ))}
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

      {picking && <LabelsPanel detail={detail} onChanged={onChanged} />}

      <CancelledPanel detail={detail} />

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
