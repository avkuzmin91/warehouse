import { useCallback, useEffect, useState } from 'react'
import { newRequestId } from '../api/http'
import { useNav } from '../nav/NavContext'
import {
  addShipmentBoxItem,
  closeShipmentBox,
  getShipmentBoxes,
  placeShipmentBox,
  reopenShipmentBox,
  undoShipmentBoxItem,
  SHIPMENT_BOX_STATUS_LABELS,
  type ShipmentBox,
} from '../api/shipmentsApi'
import { getLocationByCode } from '../api/locationsApi'
import { AppBar } from '../components/AppBar'
import { Icon } from '../components/Icon'
import { PullToRefresh } from '../components/PullToRefresh'
import { scanSource } from '../scan/ScanSource'
import { scanNotFoundFeedback, scanSuccessFeedback } from '../utils/feedback'
import { variantTitle } from '../utils/format'

/** Короб задачи «Упаковка с ТСД»: скан товара внутрь, закрытие и постановка в ячейку.
 *
 * Каждый скан — это и есть запись упаковки (объём, дата, заработок), поэтому
 * упаковка идёт поштучно в ходе раскладки. Найденный брак пикается в режиме
 * «Брак»: он фиксируется как брак упаковки и в короб не кладётся. Товар
 * опознаётся только по ШК — скан неизвестного кода отклоняется.
 */
export function PutawayBoxScreen({ shipmentId, boxId }: { shipmentId: string; boxId: string }) {
  const { back } = useNav()
  const [box, setBox] = useState<ShipmentBox | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Режим брака: та же кнопка скана, но единица идёт в брак упаковки мимо короба.
  const [defect, setDefect] = useState(false)

  const load = useCallback((signal?: AbortSignal) => {
    setError('')
    return getShipmentBoxes(shipmentId, signal)
      .then((r) => {
        if (signal?.aborted) return
        setBox(r.items.find((b) => b.id === boxId) ?? null)
      })
      .catch((err) => { if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить короб') })
      .finally(() => { if (!signal?.aborted) setLoading(false) })
  }, [shipmentId, boxId])

  useEffect(() => {
    const ac = new AbortController()
    void load(ac.signal)
    return () => ac.abort()
  }, [load])

  async function onScanItem() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const code = await scanSource.scan()
      if (!code) return
      const next = await addShipmentBoxItem(
        shipmentId, boxId,
        { barcode: code, qty: 1, quality: defect ? 'defect' : 'good' },
        newRequestId(),
      )
      scanSuccessFeedback()
      setBox(next)
    } catch (err) {
      scanNotFoundFeedback()
      setError(err instanceof Error ? err.message : 'Товар не принят')
    } finally {
      setBusy(false)
    }
  }

  async function onRemove(lineId: string | null, qty: number) {
    if (busy || !lineId) return
    setBusy(true)
    setError('')
    try {
      setBox(await undoShipmentBoxItem(shipmentId, boxId, lineId, qty, newRequestId()))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось изъять товар')
    } finally {
      setBusy(false)
    }
  }

  async function onClose() {
    setBusy(true)
    setError('')
    try {
      setBox(await closeShipmentBox(shipmentId, boxId, newRequestId()))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось закрыть короб')
    } finally {
      setBusy(false)
    }
  }

  async function onReopen() {
    setBusy(true)
    setError('')
    try {
      setBox(await reopenShipmentBox(shipmentId, boxId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось открыть короб')
    } finally {
      setBusy(false)
    }
  }

  async function onPlace() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const code = await scanSource.scan()
      if (!code) return
      const loc = await getLocationByCode(code)
      if (!loc.found || !loc.location) {
        scanNotFoundFeedback()
        setError(`Ячейка по коду «${code}» не найдена`)
        return
      }
      const next = await placeShipmentBox(shipmentId, boxId, loc.location.id, newRequestId())
      scanSuccessFeedback()
      setBox(next)
    } catch (err) {
      scanNotFoundFeedback()
      setError(err instanceof Error ? err.message : 'Не удалось разместить короб')
    } finally {
      setBusy(false)
    }
  }

  const status = box?.status
  const total = box?.items_qty ?? 0

  return (
    <div className="screen">
      <AppBar
        title={box?.doc_number ?? 'Короб'}
        sub={status ? SHIPMENT_BOX_STATUS_LABELS[status] : undefined}
        onBack={back}
      />

      <PullToRefresh className="scroll pad-nav" onRefresh={() => load()}>
        {loading ? (
          <div className="center"><div className="spin" /></div>
        ) : !box ? (
          <div className="line"><div className="line-sub">Короб не найден.</div></div>
        ) : (
          <>
            <div className="summary">
              <div className="kv">
                <span className="k">В коробе</span>
                <span className="v">{total} шт.</span>
              </div>
              {box.zone_name && (
                <div className="kv">
                  <span className="k">Ячейка</span>
                  <span className="v">{box.zone_name}</span>
                </div>
              )}
            </div>

            {status === 'open' && (
              <>
                <button
                  className={defect ? 'btn danger' : 'btn'}
                  style={{ width: '100%' }}
                  disabled={busy}
                  onClick={() => { void onScanItem() }}
                >
                  <Icon name="qr" size={18} /> {defect ? 'Скан брака' : 'Скан товара в короб'}
                </button>
                <button className="btn ghost" style={{ width: '100%' }} onClick={() => setDefect((v) => !v)}>
                  {defect ? 'Вернуться к годному' : 'Нашёл брак — пикать в брак'}
                </button>
              </>
            )}

            <div className="sec">
              Содержимое
              <span className="sec-count">{box.contents.length}</span>
            </div>
            {box.contents.length === 0 ? (
              <div className="line">
                <div className="line-sub">
                  Короб пуст — пикайте штрих-коды товара. Каждый скан вносит упаковку и кладёт
                  единицу в этот короб; пикать можно только то, что передано на стол упаковки.
                </div>
              </div>
            ) : (
              box.contents.map((c) => (
                <div key={`${c.line_id ?? ''}-${c.product_id}-${c.color_name ?? ''}-${c.size_name ?? ''}`} className="line">
                  <div className="line-name">{variantTitle(c.product_name ?? '—', [c.color_name, c.size_name])}</div>
                  <div className="line-sub mono">{c.product_sku ?? '—'} · {c.qty} шт.</div>
                  {status === 'open' && c.line_id && (
                    <button
                      className="btn ghost sm"
                      style={{ width: '100%', marginTop: 4 }}
                      disabled={busy}
                      onClick={() => { void onRemove(c.line_id, 1) }}
                    >
                      <Icon name="refresh" size={14} /> Изъять 1 шт. (отменит упаковку)
                    </button>
                  )}
                </div>
              ))
            )}

            <div className="actionbar">
              {error && (
                <div className="alert">
                  <Icon name="alert" size={15} />
                  {error}
                </div>
              )}
              {status === 'open' && (
                <button className="btn" disabled={busy || total === 0} onClick={() => { void onClose() }}>
                  <Icon name="check" size={18} /> Закрыть короб
                </button>
              )}
              {status === 'closed' && (
                <>
                  <button className="btn" disabled={busy} onClick={() => { void onPlace() }}>
                    <Icon name="qr" size={18} /> Разместить — скан ячейки
                  </button>
                  <button className="btn ghost" disabled={busy} onClick={() => { void onReopen() }}>
                    Открыть заново
                  </button>
                </>
              )}
              {status === 'placed' && (
                <div className="line-sub" style={{ textAlign: 'center', color: 'var(--c-success)' }}>
                  Короб размещён в ячейке {box.zone_name ?? '—'}
                </div>
              )}
            </div>
          </>
        )}
      </PullToRefresh>
    </div>
  )
}
