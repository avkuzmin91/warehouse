import { useCallback, useEffect, useState } from 'react'
import { newRequestId } from '../api/http'
import { useNav } from '../nav/NavContext'
import {
  addCargoOrder,
  closeCargoUnit,
  createCargoUnit,
  getCargoUnits,
  getSupplyPackView,
  isCargoCode,
  MP_CARGO_KIND_LABELS,
  MP_CARGO_QR_PREFIX,
  MP_CARGO_STATUS_LABELS,
  removeCargoOrder,
  reopenCargoUnit,
  type MpCargoUnit,
  type MpSupplyPackView,
} from '../api/marketplacesApi'
import { AppBar } from '../components/AppBar'
import { Icon } from '../components/Icon'
import { PullToRefresh } from '../components/PullToRefresh'
import { scanSource } from '../scan/ScanSource'
import { scanNotFoundFeedback, scanSuccessFeedback } from '../utils/feedback'

/** Грузовые места FBS-поставки на ТСД: короб/палета, которые уезжают на площадку.
 *
 * Цепочка скана: QR грузового места → этикетки заказов поштучно → QR того же места
 * ещё раз = закрыть. Этикетки ГМ печатаются на ПК (экран «Грузовые места» в вебе);
 * здесь ГМ можно завести без этикетки, если она распечатается позже.
 */
export function SupplyCargoScreen({ supplyId, initialUnitId }: { supplyId: string; initialUnitId?: string }) {
  const { back } = useNav()
  const [view, setView] = useState<MpSupplyPackView | null>(null)
  const [units, setUnits] = useState<MpCargoUnit[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [activeId, setActiveId] = useState<string | null>(initialUnitId ?? null)

  const load = useCallback(async (signal?: AbortSignal) => {
    setError('')
    try {
      const [v, c] = await Promise.all([getSupplyPackView(supplyId, signal), getCargoUnits(supplyId, signal)])
      if (signal?.aborted) return
      setView(v)
      setUnits(c.items)
    } catch (err) {
      if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить поставку')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [supplyId])

  useEffect(() => {
    const ac = new AbortController()
    void load(ac.signal)
    return () => ac.abort()
  }, [load])

  const editable = view?.status === 'packing' || view?.status === 'handover'
  const active = units.find((u) => u.id === activeId) ?? null
  const packed = view?.orders.filter((o) => o.packed_at) ?? []
  const loose = packed.filter((o) => !o.cargo_unit_id)

  function resolveUnit(code: string): MpCargoUnit | null {
    const s = code.trim()
    if (s.startsWith(MP_CARGO_QR_PREFIX)) {
      const id = s.slice(MP_CARGO_QR_PREFIX.length).trim()
      return units.find((u) => u.id === id) ?? null
    }
    return units.find((u) => u.doc_number.toLowerCase() === s.toLowerCase()) ?? null
  }

  // Сканер не закрывается между сканами: заказы кладутся в короб подряд.
  async function onScan() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      for (;;) {
        const code = await scanSource.scan()
        if (!code) return
        if (isCargoCode(code)) {
          const unit = resolveUnit(code)
          if (!unit) {
            scanNotFoundFeedback()
            setError(`Грузовое место «${code}» не принадлежит этой поставке`)
            return
          }
          if (unit.id === activeId && unit.status === 'open') {
            await closeCargoUnit(unit.id)
            scanSuccessFeedback()
            await load()
            return
          }
          setActiveId(unit.id)
          scanSuccessFeedback()
          continue
        }
        if (!active) {
          scanNotFoundFeedback()
          setError('Сначала отсканируйте QR грузового места')
          return
        }
        await addCargoOrder(active.id, code, newRequestId())
        scanSuccessFeedback()
        await load()
      }
    } catch (err) {
      scanNotFoundFeedback()
      setError(err instanceof Error ? err.message : 'Скан не принят')
    } finally {
      setBusy(false)
    }
  }

  async function run(fn: () => Promise<unknown>) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await fn()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось выполнить')
    } finally {
      setBusy(false)
    }
  }

  async function onCreate(kind: 'box' | 'pallet') {
    await run(async () => {
      const unit = await createCargoUnit(supplyId, kind, newRequestId())
      setActiveId(unit.id)
    })
  }

  return (
    <div className="screen">
      <AppBar
        title={view ? `Грузовые места ${view.doc_number}` : 'Грузовые места'}
        sub={view ? `${view.account_name}${view.client_name ? ` · ${view.client_name}` : ''}` : undefined}
        onBack={back}
      />

      <PullToRefresh className="scroll pad-nav" onRefresh={() => load()}>
        {loading ? (
          <div className="center"><div className="spin" /></div>
        ) : !view ? (
          <div className="line"><div className="line-sub">Поставка не найдена.</div></div>
        ) : (
          <>
            <div className="summary">
              <div className="kv">
                <span className="k">Уложено</span>
                <span className="v">{packed.length - loose.length} из {packed.length} упакованных</span>
              </div>
              <div className="kv">
                <span className="k">Активное ГМ</span>
                <span className="v">{active ? `${active.doc_number} · ${MP_CARGO_STATUS_LABELS[active.status]}` : 'не выбрано'}</span>
              </div>
            </div>

            {editable ? (
              <>
                <button className="btn" style={{ width: '100%' }} disabled={busy} onClick={() => { void onScan() }}>
                  <Icon name="qr" size={18} /> Скан: QR места → этикетки заказов
                </button>
                <div className="line-sub" style={{ textAlign: 'center' }}>
                  Повторный скан QR активного места закрывает его.
                </div>
                <div className="row gap-8" style={{ display: 'flex', gap: 8 }}>
                  <button className="btn ghost sm" style={{ flex: 1 }} disabled={busy} onClick={() => { void onCreate('box') }}>
                    <Icon name="plus" size={14} /> Короб
                  </button>
                  <button className="btn ghost sm" style={{ flex: 1 }} disabled={busy} onClick={() => { void onCreate('pallet') }}>
                    <Icon name="plus" size={14} /> Палета
                  </button>
                </div>
              </>
            ) : (
              <div className="line-sub" style={{ textAlign: 'center' }}>
                Поставка не на передаче — режим просмотра.
              </div>
            )}

            <div className="sec">Грузовые места<span className="sec-count">{units.length}</span></div>
            {units.length === 0 && (
              <div className="line"><div className="line-sub">Заведите короб или палету, затем сканируйте в него этикетки заказов.</div></div>
            )}
            {units.map((u) => (
              <div
                key={u.id}
                className="line"
                style={u.id === activeId ? { borderColor: 'var(--c-accent)', boxShadow: '0 0 0 1px var(--c-accent) inset' } : undefined}
                onClick={() => editable && setActiveId(u.id)}
              >
                <div className="line-name">
                  {u.doc_number} · {MP_CARGO_KIND_LABELS[u.kind]}
                  <span style={{ float: 'right', color: u.status === 'closed' ? 'var(--c-success)' : 'var(--c-warning)' }}>
                    {MP_CARGO_STATUS_LABELS[u.status]}
                  </span>
                </div>
                <div className="line-sub">
                  {u.orders_count} заказ(ов) · {u.items_qty} шт.{u.external_id ? ` · площадка ${u.external_id}` : ''}
                </div>
                {u.orders.length > 0 && (
                  <div className="line-sub mono">
                    {u.orders.map((o) => (
                      <span key={o.order_id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 10 }}>
                        {o.external_id}
                        {editable && u.status === 'open' && (
                          <button
                            className="btn ghost sm"
                            style={{ padding: '0 4px', minHeight: 0 }}
                            disabled={busy}
                            onClick={(e) => { e.stopPropagation(); void run(() => removeCargoOrder(u.id, o.order_id)) }}
                          >
                            <Icon name="x" size={12} />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                )}
                {editable && u.status === 'open' && u.orders_count > 0 && (
                  <button className="btn ghost sm" disabled={busy} onClick={(e) => { e.stopPropagation(); void run(() => closeCargoUnit(u.id)) }}>
                    <Icon name="check" size={14} /> Закрыть
                  </button>
                )}
                {editable && u.status === 'closed' && !u.external_id && (
                  <button className="btn ghost sm" disabled={busy} onClick={(e) => { e.stopPropagation(); void run(() => reopenCargoUnit(u.id)) }}>
                    Открыть заново
                  </button>
                )}
              </div>
            ))}

            <div className="sec">Не уложено<span className="sec-count">{loose.length}</span></div>
            {loose.length === 0 ? (
              <div className="line"><div className="line-sub">
                {packed.length === 0 ? 'Упакованных заказов пока нет.' : 'Все упакованные заказы лежат в грузовых местах.'}
              </div></div>
            ) : loose.map((o) => (
              <div key={o.order_id} className="line">
                <div className="line-name">{o.external_id}</div>
                <div className="line-sub">{o.need_qty} шт.{o.label_url ? '' : ' · без этикетки'}</div>
              </div>
            ))}

            {error && (
              <div className="actionbar">
                <div className="alert"><Icon name="alert" size={15} />{error}</div>
              </div>
            )}
          </>
        )}
      </PullToRefresh>
    </div>
  )
}
