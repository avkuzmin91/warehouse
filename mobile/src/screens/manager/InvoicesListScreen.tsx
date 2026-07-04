import { useCallback, useEffect, useState } from 'react'
import { useNav } from '../../nav/NavContext'
import {
  getInvoiceAlerts,
  getInvoices,
  invoiceStatusTone,
  INVOICE_STATUS_LABELS,
  type InvoiceAlerts,
  type InvoiceStatus,
} from '../../api/invoicesApi'
import { AppBar } from '../../components/AppBar'
import { Icon } from '../../components/Icon'
import { LoadMore } from '../../components/LoadMore'
import { PullToRefresh } from '../../components/PullToRefresh'
import { fmtDate, formatMoneyKopecks } from '../../utils/format'
import { usePagedList } from '../../hooks/usePagedList'

export function InvoicesListScreen() {
  const { back, openInvoiceDoc, openUninvoiced } = useNav()
  const [alerts, setAlerts] = useState<InvoiceAlerts | null>(null)

  const fetchPage = useCallback(
    (page: number, limit: number, signal?: AbortSignal) => getInvoices({ page, limit }, signal),
    [],
  )
  const { items, total, loading, loadingMore, error, refresh, loadMore, hasMore } = usePagedList(fetchPage)

  useEffect(() => {
    const ac = new AbortController()
    getInvoiceAlerts(ac.signal)
      .then((a) => { if (!ac.signal.aborted) setAlerts(a) })
      .catch(() => {})
    return () => ac.abort()
  }, [])

  return (
    <div className="screen">
      <AppBar title="Счета" sub="Финансы" onBack={back} />
      <PullToRefresh className="scroll pad-nav" onRefresh={refresh}>
        {alerts && (
          <div className="summary" style={{ marginBottom: 12 }}>
            <div className="kv"><span className="k">Активные</span><span className="v">{alerts.active_count}</span></div>
            <div className="kv"><span className="k">К получению</span><span className="v mono">{formatMoneyKopecks(alerts.active_outstanding)}</span></div>
            {alerts.overdue_count > 0 && (
              <div className="kv"><span className="k">Просрочено</span>
                <span className="v"><span className="badge danger"><span className="dot" />{alerts.overdue_count}</span></span>
              </div>
            )}
          </div>
        )}

        <button className="tile" onClick={openUninvoiced}>
          <div className="tile-ico"><Icon name="folder" size={21} /></div>
          <div className="tile-body">
            <div className="tile-title">Без счёта</div>
            <div className="tile-meta">Отгрузки, поступления и работы без счёта</div>
          </div>
          <span className="tile-chev"><Icon name="chev" size={18} /></span>
        </button>

        {error && (<div className="alert"><Icon name="alert" size={15} />{error}</div>)}
        {loading ? (
          <div className="center"><div className="spin" /><div>Загрузка…</div></div>
        ) : items.length === 0 ? (
          <div className="center">
            <div className="center-ico"><Icon name="file" size={26} /></div>
            <div>Нет счетов</div>
          </div>
        ) : (
          <>
            <div className="sec">Счета<span className="sec-count">{total}</span></div>
            {items.map((inv) => {
              const tone = inv.overdue && (inv.status === 'issued' || inv.status === 'partially_paid')
                ? 'danger'
                : invoiceStatusTone(inv.status as InvoiceStatus)
              return (
                <button key={inv.id} className="tile" onClick={() => openInvoiceDoc(inv.id)}>
                  <div className="tile-ico"><Icon name="file" size={21} /></div>
                  <div className="tile-body">
                    <div className="tile-title">{inv.doc_number}{inv.client_name ? ` · ${inv.client_name}` : ''}</div>
                    <div className="tile-meta">
                      {formatMoneyKopecks(inv.total_amount)}
                      {inv.paid_amount > 0 ? ` · оплачено ${formatMoneyKopecks(inv.paid_amount)}` : ''}
                      {inv.due_date ? ` · срок ${fmtDate(inv.due_date)}` : ''}
                    </div>
                  </div>
                  <span className={`badge ${tone}`}>
                    <span className="dot" />
                    {inv.overdue && (inv.status === 'issued' || inv.status === 'partially_paid')
                      ? 'Просрочен'
                      : INVOICE_STATUS_LABELS[inv.status as InvoiceStatus]}
                  </span>
                  <span className="tile-chev"><Icon name="chev" size={18} /></span>
                </button>
              )
            })}
            <LoadMore shown={items.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onMore={loadMore} />
          </>
        )}
      </PullToRefresh>
    </div>
  )
}
