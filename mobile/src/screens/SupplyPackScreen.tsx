import { useCallback, useEffect, useState } from 'react'
import { newRequestId, requestBlob } from '../api/http'
import { useNav } from '../nav/NavContext'
import {
  finishSupplyPacking,
  getSupplyPackView,
  packSupplyOrder,
  pushSupplyOrder,
  registerPackScan,
  undoPackScan,
  unpackSupplyOrder,
  type MpPackOrder,
  type MpSupplyPackView,
} from '../api/marketplacesApi'
import { AppBar } from '../components/AppBar'
import { Icon } from '../components/Icon'
import { PullToRefresh } from '../components/PullToRefresh'
import { scanSource } from '../scan/ScanSource'
import { scanNotFoundFeedback, scanSuccessFeedback } from '../utils/feedback'
import { variantTitle } from '../utils/format'

type LastScan = { id: string; label: string }

function orderState(o: MpPackOrder): { text: string; color?: string } {
  if (!o.packed_at) return o.complete ? { text: 'укомплектован', color: 'var(--c-accent)' } : { text: `${o.packed_qty} / ${o.need_qty} шт.` }
  if (o.mp_error) return { text: 'ошибка площадки', color: 'var(--c-danger)' }
  if (!o.label_url) return { text: 'ждёт этикетку', color: 'var(--c-warning)' }
  return { text: 'этикетка получена', color: 'var(--c-success)' }
}

/** Упаковка заказов FBS-поставки на ТСД.
 *
 * Заказ выбирается из списка, затем поштучный скан товара в него: ШК варианта или
 * код маркировки «Честный знак». «Заказ упакован» закрывает заказ, собирает
 * отправление на площадке и получает этикетку. Печать этикетки — у ПК с принтером
 * (станция упаковки в вебе); здесь этикетка только показывается.
 */
export function SupplyPackScreen({ supplyId }: { supplyId: string }) {
  const { back, openSupplyReturn } = useNav()
  const [view, setView] = useState<MpSupplyPackView | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [lastScan, setLastScan] = useState<LastScan | null>(null)
  const [labelSrc, setLabelSrc] = useState<string | null>(null)

  const load = useCallback((signal?: AbortSignal) => {
    setError('')
    return getSupplyPackView(supplyId, signal)
      .then((r) => { if (!signal?.aborted) setView(r) })
      .catch((err) => {
        if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить поставку')
      })
      .finally(() => { if (!signal?.aborted) setLoading(false) })
  }, [supplyId])

  useEffect(() => {
    const ac = new AbortController()
    void load(ac.signal)
    return () => ac.abort()
  }, [load])

  const active = view?.orders.find((o) => o.order_id === activeId) ?? null
  const packing = view?.status === 'packing'

  // Этикетка WB — PNG за авторизацией: качаем blob и показываем как data-URL.
  useEffect(() => {
    setLabelSrc(null)
    const url = active?.label_url
    if (!url || !/\.png$/i.test(url)) return
    let cancelled = false
    requestBlob(url)
      .then((blob) => new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(new Error('Не удалось прочитать этикетку'))
        reader.onload = () => resolve(String(reader.result))
        reader.readAsDataURL(blob)
      }))
      .then((src) => { if (!cancelled) setLabelSrc(src) })
      .catch(() => { /* этикетка не обязательна для работы экрана */ })
    return () => { cancelled = true }
  }, [active?.label_url])

  async function onScan() {
    if (busy || !active) return
    setBusy(true)
    setError('')
    try {
      for (;;) {
        const code = await scanSource.scan()
        if (!code) return
        const res = await registerPackScan(supplyId, active.order_id, code, newRequestId())
        scanSuccessFeedback()
        setLastScan({
          id: res.pack_id,
          label: `${variantTitle(res.product_name ?? '—', [res.color_name, res.size_name])} · ${res.packed_qty}/${res.need_qty}`
            + (res.cis_serial ? ` · КИЗ …${res.cis_serial.slice(-6)}` : ''),
        })
        await load()
        if (res.order_complete) return
      }
    } catch (err) {
      scanNotFoundFeedback()
      setError(err instanceof Error ? err.message : 'Скан не принят')
    } finally {
      setBusy(false)
    }
  }

  async function onUndo() {
    if (busy || !lastScan) return
    setBusy(true)
    setError('')
    try {
      await undoPackScan(supplyId, lastScan.id)
      setLastScan(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отменить скан')
    } finally {
      setBusy(false)
    }
  }

  async function onPack() {
    if (busy || !active) return
    setBusy(true)
    setError('')
    try {
      const res = await packSupplyOrder(supplyId, active.order_id, newRequestId())
      if (!res.ok) setError(`Заказ упакован, но площадка ответила ошибкой: ${res.error ?? ''}`)
      setLastScan(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось закрыть заказ')
    } finally {
      setBusy(false)
    }
  }

  async function onPush() {
    if (busy || !active) return
    setBusy(true)
    setError('')
    try {
      const res = await pushSupplyOrder(supplyId, active.order_id)
      if (!res.ok) setError(res.error ?? 'Площадка ответила ошибкой')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отправить')
    } finally {
      setBusy(false)
    }
  }

  async function onUnpack() {
    if (busy || !active) return
    setBusy(true)
    setError('')
    try {
      await unpackSupplyOrder(supplyId, active.order_id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось открыть заказ')
    } finally {
      setBusy(false)
    }
  }

  async function onFinish() {
    setBusy(true)
    setError('')
    try {
      await finishSupplyPacking(supplyId, newRequestId())
      back()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось завершить упаковку')
      setBusy(false)
    }
  }

  return (
    <div className="screen">
      <AppBar
        title={view ? `Упаковка ${view.doc_number}` : 'Упаковка поставки'}
        sub={view ? `${view.account_name}${view.client_name ? ` · ${view.client_name}` : ''}` : undefined}
        onBack={active ? () => { setActiveId(null); setLastScan(null); setError('') } : back}
      />

      <PullToRefresh className="scroll pad-nav" onRefresh={() => load()}>
        {loading ? (
          <div className="center"><div className="spin" /></div>
        ) : !view ? (
          <div className="line"><div className="line-sub">Поставка не найдена.</div></div>
        ) : !active ? (
          <>
            <div className="summary">
              <div className="kv">
                <span className="k">Упаковано</span>
                <span className="v">{view.orders_packed} из {view.orders_total}</span>
              </div>
              <div className="kv">
                <span className="k">Этикеток</span>
                <span className="v">{view.orders_labeled}</span>
              </div>
            </div>
            {!packing && (
              <div className="line-sub" style={{ textAlign: 'center' }}>
                Поставка не на упаковке — режим просмотра.
              </div>
            )}
            {packing && view.return_debt_qty > 0 && (
              <>
                <div className="alert">
                  <Icon name="alert" size={15} />
                  Заказы сняты с поставки (отменены площадкой). Собранное под них
                  нужно вернуть на место: {view.return_debt_qty} шт.
                </div>
                <button
                  className="btn ghost sm"
                  style={{ width: '100%' }}
                  disabled={busy}
                  onClick={() => openSupplyReturn(supplyId)}
                >
                  <Icon name="refresh" size={14} /> Вернуть на место
                </button>
              </>
            )}
            <div className="sec">Заказы<span className="sec-count">{view.orders.length}</span></div>
            {view.orders.map((o) => {
              const st = orderState(o)
              return (
                <button key={o.order_id} className="tile" onClick={() => { setActiveId(o.order_id); setLastScan(null); setError('') }}>
                  <div className={`tile-ico ${o.packed_at ? 'green' : 'blue'}`}><Icon name="box" size={21} /></div>
                  <div className="tile-body">
                    <div className="tile-title">{o.external_id}</div>
                    <div className="tile-meta" style={st.color ? { color: st.color } : undefined}>{st.text}</div>
                  </div>
                  <span className="tile-chev"><Icon name="chev" size={18} /></span>
                </button>
              )
            })}
            <div className="actionbar">
              {error && <div className="alert"><Icon name="alert" size={15} />{error}</div>}
              {packing && !view.can_finish && view.blockers.map((b) => (
                <div key={b} className="line-sub" style={{ textAlign: 'center' }}>{b}</div>
              ))}
              {packing && (
                <button className="btn" disabled={busy || !view.can_finish} onClick={() => { void onFinish() }}>
                  <Icon name="check" size={18} /> Упаковка завершена
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="summary">
              <div className="kv">
                <span className="k">Заказ</span>
                <span className="v">{active.external_id}</span>
              </div>
              <div className="kv">
                <span className="k">Состояние</span>
                <span className="v" style={orderState(active).color ? { color: orderState(active).color } : undefined}>
                  {orderState(active).text}
                </span>
              </div>
              {active.label_barcode && (
                <div className="kv">
                  <span className="k">Этикетка</span>
                  <span className="v">{active.label_barcode}</span>
                </div>
              )}
              {active.cargo_unit_number && (
                <div className="kv">
                  <span className="k">Грузовое место</span>
                  <span className="v">{active.cargo_unit_number}</span>
                </div>
              )}
            </div>

            {active.mp_error && (
              <div className="alert"><Icon name="alert" size={15} />{active.mp_error}</div>
            )}

            {packing && !active.packed_at && (
              <>
                <button className="btn" style={{ width: '100%' }} disabled={busy} onClick={() => { void onScan() }}>
                  <Icon name="qr" size={18} /> Скан товара в заказ
                </button>
                <div className="line-sub" style={{ textAlign: 'center' }}>
                  ШК варианта или код маркировки «Честный знак», поштучно.
                </div>
                {lastScan && (
                  <button className="btn ghost sm" style={{ width: '100%' }} disabled={busy} onClick={() => { void onUndo() }}>
                    <Icon name="refresh" size={14} /> Отменить: {lastScan.label}
                  </button>
                )}
              </>
            )}

            {labelSrc && (
              <div className="line" style={{ textAlign: 'center' }}>
                <img src={labelSrc} alt="Этикетка" style={{ maxWidth: '100%', borderRadius: 8 }} />
                <div className="line-sub">Печать — на станции упаковки (ПК с принтером).</div>
              </div>
            )}
            {active.label_url && !labelSrc && /\.pdf$/i.test(active.label_url) && (
              <div className="line-sub" style={{ textAlign: 'center' }}>
                Этикетка (PDF) получена — печать на станции упаковки.
              </div>
            )}

            <div className="sec">Состав<span className="sec-count">{active.lines.length}</span></div>
            {active.lines.map((l) => {
              const done = l.linked && l.packed_qty >= l.need_qty
              return (
                <div key={l.line_id} className="line" style={done ? { opacity: 0.55 } : undefined}>
                  <div className="line-name">
                    {variantTitle(l.product_name ?? '—', [l.color_name, l.size_name])}
                  </div>
                  <div className="line-sub mono">
                    {l.product_sku ?? l.offer_id ?? '—'} · {l.packed_qty} / {l.need_qty} шт.
                  </div>
                  {!l.linked && (
                    <div className="line-sub" style={{ color: 'var(--c-danger)' }}>
                      Товар не связан с номенклатурой — нужен менеджер
                    </div>
                  )}
                </div>
              )
            })}

            <div className="actionbar">
              {error && <div className="alert"><Icon name="alert" size={15} />{error}</div>}
              {packing && !active.packed_at && (
                <button className="btn" disabled={busy || !active.complete} onClick={() => { void onPack() }}>
                  <Icon name="check" size={18} /> Заказ упакован
                </button>
              )}
              {packing && active.packed_at && (!active.label_url || active.mp_error) && (
                <button className="btn" disabled={busy} onClick={() => { void onPush() }}>
                  <Icon name="refresh" size={18} /> Повторить отправку на площадку
                </button>
              )}
              {/* У WB отметка «на площадке» стоит и до упаковки — заданием, попавшим
                  в поставку продавца ради ленты этикеток. Необратима только сборка Ozon. */}
              {packing && active.packed_at
                && (view.marketplace !== 'ozon' || !active.mp_shipped_at) && (
                <button className="btn ghost" disabled={busy} onClick={() => { void onUnpack() }}>
                  Открыть заказ заново
                </button>
              )}
            </div>
          </>
        )}
      </PullToRefresh>
    </div>
  )
}
