import { useCallback, useEffect, useState } from 'react'
import { useNav } from '../../nav/NavContext'
import {
  getReceipts,
  RECEIPT_STATUS_LABELS,
  receiptStatusTone,
  type ReceiptListItem,
} from '../../api/receiptsApi'
import { AppBar } from '../../components/AppBar'
import { Icon } from '../../components/Icon'
import { PullToRefresh } from '../../components/PullToRefresh'

function fmtDate(d: string | null): string {
  if (!d) return ''
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return ''
  return dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function ReceiptsListScreen() {
  const { openReceiptNew } = useNav()
  const [items, setItems] = useState<ReceiptListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback((signal?: AbortSignal, silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    return getReceipts({ limit: 50 }, signal)
      .then((res) => setItems(res.items))
      .catch((err) => {
        if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить поступления')
      })
      .finally(() => {
        if (!signal?.aborted) setLoading(false)
      })
  }, [])

  useEffect(() => {
    const ac = new AbortController()
    load(ac.signal)
    return () => ac.abort()
  }, [load])

  return (
    <div className="screen">
      <AppBar title="Поступления" sub="Документы приёмки" />
      <PullToRefresh className="scroll pad-nav" onRefresh={() => load(undefined, true)}>
        <button className="btn" style={{ width: '100%', marginBottom: 12 }} onClick={openReceiptNew}>
          <Icon name="plus" size={16} /> Новое поступление
        </button>
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
              <Icon name="truckIn" size={26} />
            </div>
            <div>Нет поступлений</div>
          </div>
        ) : (
          <>
            <div className="sec">
              Все документы
              <span className="sec-count">{items.length}</span>
            </div>
            {items.map((r) => {
              const tone = receiptStatusTone(r.status)
              const eta = fmtDate(r.arrival_date)
              return (
                <button key={r.id} className="tile" onClick={() => openReceiptDoc(r.id)}>
                  <div className="tile-ico">
                    <Icon name="truckIn" size={21} />
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
          </>
        )}
      </PullToRefresh>
    </div>
  )
}
