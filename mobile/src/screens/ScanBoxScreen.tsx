import { useCallback, useEffect, useRef, useState } from 'react'
import { newRequestId } from '../api/http'
import { useNav } from '../nav/NavContext'
import {
  getContainer,
  placeContainers,
  removeContainerItem,
  CONTAINER_STATUS_LABELS,
  type ContainerDetailResponse,
} from '../api/containersApi'
import { getLocationByCode } from '../api/locationsApi'
import { AppBar } from '../components/AppBar'
import { Icon } from '../components/Icon'
import { PullToRefresh } from '../components/PullToRefresh'
import { scanSource } from '../scan/ScanSource'
import { scanNotFoundFeedback, scanSuccessFeedback } from '../utils/feedback'
import { variantTitle } from '../utils/format'

const TONE: Record<string, string> = { new: '', open: 'warning', closed: 'info', placed: 'success' }

/** Карточка короба по скану QR: что внутри, где стоит и что с ним можно сделать.
 *
 * Кладовщик подходит к стеллажу с коробом в руках и сканирует его — отсюда и
 * начинается работа: закрытый короб размещается, размещённый переезжает или из
 * него изымают пересорт. Пачкой то же самое делает экран «Перенос».
 */
export function ScanBoxScreen({ containerId }: { containerId: string }) {
  const { back, openPlace, openPutawayDoc } = useNav()
  const [data, setData] = useState<ContainerDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback((signal?: AbortSignal) => {
    setError('')
    return getContainer(containerId, signal)
      .then((r) => { if (!signal?.aborted) setData(r) })
      .catch((err) => { if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить короб') })
      .finally(() => { if (!signal?.aborted) setLoading(false) })
  }, [containerId])

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

  const box = data?.doc
  const contents = data?.contents ?? []

  async function onScanZone() {
    if (busy || !box) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const code = await scanSource.scan()
      if (!code) return
      const loc = await getLocationByCode(code)
      if (!loc.found || !loc.location) {
        scanNotFoundFeedback()
        setError(`Место по коду «${code}» не найдено`)
        return
      }
      const res = await placeContainers({ zone_id: loc.location.id, box_ids: [box.id] }, newRequestId())
      scanSuccessFeedback()
      const closed = res.closed_tasks.length > 0 ? ` · задача закрыта: ${res.closed_tasks.join(', ')}` : ''
      setNotice(`${res.placed_qty} шт. → ${res.zone_name}${closed}`)
      await refresh()
    } catch (err) {
      scanNotFoundFeedback()
      setError(err instanceof Error ? err.message : 'Не удалось разместить короб')
    } finally {
      setBusy(false)
    }
  }

  async function onScanRemove() {
    if (busy || !box) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const code = await scanSource.scan()
      if (!code) return
      await removeContainerItem(box.id, { barcode: code, qty: 1 }, newRequestId())
      scanSuccessFeedback()
      setNotice('Изъято из короба 1 шт. — товар остался в этом месте')
      await refresh()
    } catch (err) {
      scanNotFoundFeedback()
      setError(err instanceof Error ? err.message : 'Не удалось изъять товар')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen">
      <AppBar
        title={box?.doc_number ?? 'Короб'}
        sub={box ? CONTAINER_STATUS_LABELS[box.status] : undefined}
        onBack={back}
      />

      <PullToRefresh className="scroll pad-nav" onRefresh={refresh}>
        {loading ? (
          <div className="center"><div className="spin" /></div>
        ) : !box ? (
          <div className="line"><div className="line-sub">Короб не найден.</div></div>
        ) : (
          <>
            <div className="summary">
              <div className="kv">
                <span className="k">Статус</span>
                <span className={`badge ${TONE[box.status] ?? ''}`}>{CONTAINER_STATUS_LABELS[box.status]}</span>
              </div>
              <div className="kv">
                <span className="k">В коробе</span>
                <span className="v">{box.items_qty} шт.</span>
              </div>
              {box.zone_name && (
                <div className="kv">
                  <span className="k">Место</span>
                  <span className="v">{box.zone_name}</span>
                </div>
              )}
              {box.client_name && (
                <div className="kv">
                  <span className="k">Клиент</span>
                  <span className="v">{box.client_name}</span>
                </div>
              )}
            </div>

            {box.doc_id && box.doc_number_task && (
              <button className="tile" onClick={() => openPutawayDoc(box.doc_id!)}>
                <div className="tile-body">
                  <div className="tile-title">Задача {box.doc_number_task}</div>
                  <div className="tile-meta">Сборка этого короба</div>
                </div>
              </button>
            )}

            <div className="sec">
              Содержимое
              <span className="sec-count">{contents.length}</span>
            </div>
            {contents.length === 0 ? (
              <div className="line"><div className="line-sub">Короб пуст.</div></div>
            ) : (
              contents.map((c) => (
                <div key={`${c.product_id}-${c.color_name ?? ''}-${c.size_name ?? ''}`} className="line">
                  <div className="line-name">{variantTitle(c.product_name ?? '—', [c.color_name, c.size_name])}</div>
                  <div className="line-sub mono">{c.product_sku ?? '—'} · {c.qty} шт.</div>
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
              {notice && (
                <div className="alert ok">
                  <Icon name="check" size={15} />
                  {notice}
                </div>
              )}
              {(box.status === 'new' || box.status === 'open') && (
                <div className="line-sub" style={{ textAlign: 'center' }}>
                  {box.status === 'open'
                    ? 'Короб ещё набирается — закройте его в задаче сборки, потом развозите.'
                    : 'Короб свободен: этикетка напечатана, в работу его берут сканом в задаче сборки.'}
                </div>
              )}
              {box.status === 'closed' && (
                <button className="btn primary" disabled={busy} onClick={() => { void onScanZone() }}>
                  <Icon name="qr" size={18} /> Разместить — скан места
                </button>
              )}
              {box.status === 'placed' && (
                <>
                  <button className="btn primary" disabled={busy} onClick={() => { void onScanZone() }}>
                    <Icon name="qr" size={18} /> Переместить — скан места
                  </button>
                  <button className="btn ghost" disabled={busy} onClick={() => { void onScanRemove() }}>
                    <Icon name="qr" size={16} /> Изъять товар — скан ШК
                  </button>
                </>
              )}
              {(box.status === 'closed' || box.status === 'placed') && (
                <button className="btn ghost" disabled={busy} onClick={openPlace}>
                  <Icon name="layers" size={16} /> Везу пачкой — открыть «Перенос»
                </button>
              )}
            </div>
          </>
        )}
      </PullToRefresh>
    </div>
  )
}
