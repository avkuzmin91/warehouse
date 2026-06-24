import { useCallback, useEffect, useState } from 'react'
import { useNav } from '../../nav/NavContext'
import { getShipment, SHIPMENT_STATUS_LABELS, type ShipmentDetail } from '../../api/shipmentsApi'
import { AppBar } from '../../components/AppBar'
import { Icon } from '../../components/Icon'
import { fmtDate } from '../../utils/format'

const STATUS_TONE: Record<string, string> = {
  draft: '', packing: 'info', on_packing: 'warning', relocating: 'warning',
  awaiting_trip: 'warning', partially_shipped: 'warning', shipped: 'success',
  completed_no_goods: 'success', cancelled: 'danger',
}

export function PackingDetailScreen({ docId }: { docId: string }) {
  const { back } = useNav()
  const [doc, setDoc] = useState<ShipmentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback((signal?: AbortSignal) => {
    setLoading(true)
    setError('')
    getShipment(docId, signal)
      .then((d) => { if (!signal?.aborted) setDoc(d) })
      .catch((err) => { if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить документ') })
      .finally(() => { if (!signal?.aborted) setLoading(false) })
  }, [docId])

  useEffect(() => {
    const ac = new AbortController()
    load(ac.signal)
    return () => ac.abort()
  }, [load])

  const tone = doc ? (STATUS_TONE[doc.status] ?? '') : ''

  return (
    <div className="screen">
      <AppBar title={doc ? doc.doc_number : 'Задача упаковки'} sub={doc ? SHIPMENT_STATUS_LABELS[doc.status] : ''} onBack={back} noProfile />
      <div className="scroll pad-nav">
        {error && (<div className="alert"><Icon name="alert" size={15} />{error}</div>)}
        {loading || !doc ? (
          !error && <div className="center" style={{ padding: '32px 0' }}><div className="spin" /></div>
        ) : (
          <>
            <div className="summary" style={{ marginBottom: 16 }}>
              <div className="kv"><span className="k">Статус</span>
                <span className="v">{tone ? <span className={`badge ${tone}`}><span className="dot" />{SHIPMENT_STATUS_LABELS[doc.status]}</span> : SHIPMENT_STATUS_LABELS[doc.status]}</span>
              </div>
              <div className="kv"><span className="k">Клиент</span><span className="v">{doc.client_name ?? '—'}</span></div>
              {doc.cargo_type === 'defect' && <div className="kv"><span className="k">Тип</span><span className="v">Брак</span></div>}
              <div className="kv"><span className="k">Упаковка (план)</span><span className="v">{fmtDate(doc.ship_date)}</span></div>
              {doc.comment && (<div className="kv"><span className="k">ТЗ</span><span className="v">{doc.comment}</span></div>)}
            </div>

            <div className="sec">Строки<span className="sec-count">{doc.lines.length}</span></div>
            <div className="line" style={{ padding: '2px 14px' }}>
              {doc.lines.map((l) => (
                <div key={l.id} className="docline">
                  <div className="docline-main">
                    <div className="tile-title" style={{ fontSize: 14 }}>{l.product_name}</div>
                    <div className="tile-meta">{[l.product_sku, l.color_name, l.size_name].filter(Boolean).join(' · ')}{l.store_name ? ` · ${l.store_name}` : ''}</div>
                    {(l.packed_good > 0 || l.packed_defect > 0) && (
                      <div className="tile-meta">упаковано: годный {l.packed_good} · брак {l.packed_defect}</div>
                    )}
                  </div>
                  <div className="docline-qty">
                    <div className="big">{l.qty} шт</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
