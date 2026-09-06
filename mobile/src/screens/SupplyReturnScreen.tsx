import { useCallback, useEffect, useState } from 'react'
import { newRequestId } from '../api/http'
import { useNav } from '../nav/NavContext'
import { getLocationByCode, isLocationCode } from '../api/locationsApi'
import {
  getSupplyPickView,
  returnSupplyPick,
  type MpSupplyPickView,
} from '../api/marketplacesApi'
import { AppBar } from '../components/AppBar'
import { Icon } from '../components/Icon'
import { PullToRefresh } from '../components/PullToRefresh'
import { scanSource } from '../scan/ScanSource'
import { scanNotFoundFeedback, scanSuccessFeedback } from '../utils/feedback'
import { variantTitle } from '../utils/format'

type Zone = { id: string; name: string }

/** Возврат на место: собранное под заказ, который сняли с поставки (обычно его
 * отменила площадка). Два шага — сначала QR места, потом поштучный скан товара;
 * место липкое, потому что пачку обычно кладут в одну ячейку.
 *
 * Это не откат скана сборки: «тех самых» штук в журнале нет, сборка свёрнута по
 * вариантам. Поэтому место задаёт сканер, а вернуть можно только лишнее — состав
 * поставки распустить возвратом нельзя.
 */
export function SupplyReturnScreen({ supplyId }: { supplyId: string }) {
  const { back } = useNav()
  const [view, setView] = useState<MpSupplyPickView | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [zone, setZone] = useState<Zone | null>(null)
  const [last, setLast] = useState<string | null>(null)

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
          scanSuccessFeedback()
          continue
        }

        if (!zone) {
          scanNotFoundFeedback()
          setError('Сначала отсканируйте место, куда кладёте')
          return
        }
        const res = await returnSupplyPick(
          supplyId, { barcode: code, zone_id: zone.id, qty: 1 }, newRequestId(),
        )
        scanSuccessFeedback()
        setLast(variantTitle(res.product_name ?? '—', [res.color_name, res.size_name]))
        await load()
      }
    } catch (err) {
      scanNotFoundFeedback()
      setError(err instanceof Error ? err.message : 'Скан не принят')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen">
      <AppBar
        title={view?.doc_number ?? 'Возврат на место'}
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
                <span className="k">Вернуть</span>
                <span className="v">{view.return_debt_qty} шт.</span>
              </div>
              <div className="kv">
                <span className="k">Место</span>
                <span className="v">{zone ? zone.name : 'не отсканировано'}</span>
              </div>
            </div>

            {view.return_debt_qty === 0 ? (
              <div className="line">
                <div className="line-sub">
                  Возвращать нечего — всё собранное нужно составу поставки.
                </div>
              </div>
            ) : (
              <>
                <button
                  className="btn"
                  style={{ width: '100%' }}
                  disabled={busy}
                  onClick={() => { void onScan() }}
                >
                  <Icon name="qr" size={18} /> Скан: место → товар
                </button>
                <div className="line-sub" style={{ textAlign: 'center' }}>
                  Место держится до следующего скана QR. Товар возвращается поштучно.
                </div>
                {last && (
                  <div className="line-sub" style={{ textAlign: 'center' }}>
                    Возвращено: {last}
                  </div>
                )}
              </>
            )}

            <div className="sec">
              Собрано под снятые заказы
              <span className="sec-count">{view.return_items.length}</span>
            </div>
            {view.return_items.map((item) => (
              <div key={item.variant_id} className="line">
                <div className="line-name">
                  {variantTitle(item.product_name ?? '—', [item.color_name, item.size_name])}
                </div>
                <div className="line-sub mono">
                  {item.product_sku ?? '—'} · вернуть {item.qty} шт.
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
              <button className="btn ghost" disabled={busy} onClick={back}>
                Готово
              </button>
            </div>
          </>
        )}
      </PullToRefresh>
    </div>
  )
}
