import { useState } from 'react'
import type { MpSupplyOrderItem } from '../../../../../api/marketplacesApi'
import { EmptyState } from '../../../../primitives/EmptyState'
import { OrderPickTable } from './OrderPickTable'

type Tab = 'all' | 'ready' | 'problem'

const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'ready', label: 'Готовые' },
  { key: 'problem', label: 'С проблемой' },
]

/** Выбор состава галочками — один экран для заведения поставки и корректировки.
 *  Здесь только выбор: записывает его владелец кнопкой шапки, целиком, поэтому
 *  закрытая вкладка ничего не сохраняет.
 *
 *  Заказ с блокером остаётся выбираемым осознанно: связки и остаток чинят на
 *  «Проверке», поэтому цена выбора проговаривается в итоге, а не прячется за
 *  молча снятой галочкой. */
export function OrderSelectionPanel({ orders, selected, onChange, accountId, disabled, emptyTitle, emptySub }: {
  orders: MpSupplyOrderItem[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
  accountId: string
  disabled?: boolean
  emptyTitle: string
  emptySub?: string
}) {
  const [tab, setTab] = useState<Tab>('all')

  if (orders.length === 0) return <EmptyState title={emptyTitle} sub={emptySub} />

  const readyCount = orders.filter((o) => o.blockers.length === 0).length
  const problemCount = orders.length - readyCount
  const visible = orders.filter((o) => (
    tab === 'all' ? true : tab === 'ready' ? o.blockers.length === 0 : o.blockers.length > 0
  ))
  const allVisibleSelected = visible.length > 0 && visible.every((o) => selected.has(o.order_id))

  const toggle = (orderId: string) => {
    const next = new Set(selected)
    if (next.has(orderId)) next.delete(orderId)
    else next.add(orderId)
    onChange(next)
  }

  const toggleVisible = () => {
    const next = new Set(selected)
    for (const o of visible) {
      if (allVisibleSelected) next.delete(o.order_id)
      else next.add(o.order_id)
    }
    onChange(next)
  }

  const addReady = () => onChange(new Set([
    ...selected,
    ...orders.filter((o) => o.blockers.length === 0).map((o) => o.order_id),
  ]))

  const chosen = orders.filter((o) => selected.has(o.order_id))
  const chosenQty = chosen.reduce((n, o) => n + o.total_qty, 0)
  const chosenCells = new Set(chosen.flatMap((o) => o.cells)).size
  const chosenBlocked = chosen.filter((o) => o.blockers.length > 0).length

  const summaryTone = chosen.length === 0 || chosenBlocked > 0
    ? { border: 'var(--c-warning)', bg: 'var(--c-warning-bg)', text: 'var(--c-warning)' }
    : { border: 'var(--c-accent-border)', bg: 'var(--c-accent-bg)', text: 'var(--c-accent-text)' }

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
              <span
                className="tab-count"
                style={t.key === 'problem' && problemCount > 0 ? { color: 'var(--c-warning)' } : undefined}
              >
                {t.key === 'all' ? orders.length : t.key === 'ready' ? readyCount : problemCount}
              </span>
            </button>
          ))}
        </div>
        <button
          className="btn sm"
          style={{ marginLeft: 'auto' }}
          title="Добавляет готовые заказы к текущему выбору"
          disabled={disabled}
          onClick={addReady}
        >
          Добавить готовые
        </button>
      </div>

      <OrderPickTable
        orders={visible}
        selected={selected}
        accountId={accountId}
        onToggle={toggle}
        onToggleAll={toggleVisible}
        disabled={disabled}
      />

      <div
        className="row gap-8"
        style={{
          position: 'sticky', bottom: 0, zIndex: 1,
          marginTop: 8, padding: '10px 14px', gap: 20, fontSize: 12.5,
          border: `1px solid ${summaryTone.border}`, background: summaryTone.bg,
          borderRadius: 'var(--r-lg)', color: summaryTone.text,
        }}
      >
        <span>Выбрано <b>{chosen.length} из {orders.length}</b></span>
        <span>{chosenQty} шт.</span>
        <span>{chosenCells} ячеек</span>
        <span style={{ marginLeft: 'auto', textAlign: 'right' }}>
          {chosenBlocked > 0 ? (
            <>Собрать нельзя: <b>{chosenBlocked}</b> из выбранных с проблемой — решается на «Проверке»</>
          ) : chosen.length === 0 ? (
            <>Ничего не выбрано — поставке нечего везти</>
          ) : orders.length - chosen.length > 0 ? (
            <>Остаются в пуле: <b>{orders.length - chosen.length}</b> — их возьмёт следующая поставка</>
          ) : null}
        </span>
      </div>
    </>
  )
}
