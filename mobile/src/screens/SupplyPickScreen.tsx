import { useCallback, useEffect, useState } from 'react'
import { newRequestId } from '../api/http'
import { useNav } from '../nav/NavContext'
import { getContainerByCode, isContainerCode } from '../api/containersApi'
import { getLocationByCode, isLocationCode } from '../api/locationsApi'
import {
  finishSupplyPicking,
  getSupplyPickView,
  registerSupplyPick,
  releaseSupply,
  undoSupplyPick,
  type MpSupplyPickRow,
  type MpSupplyPickView,
} from '../api/marketplacesApi'
import { AppBar } from '../components/AppBar'
import { Icon } from '../components/Icon'
import { PullToRefresh } from '../components/PullToRefresh'
import { scanSource } from '../scan/ScanSource'
import { scanNotFoundFeedback, scanSuccessFeedback } from '../utils/feedback'
import { variantTitle } from '../utils/format'

type Zone = { id: string; name: string }
type Box = { id: string; number: string }
type LastPick = { id: string; label: string }

/** Сборка FBS-поставки на ТСД.
 *
 * Позиции идут в порядке обхода склада (ближний стеллаж первым) — маршрут считает
 * backend, экран его не пересортировывает. Цепочка скана свободная: место → короб
 * (если товар в коробе) → товар; место и короб липкие, потому что с одной полки
 * обычно снимают несколько позиций подряд.
 *
 * Сборка закрывается только полностью собранным составом. Товара физически нет —
 * выход не здесь: заказ снимает менеджер, и тогда потребность уменьшается.
 */
export function SupplyPickScreen({ supplyId }: { supplyId: string }) {
  const { back } = useNav()
  const [view, setView] = useState<MpSupplyPickView | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [zone, setZone] = useState<Zone | null>(null)
  const [box, setBox] = useState<Box | null>(null)
  const [lastPick, setLastPick] = useState<LastPick | null>(null)

  const load = useCallback((signal?: AbortSignal) => {
    setError('')
    return getSupplyPickView(supplyId, signal)
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

  // Сканер не закрывается между сканами: сборщик идёт вдоль стеллажа и щёлкает
  // подряд. Ошибка рвёт серию — иначе человек продолжит пикать, не увидев отказа.
  async function onScan() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      for (;;) {
        const code = await scanSource.scan()
        if (!code) return

        if (isLocationCode(code)) {
          const found = await getLocationByCode(code)
          if (!found.found || !found.location) {
            scanNotFoundFeedback()
            setError(`Место «${code}» не найдено`)
            return
          }
          setZone({ id: found.location.id, name: found.location.code })
          setBox(null)
          scanSuccessFeedback()
          continue
        }

        if (isContainerCode(code)) {
          const found = await getContainerByCode(code)
          const c = found.container
          if (!found.found || !c) {
            scanNotFoundFeedback()
            setError(`Короб «${code}» не найден`)
            return
          }
          if (!c.zone_id) {
            scanNotFoundFeedback()
            setError(`Короб ${c.doc_number} не стоит в месте хранения`)
            return
          }
          setZone({ id: c.zone_id, name: c.zone_name ?? '—' })
          setBox({ id: c.id, number: c.doc_number })
          scanSuccessFeedback()
          continue
        }

        if (!zone) {
          scanNotFoundFeedback()
          setError('Сначала отсканируйте место хранения')
          return
        }
        const res = await registerSupplyPick(
          supplyId,
          { barcode: code, zone_id: zone.id, container_id: box?.id ?? null, qty: 1 },
          newRequestId(),
        )
        scanSuccessFeedback()
        setLastPick({
          id: res.pick_id,
          label: variantTitle(res.product_name ?? '—', [res.color_name, res.size_name]),
        })
        await load()
      }
    } catch (err) {
      scanNotFoundFeedback()
      setError(err instanceof Error ? err.message : 'Скан не принят')
    } finally {
      setBusy(false)
    }
  }

  async function onUndo() {
    if (busy || !lastPick) return
    setBusy(true)
    setError('')
    try {
      await undoSupplyPick(supplyId, lastPick.id)
      setLastPick(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отменить скан')
    } finally {
      setBusy(false)
    }
  }

  async function onFinish() {
    setBusy(true)
    setError('')
    try {
      await finishSupplyPicking(supplyId, newRequestId())
      back()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось завершить сборку')
      setBusy(false)
    }
  }

  async function onRelease() {
    setBusy(true)
    setError('')
    try {
      await releaseSupply(supplyId)
      back()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось вернуть поставку в очередь')
      setBusy(false)
    }
  }

  return (
    <div className="screen">
      <AppBar
        title={view?.doc_number ?? 'Сборка поставки'}
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
                <span className="k">Собрано</span>
                <span className="v">{view.picked_qty} из {view.need_qty} шт.</span>
              </div>
              <div className="kv">
                <span className="k">Заказов</span>
                <span className="v">{view.orders_total}</span>
              </div>
              {view.picker_name && (
                <div className="kv">
                  <span className="k">Сборщик</span>
                  <span className="v">{view.picker_name}</span>
                </div>
              )}
            </div>

            <div className="summary">
              <div className="kv">
                <span className="k">Место</span>
                <span className="v">{zone ? zone.name : 'не отсканировано'}</span>
              </div>
              <div className="kv">
                <span className="k">Короб</span>
                <span className="v">{box ? box.number : 'без короба'}</span>
              </div>
            </div>

            <button
              className="btn"
              style={{ width: '100%' }}
              disabled={busy}
              onClick={() => { void onScan() }}
            >
              <Icon name="qr" size={18} /> Скан: место → короб → товар
            </button>
            <div className="line-sub" style={{ textAlign: 'center' }}>
              Место и короб держатся до следующего скана QR. Товар пикается поштучно.
            </div>

            {lastPick && (
              <button
                className="btn ghost sm"
                style={{ width: '100%' }}
                disabled={busy}
                onClick={() => { void onUndo() }}
              >
                <Icon name="refresh" size={14} /> Отменить: {lastPick.label}
              </button>
            )}

            <div className="sec">
              Осталось собрать
              <span className="sec-count">{view.remaining_qty}</span>
            </div>
            {view.items.map((item) => (
              <PickRow key={item.variant_id ?? `unlinked-${item.product_name}`} item={item} />
            ))}

            <div className="actionbar">
              {error && (
                <div className="alert">
                  <Icon name="alert" size={15} />
                  {error}
                </div>
              )}
              {!view.can_finish && view.blockers.map((b) => (
                <div key={b} className="line-sub" style={{ textAlign: 'center' }}>{b}</div>
              ))}
              <button className="btn" disabled={busy || !view.can_finish} onClick={() => { void onFinish() }}>
                <Icon name="check" size={18} /> Сборка завершена
              </button>
              <button className="btn ghost" disabled={busy} onClick={() => { void onRelease() }}>
                Вернуть в очередь
              </button>
            </div>
          </>
        )}
      </PullToRefresh>
    </div>
  )
}

function PickRow({ item }: { item: MpSupplyPickRow }) {
  const done = item.linked && item.remaining_qty === 0
  return (
    <div className="line" style={done ? { opacity: 0.55 } : undefined}>
      <div className="line-name">
        {variantTitle(item.product_name ?? '—', [item.color_name, item.size_name])}
      </div>
      <div className="line-sub mono">
        {item.product_sku ?? item.offer_id ?? '—'} · {item.picked_qty} / {item.need_qty} шт.
      </div>
      {!item.linked ? (
        <div className="line-sub" style={{ color: 'var(--c-danger)' }}>
          Товар не связан с номенклатурой — собрать нечем, нужен менеджер
        </div>
      ) : item.locations.length === 0 ? (
        <div className="line-sub" style={{ color: 'var(--c-danger)' }}>
          Нет свободного остатка на складе
        </div>
      ) : (
        item.locations.map((loc) => (
          <div key={`${loc.zone_id ?? 'none'}-${loc.container_id ?? 'free'}`} className="line-sub">
            {loc.zone_name ?? 'без места'}
            {loc.container_number ? ` · короб ${loc.container_number}` : ''} — {loc.qty} шт.
          </div>
        ))
      )}
    </div>
  )
}
