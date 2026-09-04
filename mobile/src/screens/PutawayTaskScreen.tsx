import { useCallback, useEffect, useRef, useState } from 'react'
import { newRequestId } from '../api/http'
import { useNav } from '../nav/NavContext'
import {
  addPutawayAsideItem,
  finishCollecting,
  getShipment,
  takeShipmentBox,
  undoPutawayAsideItem,
  SHIPMENT_BOX_STATUS_LABELS,
  type ShipmentBox,
  type ShipmentDetail,
} from '../api/shipmentsApi'
import { AppBar } from '../components/AppBar'
import { Icon } from '../components/Icon'
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

/** Задача «Упаковка с ТСД», фаза сборки: товар пикается в короба у стола.
 *
 * Кладовщик или начальник смены берёт короб сканом этикетки и пикает в него товар
 * поштучно — каждый скан и есть запись упаковки (объём, дата, заработок). Короб —
 * просто тара: в него ложится и годный, и брак. Что в короб не идёт (габарит,
 * особые причины) — пикается «мимо короба».
 *
 * Ячейку здесь никто не сканирует: закрытые короба и собранное мимо коробов
 * развозит по местам отдельный процесс на ТСД у стеллажа («Перенос»). Кнопка
 * «Сборка завершена» закрывает эту фазу, а задача уходит в «Размещено» сама,
 * когда уедет её последний объект.
 */
export function PutawayTaskScreen({ shipmentId }: { shipmentId: string }) {
  const { back, openPutawayBox, openPlace } = useNav()
  const [doc, setDoc] = useState<ShipmentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmFinish, setConfirmFinish] = useState(false)
  const [notice, setNotice] = useState('')
  // Качество скана мимо короба: липкий переключатель, брак пикают сериями.
  const [asideQuality, setAsideQuality] = useState<'good' | 'defect'>('good')

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
  const packedTotal = lines.reduce((s, l) => s + l.packed_good, 0)
  const boxedTotal = lines.reduce((s, l) => s + l.boxed_qty, 0)
  const placedTotal = lines.reduce((s, l) => s + l.placed_qty, 0)
  const asideTotal = lines.reduce((s, l) => s + l.aside_qty, 0)
  const defectTotal = lines.reduce((s, l) => s + l.boxed_defect_qty, 0)
  // Сборку держит только набранный, но не закрытый короб: пустой освобождается сам.
  const unclosedBoxes = boxes.filter((b) => b.status === 'open' && b.items_qty > 0)
  const waitingBoxes = boxes.filter((b) => b.status === 'closed')
  const asideLines = lines.filter((l) => l.aside_qty > 0)
  const onPacking = doc?.status === 'on_packing'
  const collected = doc?.status === 'collected'

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

  async function onScanAside() {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const code = await scanSource.scan()
      if (!code) return
      const res = await addPutawayAsideItem(
        shipmentId, { barcode: code, qty: 1, quality: asideQuality }, newRequestId(),
      )
      scanSuccessFeedback()
      setNotice(
        `${asideQuality === 'defect' ? 'Брак' : 'Мимо короба'}: `
        + `${variantTitle(res.product_name ?? '—', [res.color_name, res.size_name])} +${res.qty} шт. — `
        + 'уедет на место отдельно',
      )
      await refresh()
    } catch (err) {
      scanNotFoundFeedback()
      setError(err instanceof Error ? err.message : 'Товар не принят')
    } finally {
      setBusy(false)
    }
  }

  async function onUndoAside(lineId: string) {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await undoPutawayAsideItem(shipmentId, lineId, 1, newRequestId())
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отменить')
    } finally {
      setBusy(false)
    }
  }

  async function onFinish() {
    setBusy(true)
    setError('')
    try {
      await finishCollecting(shipmentId, newRequestId())
      setConfirmFinish(false)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось завершить сборку')
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
                <span className="k">Собрано сканом</span>
                <span className="v">{packedTotal} из {planTotal}</span>
              </div>
              <div className="kv">
                <span className="k">Ждёт размещения</span>
                <span className="v">{boxedTotal}</span>
              </div>
              <div className="kv">
                <span className="k">Размещено по местам</span>
                <span className="v">{placedTotal}</span>
              </div>
              <div className="kv">
                <span className="k">Осталось на столе</span>
                <span className="v">{poolTotal}</span>
              </div>
              {asideTotal > 0 && (
                <div className="kv">
                  <span className="k">Мимо коробов</span>
                  <span className="v">{asideTotal}</span>
                </div>
              )}
              {defectTotal > 0 && (
                <div className="kv">
                  <span className="k">Брак</span>
                  <span className="v">{defectTotal}</span>
                </div>
              )}
            </div>

            {collected && (
              <>
                <div className="alert ok">
                  <Icon name="check" size={15} />
                  Сборка завершена. Осталось развезти по местам: коробов {waitingBoxes.length}
                  {asideTotal > 0 ? `, мимо коробов ${asideTotal} шт.` : ''}
                </div>
                <button className="btn" style={{ width: '100%' }} onClick={() => openPlace()}>
                  <Icon name="layers" size={18} /> Развезти по местам
                </button>
              </>
            )}

            <div className="sec">
              Короба
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
                  Наклейте на короб напечатанную этикетку и отсканируйте её. Дальше пикайте товар
                  в короб — каждый скан вносит упаковку. Заполнили — закройте короб и поставьте
                  рядом: развозить их будут отдельно.
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

            <div className="sec">
              Мимо коробов
              {asideLines.length > 0 && <span className="sec-count">{asideLines.length}</span>}
            </div>
            {onPacking && (
              <>
                <div className="line-row" style={{ marginTop: 0 }}>
                  <button
                    className={asideQuality === 'good' ? 'btn' : 'btn ghost'}
                    style={{ flex: 1 }}
                    disabled={busy}
                    onClick={() => setAsideQuality('good')}
                  >
                    Годный
                  </button>
                  <button
                    className={asideQuality === 'defect' ? 'btn danger' : 'btn ghost'}
                    style={{ flex: 1 }}
                    disabled={busy}
                    onClick={() => setAsideQuality('defect')}
                  >
                    Брак
                  </button>
                </div>
                <button className="btn ghost" style={{ width: '100%' }} disabled={busy} onClick={() => { void onScanAside() }}>
                  <Icon name="qr" size={18} /> В короб не идёт — скан товара
                </button>
                <div className="line-sub" style={{ textAlign: 'center' }}>
                  Габарит не влез или короб не подходит — пикайте сюда. Место такому товару
                  назначит кладовщик у стеллажа, вместе с коробами.
                </div>
                {notice && (
                  <div className="line-sub" style={{ textAlign: 'center', color: 'var(--c-success)' }}>{notice}</div>
                )}
              </>
            )}
            {asideLines.map((l) => (
              <div key={`aside-${l.id}`} className="line">
                <div className="line-name">{variantTitle(l.product_name, [l.color_name, l.size_name])}</div>
                <div className="line-sub mono">{l.product_sku}</div>
                <div className="line-sub">
                  Ждёт размещения <b>{l.aside_qty}</b> шт.
                  {l.aside_defect_qty > 0 && (
                    <> · из них брак <b style={{ color: 'var(--c-danger)' }}>{l.aside_defect_qty}</b></>
                  )}
                </div>
                {onPacking && (
                  <button
                    className="btn ghost sm"
                    style={{ width: '100%', marginTop: 4 }}
                    disabled={busy}
                    onClick={() => { void onUndoAside(l.id) }}
                  >
                    <Icon name="refresh" size={14} /> Отменить 1 шт.
                  </button>
                )}
              </div>
            ))}

            <div className="sec">
              Состав задания
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
                  Ждёт размещения {l.boxed_qty} · размещено {l.placed_qty}
                  {l.aside_qty > 0 && ` (из них мимо коробов ${l.aside_qty})`}
                  {' '}· на столе {l.available_for_pack}
                </div>
              </div>
            ))}

            <div className="actionbar">
              {error && (
                <div className="alert">
                  <Icon name="alert" size={15} />
                  {error}
                </div>
              )}
              {onPacking && unclosedBoxes.length > 0 && (
                <div className="line-sub" style={{ color: 'var(--c-warning)', textAlign: 'center' }}>
                  Не закрыто коробов: {unclosedBoxes.length}
                </div>
              )}
              {onPacking && unclosedBoxes.length === 0 && (
                <ConfirmAction
                  label={<><Icon name="check" size={18} /> Сборка завершена</>}
                  prompt={
                    poolTotal > 0
                      ? `Собрано ${boxedTotal} шт. На столе ещё ${poolTotal} шт — они вернутся на хранение. Завершить сборку?`
                      : `Собрано ${boxedTotal} шт. Завершить сборку?`
                  }
                  confirmLabel="Завершить"
                  saving={busy}
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
    </div>
  )
}
