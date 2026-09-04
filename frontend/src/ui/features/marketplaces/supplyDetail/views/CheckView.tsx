import { useState } from 'react'
import { setMpSupplyOrders } from '../../../../../api/marketplacesApi'
import type { MpSupplyDetail } from '../../../../../api/marketplacesApi'
import { useToast } from '../../../../feedback/Toast'
import { BlockersPanel } from '../components/BlockersPanel'
import { PickListTable, PickListTotals } from '../components/PickListTable'
import { SupplyOrdersTable } from '../components/SupplyOrdersTable'

/** Фаза «Проверка»: блокеры сверху, дальше — лист подбора (вкладка по умолчанию).
 *  Проблемные заказы можно не снимать на «Составе», а исключить здесь: два входа
 *  в одно решение, какой удобнее — тот и рабочий. */
export function CheckView({ detail, onChanged }: { detail: MpSupplyDetail; onChanged: () => void }) {
  const toast = useToast()
  const [tab, setTab] = useState<'pick' | 'orders'>('pick')
  const [busy, setBusy] = useState(false)
  const selected = detail.orders.filter((o) => o.state === 'selected')
  const problem = selected.filter((o) => !o.ready)

  const excludeProblem = async () => {
    setBusy(true)
    try {
      await setMpSupplyOrders(detail.doc.id, selected.filter((o) => o.ready).map((o) => o.order_id))
      toast(`Исключено заказов: ${problem.length}`, 'success')
      onChanged()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось исключить заказы', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <BlockersPanel blockers={detail.blockers} accountId={detail.doc.account_id} />

      <div className="row gap-8" style={{ marginBottom: 10 }}>
        <div className="tabs">
          <button className={`tab ${tab === 'pick' ? 'active' : ''}`} onClick={() => setTab('pick')}>
            Лист подбора<span className="tab-count">{detail.pick_list.length}</span>
          </button>
          <button className={`tab ${tab === 'orders' ? 'active' : ''}`} onClick={() => setTab('orders')}>
            Заказы<span className="tab-count">{selected.length}</span>
          </button>
        </div>
        {problem.length > 0 && (
          <button className="btn sm" style={{ marginLeft: 'auto' }} disabled={busy} onClick={excludeProblem}>
            Исключить {problem.length} проблемн{problem.length === 1 ? 'ый заказ' : 'ых заказа'}
          </button>
        )}
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
