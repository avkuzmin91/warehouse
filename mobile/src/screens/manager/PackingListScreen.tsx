import { useCallback } from 'react'
import { useNav } from '../../nav/NavContext'
import { useAuth } from '../../auth/AuthContext'
import { listShipments, SHIPMENT_STATUS_LABELS } from '../../api/shipmentsApi'
import { AppBar } from '../../components/AppBar'
import { Icon } from '../../components/Icon'
import { LoadMore } from '../../components/LoadMore'
import { PullToRefresh } from '../../components/PullToRefresh'
import { canCreateDocuments } from '../../utils/access'
import { fmtDate } from '../../utils/format'
import { usePagedList } from '../../hooks/usePagedList'

const STATUS_TONE: Record<string, string> = {
  draft: '',
  packing: 'info',
  on_packing: 'warning',
  relocating: 'warning',
  completed_no_goods: 'success',
  cancelled: 'danger',
}

export function PackingListScreen() {
  const { openShipmentNew, openPackingDoc, back } = useNav()
  const { user } = useAuth()
  const canCreate = canCreateDocuments(user?.role)
  const fetchPage = useCallback(
    (page: number, limit: number, signal?: AbortSignal) => listShipments({ page, limit }, signal),
    [],
  )
  const { items, total, loading, loadingMore, error, refresh, loadMore, hasMore } = usePagedList(fetchPage)

  return (
    <div className="screen">
      <AppBar title="Упаковка" sub="Задачи упаковки" onBack={back} />
      <PullToRefresh className="scroll pad-nav" onRefresh={refresh}>
        {canCreate && (
          <button className="btn" style={{ width: '100%', marginBottom: 12 }} onClick={openShipmentNew}>
            <Icon name="plus" size={16} /> Новая задача упаковки
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
              <Icon name="box" size={26} />
            </div>
            <div>Нет задач упаковки</div>
          </div>
        ) : (
          <>
            <div className="sec">
              Все задачи
              <span className="sec-count">{total}</span>
            </div>
            {items.map((s) => {
              const urgent = s.priority_rank != null && s.priority_rank > 0
              const tone = STATUS_TONE[s.status] ?? ''
              const eta = fmtDate(s.ship_date, '')
              return (
                <button key={s.id} className="tile" onClick={() => openPackingDoc(s.id)}>
                  <div className={`tile-ico${s.cargo_type === 'defect' ? ' gray' : ''}`}>
                    <Icon name={s.cargo_type === 'defect' ? 'refresh' : 'box'} size={21} />
                  </div>
                  <div className="tile-body">
                    <div className="tile-title">
                      {s.doc_number}
                      {s.client_name ? ` · ${s.client_name}` : ''}
                    </div>
                    <div className="tile-meta">
                      {SHIPMENT_STATUS_LABELS[s.status]} · {s.total_qty} шт
                      {s.cargo_type === 'defect' ? ' · брак' : ''}
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
                        {SHIPMENT_STATUS_LABELS[s.status]}
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
