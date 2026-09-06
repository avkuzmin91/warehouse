import { useCallback, useEffect, useState } from 'react'
import { newRequestId } from '../api/http'
import { useNav } from '../nav/NavContext'
import {
  addShipmentBoxItem,
  closeShipmentBox,
  getShipmentBoxes,
  releaseShipmentBox,
  reopenShipmentBox,
  takeShipmentBox,
  undoShipmentBoxItem,
  SHIPMENT_BOX_STATUS_LABELS,
  type ShipmentBox,
} from '../api/shipmentsApi'
import { AppBar } from '../components/AppBar'
import { Icon } from '../components/Icon'
import { PullToRefresh } from '../components/PullToRefresh'
import { scanSource } from '../scan/ScanSource'
import { scanNotFoundFeedback, scanSuccessFeedback } from '../utils/feedback'
import { variantTitle } from '../utils/format'

/** Короб задачи «Упаковка с ТСД»: скан товара внутрь и закрытие короба.
 *
 * Каждый скан — это и есть запись упаковки (объём, дата, заработок), поэтому
 * упаковка идёт поштучно в ходе сборки. Короб однороден: качество задаёт первый скан
 * (кнопки «Скан годного» / «Скан брака»), дальше оно закреплено — смешанный короб
 * пришлось бы разбирать у стеллажа. Режима-переключателя здесь нет намеренно: он
 * невидим после скролла и стоит ошибочных сканов. Товар опознаётся только по ШК —
 * скан неизвестного кода отклоняется. Пустой короб можно освободить: взятая по
 * ошибке этикетка иначе держала бы всю задачу.
 *
 * Действия живут в нижней панели: скан повторяется сотни раз и обязан оставаться под
 * большим пальцем, пока содержимое прокручивается. Закрытый короб сразу предлагает
 * взять следующий — самый частый переход процесса, иначе он идёт через список задачи.
 *
 * Развозки здесь нет: закрытый короб уезжает на место отдельным процессом
 * (экран «Перенос» или скан короба у стеллажа).
 */
export function PutawayBoxScreen({ shipmentId, boxId }: { shipmentId: string; boxId: string }) {
  const { back, openPutawayBox } = useNav()
  const [box, setBox] = useState<ShipmentBox | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

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

  // Переход на следующий короб меняет boxId у того же экрана: спиннер вместо кадра с
  // содержимым предыдущего короба.
  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    void load(ac.signal)
    return () => ac.abort()
  }, [load])

  // Авто-перевзвод: сканер переоткрывается сам после каждой принятой единицы, пока
  // кладовщик не отменит. Одно открытие сканера = ровно одна единица, поэтому
  // дедупликация повторного чтения того же ШК не нужна. Любая ошибка рвёт серию —
  // иначе человек продолжит пикать, не увидев отказа.
  async function onScanItem(quality: 'good' | 'defect') {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      for (;;) {
        const code = await scanSource.scan()
        if (!code) return
        const next = await addShipmentBoxItem(
          shipmentId, boxId, { barcode: code, qty: 1, quality }, newRequestId(),
        )
        scanSuccessFeedback()
        setBox(next)
        if (next.status !== 'open') return
      }
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
    if (busy) return
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

  async function onRelease() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await releaseShipmentBox(shipmentId, boxId, newRequestId())
      back()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось освободить короб')
      setBusy(false)
    }
  }

  async function onReopen() {
    if (busy) return
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

  // Закрыли короб — сразу берём следующий: экран заменяется, а не громоздится стеком,
  // иначе «Назад» пришлось бы жать по разу на каждый закрытый короб смены.
  async function onNextBox() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const code = await scanSource.scan()
      if (!code) return
      const next = await takeShipmentBox(shipmentId, code, newRequestId())
      scanSuccessFeedback()
      openPutawayBox(shipmentId, next.id, true)
    } catch (err) {
      scanNotFoundFeedback()
      setError(err instanceof Error ? err.message : 'Короб не принят')
    } finally {
      setBusy(false)
    }
  }

  const status = box?.status
  const total = box?.items_qty ?? 0
  // Набранный короб уже закреплён за качеством: выбор есть только у пустого.
  const boxQuality = box?.quality === 'good' || box?.quality === 'defect' ? box.quality : null

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
              {boxQuality && (
                <div className="kv">
                  <span className="k">Содержимое</span>
                  <span className="v" style={boxQuality === 'defect' ? { color: 'var(--c-danger)' } : undefined}>
                    {boxQuality === 'defect' ? 'Брак' : 'Годный'}
                  </span>
                </div>
              )}
              {box.zone_name && (
                <div className="kv">
                  <span className="k">Место</span>
                  <span className="v">{box.zone_name}</span>
                </div>
              )}
            </div>

            {status === 'open' && (
              <div className="line-sub" style={{ textAlign: 'center' }}>
                Сканер не закрывается — пикайте подряд. «Отмена» в сканере завершает серию.
                {boxQuality
                  ? ` Короб набирается ${boxQuality === 'defect' ? 'браком' : 'годным'}: `
                    + `${boxQuality === 'defect' ? 'годный' : 'брак'} кладите в другой короб.`
                  : ' Первый скан задаёт качество короба: дальше в него идёт только оно.'}
              </div>
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
                  Взяли этикетку по ошибке — освободите короб.
                </div>
              </div>
            ) : (
              <>
                {status === 'open' && (
                  <div className="line-sub" style={{ marginTop: -2, marginBottom: 10 }}>
                    Изъятие отменяет запись упаковки за единицу.
                  </div>
                )}
                {box.contents.map((c) => (
                  <div
                    key={`${c.line_id ?? ''}-${c.product_id}-${c.color_name ?? ''}-${c.size_name ?? ''}-${c.quality}`}
                    className="line"
                  >
                    <div className="line-row" style={{ marginTop: 0, alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="line-name">{variantTitle(c.product_name ?? '—', [c.color_name, c.size_name])}</div>
                        <div className="line-sub mono">
                          {c.product_sku ?? '—'} · {c.qty} шт.
                          {c.quality === 'defect' && <span style={{ color: 'var(--c-danger)' }}> · брак</span>}
                        </div>
                      </div>
                      {status === 'open' && c.line_id && (
                        <button
                          className="btn ghost sm auto"
                          disabled={busy}
                          onClick={() => { void onRemove(c.line_id, 1) }}
                        >
                          <Icon name="refresh" size={14} /> Изъять 1 шт.
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}

            <div className="actionbar">
              {error && (
                <div className="alert">
                  <Icon name="alert" size={15} />
                  {error}
                </div>
              )}
              {status === 'open' && (
                <>
                  {total === 0 ? (
                    <button className="btn ghost" disabled={busy} onClick={() => { void onRelease() }}>
                      <Icon name="trash" size={18} /> Освободить короб
                    </button>
                  ) : (
                    <button className="btn ghost" disabled={busy} onClick={() => { void onClose() }}>
                      <Icon name="check" size={18} /> Закрыть короб
                    </button>
                  )}
                  {boxQuality ? (
                    <button
                      className={boxQuality === 'defect' ? 'btn danger' : 'btn'}
                      disabled={busy}
                      onClick={() => { void onScanItem(boxQuality) }}
                    >
                      <Icon name="qr" size={18} /> Скан товара{boxQuality === 'defect' ? ' (брак)' : ''}
                    </button>
                  ) : (
                    <div className="line-row">
                      <button
                        className="btn"
                        style={{ flex: 1 }}
                        disabled={busy}
                        onClick={() => { void onScanItem('good') }}
                      >
                        <Icon name="qr" size={18} /> Скан годного
                      </button>
                      <button
                        className="btn danger"
                        style={{ flex: 1 }}
                        disabled={busy}
                        onClick={() => { void onScanItem('defect') }}
                      >
                        <Icon name="qr" size={18} /> Скан брака
                      </button>
                    </div>
                  )}
                </>
              )}
              {status === 'closed' && (
                <>
                  <div className="line-sub" style={{ textAlign: 'center' }}>
                    Короб закрыт и ждёт развозки: его увезут к стеллажу и поставят на место
                    сканом на ТСД.
                  </div>
                  <button className="btn ghost" disabled={busy} onClick={() => { void onReopen() }}>
                    <Icon name="refresh" size={18} /> Открыть заново
                  </button>
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => { void onNextBox() }}
                  >
                    <Icon name="qr" size={18} /> Следующий короб — скан этикетки
                  </button>
                </>
              )}
              {status === 'placed' && (
                <div className="line-sub" style={{ textAlign: 'center', color: 'var(--c-success)' }}>
                  Короб размещён в месте {box.zone_name ?? '—'}
                </div>
              )}
            </div>
          </>
        )}
      </PullToRefresh>
    </div>
  )
}
