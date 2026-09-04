import { useCallback, useEffect, useRef, useState } from 'react'
import { newRequestId } from '../api/http'
import { useNav } from '../nav/NavContext'
import {
  addPutawayAsideItem,
  getShipment,
  undoPutawayAsideItem,
  type ShipmentDetail,
  type ShipmentLine,
} from '../api/shipmentsApi'
import { AppBar } from '../components/AppBar'
import { Icon } from '../components/Icon'
import { PullToRefresh } from '../components/PullToRefresh'
import { scanSource } from '../scan/ScanSource'
import { scanNotFoundFeedback, scanSuccessFeedback } from '../utils/feedback'
import { variantTitle } from '../utils/format'

type AsideRow = { key: string; line: ShipmentLine; quality: 'good' | 'defect'; qty: number }

/** «Без короба»: виртуальная тара задачи размещения — всё, что собрано мимо коробов.
 *
 * Физического короба тут нет (габарит не влез, короб не подошёл), но для кладовщика
 * это такая же тара: экран повторяет короб — скан, содержимое, изъятие. Разница в
 * двух местах: содержимое разнородно (годный и брак лежат рядом, их всё равно
 * разбирают поштучно у стеллажа), поэтому качество выбирается не липким режимом, а
 * самой кнопкой скана — режим, невидимый после скролла, стоит ошибочных сканов.
 *
 * Развозки здесь нет: россыпь уезжает в место хранения сканом товара у стеллажа
 * («Перенос»), а не сканом короба.
 */
export function PutawayAsideScreen({ shipmentId }: { shipmentId: string }) {
  const { back } = useNav()
  const [doc, setDoc] = useState<ShipmentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

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

  // Счётчики внутри серии сканов двигаются локально: перезагружать документ на каждую
  // единицу — значит тормозить серию. Сверка с сервером идёт по её завершении.
  function bumpLine(lineId: string, qty: number, quality: 'good' | 'defect') {
    setDoc((d) => (d ? {
      ...d,
      lines: d.lines.map((l) => (l.id === lineId ? {
        ...l,
        aside_qty: l.aside_qty + qty,
        aside_defect_qty: l.aside_defect_qty + (quality === 'defect' ? qty : 0),
      } : l)),
    } : d))
  }

  // Авто-перевзвод, как в коробе: сканер переоткрывается сам, пока кладовщик не
  // отменит. Любая ошибка рвёт серию — иначе человек продолжит пикать, не увидев отказа.
  async function onScan(quality: 'good' | 'defect') {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      for (;;) {
        const code = await scanSource.scan()
        if (!code) return
        const res = await addPutawayAsideItem(
          shipmentId, { barcode: code, qty: 1, quality }, newRequestId(),
        )
        scanSuccessFeedback()
        bumpLine(res.line_id, res.qty, quality)
      }
    } catch (err) {
      scanNotFoundFeedback()
      setError(err instanceof Error ? err.message : 'Товар не принят')
    } finally {
      setBusy(false)
      void refresh()
    }
  }

  async function onUndo(lineId: string, quality: 'good' | 'defect') {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await undoPutawayAsideItem(shipmentId, lineId, 1, newRequestId(), quality)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось изъять товар')
    } finally {
      setBusy(false)
    }
  }

  const lines = doc?.lines ?? []
  const total = lines.reduce((s, l) => s + l.aside_qty, 0)
  const defectTotal = lines.reduce((s, l) => s + l.aside_defect_qty, 0)
  const onPacking = doc?.status === 'on_packing'

  const rows: AsideRow[] = []
  for (const l of lines) {
    const good = l.aside_qty - l.aside_defect_qty
    if (good > 0) rows.push({ key: `${l.id}-good`, line: l, quality: 'good', qty: good })
    if (l.aside_defect_qty > 0) {
      rows.push({ key: `${l.id}-defect`, line: l, quality: 'defect', qty: l.aside_defect_qty })
    }
  }

  return (
    <div className="screen">
      <AppBar
        title="Без короба"
        sub={doc ? `${doc.doc_number} · ${onPacking ? 'набирается' : 'ждёт развозки'}` : undefined}
        onBack={back}
      />

      <PullToRefresh className="scroll pad-nav" onRefresh={refresh}>
        {loading ? (
          <div className="center"><div className="spin" /></div>
        ) : !doc ? (
          <div className="line"><div className="line-sub">Задача не найдена.</div></div>
        ) : (
          <>
            <div className="summary">
              <div className="kv">
                <span className="k">Собрано мимо коробов</span>
                <span className="v">{total} шт.</span>
              </div>
              {defectTotal > 0 && (
                <div className="kv">
                  <span className="k">Из них брак</span>
                  <span className="v" style={{ color: 'var(--c-danger)' }}>{defectTotal} шт.</span>
                </div>
              )}
            </div>

            {onPacking && (
              <>
                <div className="line-row" style={{ marginTop: 0 }}>
                  <button
                    className="btn"
                    style={{ flex: 1 }}
                    disabled={busy}
                    onClick={() => { void onScan('good') }}
                  >
                    <Icon name="qr" size={18} /> Скан годного
                  </button>
                  <button
                    className="btn danger"
                    style={{ flex: 1 }}
                    disabled={busy}
                    onClick={() => { void onScan('defect') }}
                  >
                    <Icon name="qr" size={18} /> Скан брака
                  </button>
                </div>
                <div className="line-sub" style={{ textAlign: 'center', marginTop: 8 }}>
                  Сканер не закрывается — пикайте подряд. «Отмена» в сканере завершает серию.
                  Годный и брак кладутся сюда вместе: место каждому назначат у стеллажа.
                </div>
              </>
            )}

            <div className="sec">
              Содержимое
              {rows.length > 0 && <span className="sec-count">{rows.length}</span>}
            </div>
            {rows.length === 0 ? (
              <div className="line">
                <div className="line-sub">
                  Пусто. Сюда пикайте то, что в короб не идёт: габарит не влез или короб
                  не подходит. Каждый скан вносит упаковку, а место такому товару назначит
                  кладовщик у стеллажа — вместе с коробами.
                </div>
              </div>
            ) : (
              rows.map((r) => (
                <div key={r.key} className="line">
                  <div className="line-name">
                    {variantTitle(r.line.product_name, [r.line.color_name, r.line.size_name])}
                    {r.quality === 'defect' && <span className="badge danger" style={{ marginLeft: 6 }}>Брак</span>}
                  </div>
                  <div className="line-sub mono">{r.line.product_sku} · {r.qty} шт.</div>
                  {onPacking && (
                    <button
                      className="btn ghost sm"
                      style={{ width: '100%', marginTop: 4 }}
                      disabled={busy}
                      onClick={() => { void onUndo(r.line.id, r.quality) }}
                    >
                      <Icon name="refresh" size={14} /> Изъять 1 шт.
                      {r.quality === 'defect' ? '' : ' (отменит упаковку)'}
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
              {!onPacking && total > 0 && (
                <div className="line-sub" style={{ textAlign: 'center' }}>
                  Сборка завершена: россыпь ждёт развозки — её увезут к стеллажу и поставят
                  на место сканом товара на ТСД.
                </div>
              )}
            </div>
          </>
        )}
      </PullToRefresh>
    </div>
  )
}
