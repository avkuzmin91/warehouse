import { useCallback, useEffect, useRef, useState } from 'react'
import { newRequestId } from '../api/http'
import { useNav } from '../nav/NavContext'
import {
  finishPutaway,
  getShipment,
  takeShipmentBox,
  SHIPMENT_BOX_STATUS_LABELS,
  type ShipmentBox,
  type ShipmentDetail,
  type ShipmentLine,
} from '../api/shipmentsApi'
import { getLocationByCode } from '../api/locationsApi'
import { AppBar } from '../components/AppBar'
import { Icon } from '../components/Icon'
import { PackLineSheet } from '../components/PackLineSheet'
import { PullToRefresh } from '../components/PullToRefresh'
import { ConfirmAction } from '../components/ConfirmAction'
import { scanSource } from '../scan/ScanSource'
import { scanNotFoundFeedback, scanSuccessFeedback } from '../utils/feedback'
import { variantTitle } from '../utils/format'

const BOX_TONE: Record<ShipmentBox['status'], string> = {
  open: 'warning',
  closed: 'info',
  placed: 'success',
}

/** Задача «Упаковка с ТСД»: два шага на одном экране.
 *
 * 1. Упаковка — начальник смены вносит годный/брак (как в обычной задаче упаковки:
 *    отсюда объём и заработок).
 * 2. Короба — упакованное сканируется в короб, короб закрывается и уезжает в ячейку.
 * Задача закрывается, когда всё упакованное разложено по коробам, а короба — по ячейкам.
 */
export function PutawayTaskScreen({ shipmentId }: { shipmentId: string }) {
  const { back, openPutawayBox } = useNav()
  const [doc, setDoc] = useState<ShipmentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [packLine, setPackLine] = useState<ShipmentLine | null>(null)
  const [confirmFinish, setConfirmFinish] = useState(false)
  const [defectZoneId, setDefectZoneId] = useState<string | null>(null)
  const [defectZoneName, setDefectZoneName] = useState<string | null>(null)

  const load = useCallback((signal?: AbortSignal) => {
    setError('')
    return getShipment(shipmentId, signal)
      .then((d) => { if (!signal?.aborted) setDoc(d) })
      .catch((err) => { if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить задачу') })
      .finally(() => { if (!signal?.aborted) setLoading(false) })
  }, [shipmentId])

  useEffect(() => {
    const ac = new AbortController()
    void load(ac.signal)
    return () => ac.abort()
  }, [load])

  const refreshAc = useRef<AbortController | null>(null)
  const refresh = useCallback(() => {
    refreshAc.current?.abort()
    const ac = new AbortController()
    refreshAc.current = ac
    return load(ac.signal)
  }, [load])
  useEffect(() => () => refreshAc.current?.abort(), [])

  const boxes = doc?.boxes ?? []
  const lines = doc?.lines ?? []
  const planTotal = lines.reduce((s, l) => s + l.qty, 0)
  const poolTotal = lines.reduce((s, l) => s + l.available_for_pack, 0)
  // Упаковано и ещё не разложено по коробам — это и есть очередь на сборку коробов.
  const toBoxTotal = lines.reduce((s, l) => s + l.packed_pending_good, 0)
  const boxedTotal = lines.reduce((s, l) => s + l.boxed_qty, 0)
  const placedTotal = lines.reduce((s, l) => s + l.placed_qty, 0)
  const defectTotal = lines.reduce((s, l) => s + l.packed_pending_defect, 0)
  const pendingBoxes = boxes.filter((b) => b.status !== 'placed')
  const onPacking = doc?.status === 'on_packing'
  const canFinish = onPacking && pendingBoxes.length === 0 && toBoxTotal === 0

  async function onTakeBox() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const code = await scanSource.scan()
      if (!code) return
      const box = await takeShipmentBox(shipmentId, code, newRequestId())
      scanSuccessFeedback()
      openPutawayBox(shipmentId, box.id)
    } catch (err) {
      scanNotFoundFeedback()
      setError(err instanceof Error ? err.message : 'Короб не принят')
    } finally {
      setBusy(false)
    }
  }

  async function onScanDefectZone() {
    setError('')
    try {
      const code = await scanSource.scan()
      if (!code) return
      const res = await getLocationByCode(code)
      if (!res.found || !res.location) {
        scanNotFoundFeedback()
        setError(`Место по коду «${code}» не найдено`)
        return
      }
      scanSuccessFeedback()
      setDefectZoneId(res.location.id)
      setDefectZoneName(res.location.code)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Сканирование не удалось')
    }
  }

  async function onFinish() {
    setBusy(true)
    setError('')
    try {
      await finishPutaway(shipmentId, defectZoneId, newRequestId())
      setConfirmFinish(false)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось закрыть задачу')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen">
      <AppBar
        title={doc?.doc_number ?? 'Упаковка с ТСД'}
        sub={doc ? `Упаковка с ТСД · ${doc.client_name ?? '—'}` : undefined}
        onBack={back}
      />

      <PullToRefresh className="scroll pad-nav" onRefresh={refresh}>
        {loading ? (
          <div className="center"><div className="spin" /></div>
        ) : (
          <>
            <div className="summary">
              <div className="kv">
                <span className="k">Разложено по ячейкам</span>
                <span className="v">{placedTotal} из {planTotal}</span>
              </div>
              <div className="kv">
                <span className="k">На столе (не упаковано)</span>
                <span className="v">{poolTotal}</span>
              </div>
              <div className="kv">
                <span className="k">Упаковано, ждёт короб</span>
                <span className="v">{toBoxTotal}</span>
              </div>
              <div className="kv">
                <span className="k">В коробах</span>
                <span className="v">{boxedTotal}</span>
              </div>
              {defectTotal > 0 && (
                <div className="kv">
                  <span className="k">Брак</span>
                  <span className="v">{defectTotal}</span>
                </div>
              )}
            </div>

            <div className="sec">
              1. Упаковка — годный / брак
              <span className="sec-count">{lines.length}</span>
            </div>
            {lines.map((l) => (
              <div key={l.id} className="line">
                <div className="line-name">{variantTitle(l.product_name, [l.color_name, l.size_name])}</div>
                <div className="line-sub mono">{l.product_sku}</div>
                <div className="line-sub">
                  План {l.qty} · упаковано <b style={{ color: 'var(--c-success)' }}>{l.packed_good}</b>
                  {l.packed_defect > 0 && <> · брак <b style={{ color: 'var(--c-danger)' }}>{l.packed_defect}</b></>}
                </div>
                <div className="line-sub">
                  В коробах {l.boxed_qty} · размещено {l.placed_qty}
                  {l.packed_pending_good > 0 && (
                    <span style={{ color: 'var(--c-warning)' }}> · ждёт короб {l.packed_pending_good}</span>
                  )}
                </div>
                {onPacking && (
                  <button className="btn sm" style={{ width: '100%', marginTop: 4 }} onClick={() => setPackLine(l)}>
                    <Icon name="edit" size={15} /> Внести упаковку
                  </button>
                )}
              </div>
            ))}

            <div className="sec">
              2. Короба — скан товара и ячейки
              <span className="sec-count">{boxes.length}</span>
            </div>
            {onPacking && (
              <button className="btn" style={{ width: '100%' }} disabled={busy} onClick={() => { void onTakeBox() }}>
                <Icon name="qr" size={18} /> Взять короб — скан этикетки
              </button>
            )}
            {boxes.length === 0 ? (
              <div className="line">
                <div className="line-sub">
                  Наклейте на короб напечатанную этикетку и отсканируйте её — откроется короб,
                  в него сканируется упакованный товар, затем короб закрывается и ставится в ячейку.
                </div>
              </div>
            ) : (
              boxes.map((b) => (
                <button
                  key={b.id}
                  className="tile"
                  disabled={b.status === 'placed'}
                  onClick={() => openPutawayBox(shipmentId, b.id)}
                >
                  <div className="tile-body">
                    <div className="tile-title">{b.doc_number}</div>
                    <div className="tile-meta">
                      {b.items_qty} шт.{b.zone_name ? ` · ${b.zone_name}` : ''}
                    </div>
                  </div>
                  <span className={`badge ${BOX_TONE[b.status]}`}>{SHIPMENT_BOX_STATUS_LABELS[b.status]}</span>
                </button>
              ))
            )}

            <div className="actionbar">
              {error && (
                <div className="alert">
                  <Icon name="alert" size={15} />
                  {error}
                </div>
              )}
              {onPacking && defectTotal > 0 && (
                <button className="btn ghost" onClick={() => { void onScanDefectZone() }}>
                  <Icon name="qr" size={16} />
                  {defectZoneName ? `Ячейка брака: ${defectZoneName}` : `Ячейка для брака (${defectTotal} шт.)`}
                </button>
              )}
              {onPacking && toBoxTotal > 0 && (
                <div className="line-sub" style={{ color: 'var(--c-warning)', textAlign: 'center' }}>
                  Упаковано и не в коробах: {toBoxTotal} шт
                </div>
              )}
              {onPacking && pendingBoxes.length > 0 && (
                <div className="line-sub" style={{ color: 'var(--c-warning)', textAlign: 'center' }}>
                  Не размещено коробов: {pendingBoxes.length}
                </div>
              )}
              {canFinish && (
                <ConfirmAction
                  label={<><Icon name="check" size={18} /> Задача выполнена</>}
                  prompt={`Разложено ${placedTotal} шт. Закрыть задачу?`}
                  confirmLabel="Закрыть"
                  saving={busy || (defectTotal > 0 && !defectZoneId)}
                  open={confirmFinish}
                  onOpen={() => setConfirmFinish(true)}
                  onClose={() => setConfirmFinish(false)}
                  onConfirm={() => { void onFinish() }}
                />
              )}
            </div>
          </>
        )}
      </PullToRefresh>

      {packLine && (
        <PackLineSheet
          docId={shipmentId}
          line={packLine}
          onClose={() => setPackLine(null)}
          onDone={refresh}
        />
      )}
    </div>
  )
}
