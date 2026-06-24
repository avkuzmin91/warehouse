import { useCallback } from 'react'
import { useNav } from '../../nav/NavContext'
import { useAuth } from '../../auth/AuthContext'
import {
  getReceipts,
  RECEIPT_STATUS_LABELS,
  receiptStatusTone,
} from '../../api/receiptsApi'
import { AppBar } from '../../components/AppBar'
import { Icon } from '../../components/Icon'
import { LoadMore } from '../../components/LoadMore'
import { PullToRefresh } from '../../components/PullToRefresh'
import { canCreateDocuments } from '../../utils/access'
import { fmtDate } from '../../utils/format'
import { usePagedList } from '../../hooks/usePagedList'

export function ReceiptsListScreen() {
  const { openReceiptNew, openReceiptDoc, back } = useNav()
  const { user } = useAuth()
  const canCreate = canCreateDocuments(user?.role)
  const fetchPage = useCallback(
    (page: number, limit: number, signal?: AbortSignal) => getReceipts({ page, limit }, signal),
    [],
  )
  const { items, total, loading, loadingMore, error, refresh, loadMore, hasMore } = usePagedList(fetchPage)

  return (
    <div className="screen">
      <AppBar title="Поступления" sub="Документы приёмки" onBack={back} />
      <PullToRefresh className="scroll pad-nav" onRefresh={refresh}>
        {canCreate && (
          <button className="btn" style={{ width: '100%', marginBottom: 12 }} onClick={openReceiptNew}>
            <Icon name="plus" size={16} /> Новое поступление
          </button>
        )}
        {error && (
          <div className="alert">
            <Icon name="alert" size={15} />
            {error}
          </div>
        )}
        {loading ? (
          <div className="center">
            <div className="spin" />
            <div>Загрузка…</div>
          </div>
        ) : items.length === 0 ? (
          <div className="center">
            <div className="center-ico">
              <Icon name="dolly" size={26} />
            </div>
            <div>Нет поступлений</div>
          </div>
        ) : (
          <>
            <div className="sec">
              Все документы
              <span className="sec-count">{total}</span>
            </div>
            {items.map((r) => {
              const tone = receiptStatusTone(r.status)
              const eta = fmtDate(r.arrival_date, '')
              return (
                <button key={r.id} className="tile" onClick={() => openReceiptDoc(r.id)}>
                  <div className="tile-ico">
                    <Icon name="dolly" size={21} />
                  </div>
                  <div className="tile-body">
                    <div className="tile-title">
                      {r.doc_number}
                      {r.client_name ? ` · ${r.client_name}` : ''}
                    </div>
                    <div className="tile-meta">
                      {RECEIPT_STATUS_LABELS[r.status]} · план {r.total_planned} шт
                      {eta ? ` · ${eta}` : ''}
                    </div>
                  </div>
                  {tone && (
                    <span className={`badge ${tone}`}>
                      <span className="dot" />
                      {RECEIPT_STATUS_LABELS[r.status]}
                    </span>
                  )}
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
