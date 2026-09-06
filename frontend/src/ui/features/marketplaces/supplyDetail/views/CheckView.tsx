import { useState } from 'react'
import { setMpSupplyOrders } from '../../../../../api/marketplacesApi'
import type { MpSupplyDetail } from '../../../../../api/marketplacesApi'
import { useToast } from '../../../../feedback/Toast'
import { BlockersPanel } from '../components/BlockersPanel'
import { CancelledPanel } from '../components/CancelledPanel'
import { LabelsPanel } from '../components/LabelsPanel'
import { PickListTable, PickListTotals } from '../components/PickListTable'
import { SupplyOrdersTable } from '../components/SupplyOrdersTable'

/** Фаза «Проверка» — первый экран поставки: состав уже выбран при заведении, здесь
 *  его проверяют и передают площадке. Блокеры сверху, дальше — лист подбора
 *  (вкладка по умолчанию) и состав только для чтения: перевыбор заказов — отдельное
 *  действие «Скорректировать», как при создании, и только до передачи площадке. */
export function CheckView({ detail, onChanged }: {
  detail: MpSupplyDetail
  onChanged: () => void
}) {
  const toast = useToast()
  const [tab, setTab] = useState<'pick' | 'orders'>('pick')
  const [busy, setBusy] = useState(false)
  const selected = detail.orders.filter((o) => o.state === 'selected')
  const problem = selected.filter((o) => !o.ready)
  const transferred = !!detail.doc.mp_transferred_at

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

      <CancelledPanel detail={detail} />

      <LabelsPanel detail={detail} onChanged={onChanged} />

      <div className="row gap-8" style={{ marginBottom: 10 }}>
        <div className="tabs">
          <button className={`tab ${tab === 'pick' ? 'active' : ''}`} onClick={() => setTab('pick')}>
            Лист подбора<span className="tab-count">{detail.pick_list.length}</span>
          </button>
          <button className={`tab ${tab === 'orders' ? 'active' : ''}`} onClick={() => setTab('orders')}>
            Состав<span className="tab-count">{selected.length}</span>
          </button>
        </div>
        {problem.length > 0 && !transferred && (
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
        <SupplyOrdersTable orders={selected} phase="pick" />
      )}
    </>
  )
}
