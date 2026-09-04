import { useCallback, useEffect, useState } from 'react'
import { newRequestId } from '../api/http'
import { useNav } from '../nav/NavContext'
import {
  claimNextSupply,
  getPickingQueue,
  getSupplyPickView,
  type MpSupplyPickView,
} from '../api/marketplacesApi'
import { AppBar } from '../components/AppBar'
import { Icon } from '../components/Icon'
import { PullToRefresh } from '../components/PullToRefresh'
import { fmtDateTime } from '../utils/format'

/** Рабочее место сборщика: очередь поставок и кнопка «Получить задачу».
 *
 * Модель вытягивающая: поставки не назначают поимённо — сборщик берёт следующую
 * сам, и она пропадает из очередей остальных. Своя незакрытая сборка показывается
 * вместо кнопки: две поставки одновременно один человек не носит.
 */
export function PickQueueScreen() {
  const { openSupplyPick } = useNav()
  const [queue, setQueue] = useState(0)
  const [mine, setMine] = useState<MpSupplyPickView | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (signal?: AbortSignal) => {
    setError('')
    try {
      const q = await getPickingQueue(signal)
      if (signal?.aborted) return
      setQueue(q.queue)
      setMine(q.supply_id ? await getSupplyPickView(q.supply_id, signal) : null)
    } catch (err) {
      if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить очередь')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const ac = new AbortController()
    void load(ac.signal)
    return () => ac.abort()
  }, [load])

  async function onClaim() {
    setBusy(true)
    setError('')
    try {
      const res = await claimNextSupply(newRequestId())
      if (!res.supply_id) {
        setQueue(res.queue)
        setError('В очереди нет поставок на сборку')
        return
      }
      openSupplyPick(res.supply_id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось получить задачу')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen">
      <AppBar title="Сборка" sub="FBS-поставки" />

      <PullToRefresh className="scroll pad-nav" onRefresh={() => load()}>
        {loading ? (
          <div className="center"><div className="spin" /></div>
        ) : (
          <>
            {mine ? (
              <>
                <div className="sec">Ваша сборка</div>
                <button className="tile" onClick={() => openSupplyPick(mine.id)}>
                  <div className="tile-ico blue"><Icon name="boxes" size={21} /></div>
                  <div className="tile-body">
                    <div className="tile-title">{mine.doc_number}</div>
                    <div className="tile-meta">
                      {mine.account_name}
                      {mine.client_name ? ` · ${mine.client_name}` : ''}
                    </div>
                    <div className="tile-meta">
                      Собрано {mine.picked_qty} из {mine.need_qty} шт.
                      {mine.cutoff_at ? ` · отсечка ${fmtDateTime(mine.cutoff_at, '')}` : ''}
                    </div>
                  </div>
                  <span className="tile-chev"><Icon name="chev" size={18} /></span>
                </button>
              </>
            ) : (
              <div className="center">
                <div className="center-ico">
                  <Icon name="boxes" size={26} />
                </div>
                <div>
                  {queue > 0
                    ? `В очереди ${queue} поставок(и) на сборку`
                    : 'Очередь пуста — поставок на сборку нет'}
                </div>
              </div>
            )}

            <div className="actionbar">
              {error && (
                <div className="alert">
                  <Icon name="alert" size={15} />
                  {error}
                </div>
              )}
              {mine ? (
                <button className="btn" onClick={() => openSupplyPick(mine.id)}>
                  <Icon name="qr" size={18} /> Продолжить сборку
                </button>
              ) : (
                <button className="btn" disabled={busy || queue === 0} onClick={() => { void onClaim() }}>
                  <Icon name="check" size={18} /> Получить задачу
                </button>
              )}
            </div>
          </>
        )}
      </PullToRefresh>
    </div>
  )
}
