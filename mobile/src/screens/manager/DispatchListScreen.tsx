import { useCallback } from 'react'
import { useNav } from '../../nav/NavContext'
import { useAuth } from '../../auth/AuthContext'
import {
  getDispatches,
  DISPATCH_STATUS_LABELS,
  dispatchStatusTone,
} from '../../api/dispatchApi'
import { AppBar } from '../../components/AppBar'
import { Icon } from '../../components/Icon'
import { LoadMore } from '../../components/LoadMore'
import { PullToRefresh } from '../../components/PullToRefresh'
import { canCreateDocuments } from '../../utils/access'
import { fmtDate } from '../../utils/format'
import { usePagedList } from '../../hooks/usePagedList'

export function DispatchListScreen() {
  const { openDispatchNew, openDispatchDoc, back } = useNav()
  const { user } = useAuth()
  const canCreate = canCreateDocuments(user?.role)
  const fetchPage = useCallback(
    (page: number, limit: number, signal?: AbortSignal) => getDispatches({ page, limit }, signal),
    [],
  )
  const { items, total, loading, loadingMore, error, refresh, loadMore, hasMore } = usePagedList(fetchPage)

  return (
    <div className="screen">
      <AppBar title="Отгрузки" sub="Документы отгрузки" onBack={back} />
      <PullToRefresh className="scroll pad-nav" onRefresh={refresh}>
        {canCreate && (
          <button className="btn" style={{ width: '100%', marginBottom: 12 }} onClick={openDispatchNew}>
            <Icon name="plus" size={16} /> Новая отгрузка
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
              <Icon name="forklift" size={26} />
            </div>
            <div>Нет отгрузок</div>
          </div>
        ) : (
          <>
            <div className="sec">
              Все документы
              <span className="sec-count">{total}</span>
            </div>
            {items.map((d) => {
              const urgent = d.priority_rank != null && d.priority_rank > 0
              const tone = dispatchStatusTone(d.status)
              const eta = fmtDate(d.ship_date, '')
              return (
                <button key={d.id} className="tile" onClick={() => openDispatchDoc(d.id)}>
                  <div className={`tile-ico${d.cargo_type === 'defect' ? ' gray' : ''}`}>
                    <Icon name="forklift" size={21} />
                  </div>
                  <div className="tile-body">
                    <div className="tile-title">
                      {d.doc_number}
                      {d.client_name ? ` · ${d.client_name}` : ''}
                    </div>
                    <div className="tile-meta">
                      {DISPATCH_STATUS_LABELS[d.status]} · {d.total_qty} шт
                      {d.cargo_type === 'defect' ? ' · брак' : d.cargo_type === 'good_unpacked' ? ' · без упаковки' : ''}
                      {eta ? ` · ${eta}` : ''}
                    </div>
                  </div>
                  {urgent ? (
                    <span className="badge danger">
                      <span className="dot" />
                      Срочно
                    </span>
                  ) : (
                    tone && (
                      <span className={`badge ${tone}`}>
                        <span className="dot" />
                        {DISPATCH_STATUS_LABELS[d.status]}
                      </span>
                    )
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
