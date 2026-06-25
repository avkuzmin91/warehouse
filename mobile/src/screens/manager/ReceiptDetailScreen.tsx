import { useCallback, useEffect, useState } from 'react'
import { useNav } from '../../nav/NavContext'
import { useAuth } from '../../auth/AuthContext'
import {
  getReceiptDetail,
  RECEIPT_STATUS_LABELS,
  receiptStatusTone,
  type ReceiptDetailFull,
} from '../../api/receiptsApi'
import { AppBar } from '../../components/AppBar'
import { Icon } from '../../components/Icon'
import { CollapsibleSection } from '../../components/CollapsibleSection'
import { canCreateDocuments } from '../../utils/access'
import { fmtDate, fmtDateTime } from '../../utils/format'

export function ReceiptDetailScreen({ docId }: { docId: string }) {
  const { back } = useNav()
  const { user } = useAuth()
  const viewOnly = !canCreateDocuments(user?.role)
  const [detail, setDetail] = useState<ReceiptDetailFull | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback((signal?: AbortSignal) => {
    setLoading(true)
    setError('')
    getReceiptDetail(docId, signal)
      .then((d) => { if (!signal?.aborted) setDetail(d) })
      .catch((err) => { if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить документ') })
      .finally(() => { if (!signal?.aborted) setLoading(false) })
  }, [docId])

  useEffect(() => {
    const ac = new AbortController()
    load(ac.signal)
    return () => ac.abort()
  }, [load])

  const doc = detail?.doc
  const tone = doc ? receiptStatusTone(doc.status) : ''

  return (
    <div className="screen">
      <AppBar title={doc ? doc.doc_number : 'Поступление'} sub={doc ? RECEIPT_STATUS_LABELS[doc.status] : ''} onBack={back} noProfile />
      <div className="scroll pad-nav">
        {error && (
          <div className="alert"><Icon name="alert" size={15} />{error}</div>
        )}
        {loading || !doc ? (
          !error && <div className="center" style={{ padding: '32px 0' }}><div className="spin" /></div>
        ) : (
          <>
            {viewOnly && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                <span className="pill"><Icon name="eye" size={13} /> Просмотр</span>
              </div>
            )}
            <div className="summary" style={{ marginBottom: 16 }}>
              <div className="kv"><span className="k">Статус</span>
                <span className="v">{tone ? <span className={`badge ${tone}`}><span className="dot" />{RECEIPT_STATUS_LABELS[doc.status]}</span> : RECEIPT_STATUS_LABELS[doc.status]}</span>
              </div>
              <div className="kv"><span className="k">Клиент</span><span className="v">{doc.client_name ?? '—'}</span></div>
              <div className="kv"><span className="k">Прибытие (план)</span><span className="v">{fmtDate(doc.arrival_date)}</span></div>
              <div className="kv"><span className="k">Прибытие (факт)</span><span className="v">{fmtDate(doc.actual_arrival_date)}</span></div>
              {doc.logistics_cost != null && (
                <div className="kv"><span className="k">Логистика</span><span className="v mono">{doc.logistics_cost} ₽</span></div>
              )}
              {doc.comment && (
                <div className="kv"><span className="k">Комментарий</span><span className="v">{doc.comment}</span></div>
              )}
            </div>

            <div className="sec">Строки<span className="sec-count">{detail.lines.length}</span></div>
            <div className="line" style={{ padding: '2px 14px' }}>
              {detail.lines.map((l) => (
                <div key={l.id} className="docline">
                  <div className="docline-main">
                    <div className="tile-title" style={{ fontSize: 14 }}>{l.product_name ?? '—'}</div>
                    <div className="tile-meta">{[l.product_sku, l.color_name, l.size_name].filter(Boolean).join(' · ')}</div>
                  </div>
                  <div className="docline-qty">
                    <div className="big">план {l.planned_qty}</div>
                    {l.accepted_qty != null && <div className="small">принято {l.accepted_qty}</div>}
                  </div>
                </div>
              ))}
            </div>

            {detail.ops.length > 0 && (
              <CollapsibleSection title="История" count={detail.ops.length} style={{ marginTop: 16 }}>
                <div className="line" style={{ padding: '2px 14px' }}>
                  {detail.ops.map((op) => (
                    <div key={op.id} className="oprow">
                      <div className="oprow-t">{op.comment ?? op.op_type}</div>
                      <div className="oprow-m">{fmtDateTime(op.created_at)}{op.created_by_email ? ` · ${op.created_by_email}` : ''}</div>
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            )}
          </>
        )}
      </div>
    </div>
  )
}
