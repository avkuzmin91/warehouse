import { useCallback, useEffect, useRef, useState } from 'react'
import { newRequestId } from '../api/http'
import { useNav } from '../nav/NavContext'
import {
  finishCollecting,
  getShipment,
  takeShipmentBox,
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

// Прогресс сборки: годный (зелёный) + брак (красный) к плану.
// Остаток берём из пула на столе (available_for_pack), а не из «план − собрано»:
// часть плана может быть недоступна к сборке.
function CollectMeter({ good, defect, plan, left }: { good: number; defect: number; plan: number; left: number }) {
  const gw = plan > 0 ? Math.min(100, (good / plan) * 100) : 0
  const dw = plan > 0 ? Math.min(100 - gw, (defect / plan) * 100) : 0
  return (
    <div className="pmeter">
      <div className="pmeter-track">
        {good > 0 && <span className="seg-good" style={{ width: `${gw}%` }} />}
        {defect > 0 && <span className="seg-defect" style={{ width: `${dw}%` }} />}
      </div>
      <div className="pmeter-row">
        <div className="pmeter-counts">
          <b className="good">{good}</b> годн <span className="faint">·</span>{' '}
          <b className={defect > 0 ? 'defect' : 'faint'}>{defect}</b> брак{' '}
          <span className="faint">· план {plan}</span>
        </div>
        {left === 0 ? (
          <span className="badge success"><Icon name="check" size={12} /> Собрано</span>
        ) : (
          <span className="badge warning">на столе {left}</span>
        )}
      </div>
    </div>
  )
}

// Прогресс развозки: сколько собранного уже уехало в места хранения.
function PlaceMeter({ placed, waiting }: { placed: number; waiting: number }) {
  const total = placed + waiting
  const done = waiting === 0
  return (
    <div className="pack-meter">
      <div className="pack-meter-top">
        <div className="pack-meter-count">
          <b>{placed}</b>
          <span className="pack-meter-of"> / {total} шт размещено</span>
        </div>
        {done ? (
          <span className="badge success"><Icon name="check" size={12} /> Размещено</span>
        ) : (
          <span className="badge info">ждёт {waiting}</span>
        )}
      </div>
      <div className="pack-bar">
        <div
          className={`pack-bar-fill${done ? ' done' : ''}`}
          style={{ width: `${total > 0 ? Math.min(100, Math.round((placed / total) * 100)) : 0}%` }}
        />
      </div>
    </div>
  )
}

/** Задача «Упаковка с ТСД», фаза сборки: товар пикается в короба у стола.
 *
 * Кладовщик или начальник смены берёт короб сканом этикетки и пикает в него товар
 * поштучно — каждый скан и есть запись упаковки (объём, дата, заработок). Короб —
 * просто тара: в него ложится и годный, и брак. Что в короб не идёт (габарит,
 * особые причины) — уходит в «Без короба»: та же тара, только виртуальная, со своим
 * экраном (PutawayAsideScreen), чтобы способ положить товар был ровно один.
 *
 * Ячейку здесь никто не сканирует: закрытые короба и собранное мимо коробов
 * развозит по местам отдельный процесс на ТСД у стеллажа («Перенос»). Кнопка
 * «Сборка завершена» закрывает эту фазу, а задача уходит в «Размещено» сама,
 * когда уедет её последний объект.
 */
export function PutawayTaskScreen({ shipmentId }: { shipmentId: string }) {
  const { back, openPutawayBox, openPutawayAside, openPlace } = useNav()
  const [doc, setDoc] = useState<ShipmentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmFinish, setConfirmFinish] = useState(false)

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
  const packedDefectTotal = lines.reduce((s, l) => s + l.packed_defect, 0)
  const boxedTotal = lines.reduce((s, l) => s + l.boxed_qty, 0)
  const placedTotal = lines.reduce((s, l) => s + l.placed_qty, 0)
  const asideTotal = lines.reduce((s, l) => s + l.aside_qty, 0)
  const asideDefectTotal = lines.reduce((s, l) => s + l.aside_defect_qty, 0)
  // Сборку держит только набранный, но не закрытый короб: пустой освобождается сам.
  const unclosedBoxes = boxes.filter((b) => b.status === 'open' && b.items_qty > 0)
  const waitingBoxes = boxes.filter((b) => b.status === 'closed')
  const onPacking = doc?.status === 'on_packing'
  const collected = doc?.status === 'collected'
  // Виртуальная тара «Без короба»: на сборке она нужна всегда (иначе непонятно, куда
  // девать габарит), после — только пока в ней что-то ждёт развозки.
  const showAside = onPacking || asideTotal > 0

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
              <CollectMeter good={packedTotal} defect={packedDefectTotal} plan={planTotal} left={poolTotal} />
              {boxedTotal + placedTotal > 0 && <PlaceMeter placed={placedTotal} waiting={boxedTotal} />}
            </div>

            {collected && (
              <>
                <div className="alert ok">
                  <Icon name="check" size={15} />
                  Сборка завершена, задача закрыта. В очереди на развозку: коробов{' '}
                  {waitingBoxes.length}
                  {asideTotal > 0 ? `, без короба ${asideTotal} шт.` : ''}
                </div>
                <button className="btn" style={{ width: '100%' }} onClick={() => openPlace()}>
                  <Icon name="layers" size={18} /> Развезти по местам
                </button>
              </>
            )}

            <div className="sec">
              Тара
              <span className="sec-count">{boxes.length + (showAside ? 1 : 0)}</span>
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
                    <div className="tile-title">
                      {b.doc_number}
                      {b.quality === 'defect' && <span className="badge danger" style={{ marginLeft: 6 }}>Брак</span>}
                    </div>
                    <div className="tile-meta">
                      {b.items_qty} шт.{b.zone_name ? ` · ${b.zone_name}` : ''}
                    </div>
                  </div>
                  <span className={`badge ${BOX_TONE[b.status]}`}>{SHIPMENT_BOX_STATUS_LABELS[b.status]}</span>
                </button>
              ))
            )}

            {showAside && (
              <>
                <button
                  className="tile"
                  style={{ borderStyle: 'dashed', boxShadow: 'none' }}
                  onClick={() => openPutawayAside(shipmentId)}
                >
                  <span className="tile-ico gray"><Icon name="layers" size={20} /></span>
                  <div className="tile-body">
                    <div className="tile-title">Без короба</div>
                    <div className="tile-meta">
                      {asideTotal} шт.{asideDefectTotal > 0 ? ` · брак ${asideDefectTotal}` : ''}
                    </div>
                  </div>
                  <Icon name="chev" size={18} />
                </button>
                <div className="line-sub" style={{ textAlign: 'center', marginBottom: 10 }}>
                  Габарит не влез или короб не подходит — пикайте сюда. Место такому товару
                  назначит кладовщик у стеллажа, вместе с коробами.
                </div>
              </>
            )}

            <div className="sec">
              Состав задания
              <span className="sec-count">{lines.length}</span>
            </div>
            {lines.map((l) => (
              <div key={l.id} className="line">
                <div className="line-name">{variantTitle(l.product_name, [l.color_name, l.size_name])}</div>
                <div className="line-sub mono">{l.product_sku}</div>
                <CollectMeter
                  good={l.packed_good}
                  defect={l.packed_defect}
                  plan={l.qty}
                  left={l.available_for_pack}
                />
                {l.boxed_qty + l.placed_qty > 0 && (
                  <PlaceMeter placed={l.placed_qty} waiting={l.boxed_qty} />
                )}
                {l.aside_qty > 0 && (
                  <div className="line-sub">Из них без короба {l.aside_qty} шт.</div>
                )}
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
