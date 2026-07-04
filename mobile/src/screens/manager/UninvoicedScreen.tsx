import { useCallback, useState } from 'react'
import { useNav } from '../../nav/NavContext'
import {
  getUninvoicedExtraIncome,
  getUninvoicedReceipts,
  getUninvoicedShipments,
} from '../../api/invoicesApi'
import { AppBar } from '../../components/AppBar'
import { Icon } from '../../components/Icon'
import { LoadMore } from '../../components/LoadMore'
import { PullToRefresh } from '../../components/PullToRefresh'
import { fmtDate, formatMoneyKopecks } from '../../utils/format'
import { usePagedList } from '../../hooks/usePagedList'

type Tab = 'shipments' | 'receipts' | 'extra'

// «Без счёта»: документы и работы, на которые ещё не выставлен счёт. Мобилка —
// витрина-просмотр; выставление счёта остаётся в вебе.
export function UninvoicedScreen() {
  const { back } = useNav()
  const [tab, setTab] = useState<Tab>('shipments')

  const fetchPage = useCallback(
    (page: number, limit: number, signal?: AbortSignal) => {
      if (tab === 'shipments') {
        return getUninvoicedShipments({ page, limit }, signal).then((r) => ({
          ...r,
          items: r.items.map((s) => ({
            id: s.id,
            title: `${s.doc_number}${s.client_name ? ` · ${s.client_name}` : ''}`,
            meta: `${s.total_qty} шт · ${s.sku_count} SKU${s.ship_date ? ` · ${fmtDate(s.ship_date)}` : ''}`,
          })),
        }))
      }
      if (tab === 'receipts') {
        return getUninvoicedReceipts({ page, limit }, signal).then((r) => ({
          ...r,
          items: r.items.map((s) => ({
            id: s.id,
            title: `${s.doc_number}${s.client_name ? ` · ${s.client_name}` : ''}`,
            meta: `${s.total_qty} шт · логистика ${formatMoneyKopecks(s.logistics_cost_kop)}${s.arrival_date ? ` · ${fmtDate(s.arrival_date)}` : ''}`,
          })),
        }))
      }
      return getUninvoicedExtraIncome({ page, limit }, signal).then((r) => ({
        ...r,
        items: r.items.map((e) => ({
          id: e.id,
          title: `${e.category_name ?? 'Доп. работа'}${e.client_name ? ` · ${e.client_name}` : ''}`,
          meta: `${formatMoneyKopecks(e.amount_kop)} · ${fmtDate(e.entry_date)}`,
        })),
      }))
    },
    [tab],
  )
  const { items, total, loading, loadingMore, error, refresh, loadMore, hasMore } = usePagedList(fetchPage)

  return (
    <div className="screen">
      <AppBar title="Без счёта" sub="Ожидают выставления" onBack={back} noProfile />
      <PullToRefresh className="scroll pad-nav" onRefresh={refresh}>
        <div className="seg" style={{ marginBottom: 12 }}>
          <button type="button" className={tab === 'shipments' ? 'active' : ''} onClick={() => setTab('shipments')}>Отгрузки</button>
          <button type="button" className={tab === 'receipts' ? 'active' : ''} onClick={() => setTab('receipts')}>Поступления</button>
          <button type="button" className={tab === 'extra' ? 'active' : ''} onClick={() => setTab('extra')}>Работы</button>
        </div>

        {error && (<div className="alert"><Icon name="alert" size={15} />{error}</div>)}
        {loading ? (
          <div className="center"><div className="spin" /><div>Загрузка…</div></div>
        ) : items.length === 0 ? (
          <div className="center">
            <div className="center-ico"><Icon name="check" size={26} /></div>
            <div>Всё выставлено</div>
          </div>
        ) : (
          <>
            <div className="sec">Без счёта<span className="sec-count">{total}</span></div>
            <div className="line" style={{ padding: '2px 14px' }}>
              {items.map((it) => (
                <div key={it.id} className="oprow">
                  <div className="oprow-t">{it.title}</div>
                  <div className="oprow-m">{it.meta}</div>
                </div>
              ))}
            </div>
            <LoadMore shown={items.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onMore={loadMore} />
            <div
              className="line-sub"
              style={{ textAlign: 'center', marginTop: 12, color: 'var(--c-text-faint)' }}
            >
              Выставление счетов — в веб-версии
            </div>
          </>
        )}
      </PullToRefresh>
    </div>
  )
}
