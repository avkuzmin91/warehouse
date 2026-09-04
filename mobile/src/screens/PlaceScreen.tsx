import { useCallback, useEffect, useState } from 'react'
import { newRequestId } from '../api/http'
import { useNav } from '../nav/NavContext'
import {
  getContainerByCode,
  getPendingPlacement,
  isContainerCode,
  placeContainers,
  type ContainerPendingPlacement,
  type ContainerPlaceItemScan,
} from '../api/containersApi'
import { getLocationByCode, isLocationCode } from '../api/locationsApi'
import { getProductByBarcode } from '../api/productsApi'
import { AppBar } from '../components/AppBar'
import { Icon } from '../components/Icon'
import { scanSource } from '../scan/ScanSource'
import { scanNotFoundFeedback, scanSuccessFeedback } from '../utils/feedback'
import { variantTitle } from '../utils/format'

/** Качество россыпи: «авто» — определит backend, если ждёт товар одного качества. */
type ItemQuality = 'auto' | 'good' | 'defect'

const QUALITY_NEXT: Record<ItemQuality, ItemQuality> = { auto: 'good', good: 'defect', defect: 'auto' }
const QUALITY_LABEL: Record<ItemQuality, string> = { auto: 'качество: авто', good: 'годный', defect: 'брак' }
const QUALITY_TONE: Record<ItemQuality, string> = { auto: '', good: 'success', defect: 'danger' }

type Source = { id: string; code: string }
type BufferBox = { id: string; doc_number: string; items_qty: number; moving: boolean }
type BufferItem = { key: string; barcode: string; label: string; qty: number; quality: ItemQuality }

/** «Перенос»: пачка коробов и товара уезжает в одно место хранения.
 *
 * Физика такая: кладовщик берёт стопку коробов (или товар с полки), везёт к стеллажу
 * и там пикает объекты, потом место. Поэтому экран — буфер «взял → положил»:
 * сканируешь подряд что взял, последним сканом указываешь место, всё уезжает одним
 * запросом.
 *
 * Режим не выбирается руками, он выводится из отсканированного: закрытый короб
 * размещается, размещённый — переезжает, товар едет из корзины «ждёт размещения»,
 * а если её нет — переносится с полки. Скан QR места до товара задаёт источник:
 * иначе товар, лежащий сразу в нескольких местах, пришлось бы угадывать.
 */
export function PlaceScreen({ source: initialSource }: { source?: Source }) {
  const { back } = useNav()
  const [source, setSource] = useState<Source | null>(initialSource ?? null)
  const [boxes, setBoxes] = useState<BufferBox[]>([])
  const [items, setItems] = useState<BufferItem[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // Очередь развозки общая на склад: по ней видно, осталось ли что-то у стола.
  const [pending, setPending] = useState<ContainerPendingPlacement | null>(null)

  const loadPending = useCallback((signal?: AbortSignal) => {
    getPendingPlacement(signal)
      .then((r) => { if (!signal?.aborted) setPending(r) })
      .catch(() => {})
  }, [])
  useEffect(() => {
    const ac = new AbortController()
    loadPending(ac.signal)
    return () => ac.abort()
  }, [loadPending])

  const boxQty = boxes.reduce((s, b) => s + b.items_qty, 0)
  const itemQty = items.reduce((s, i) => s + i.qty, 0)
  const total = boxQty + itemQty
  const empty = boxes.length === 0 && items.length === 0

  function addItem(barcode: string, label: string) {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.barcode === barcode)
      if (idx < 0) return [{ key: `${barcode}-${Date.now()}`, barcode, label, qty: 1, quality: 'auto' }, ...prev]
      const next = [...prev]
      next[idx] = { ...next[idx], qty: next[idx].qty + 1 }
      return next
    })
  }

  function setItemQty(key: string, raw: string) {
    const digits = raw.replace(/\D/g, '')
    setItems((prev) => prev.map((x) => (
      x.key === key ? { ...x, qty: digits === '' ? 0 : Math.max(0, parseInt(digits, 10)) } : x
    )))
  }

  // Сканер не закрывается между сканами: человек стоит со стопкой и щёлкает подряд.
  // Ошибка серию рвёт, но буфер не трогает — набранное не должно теряться из-за
  // одного чужого кода.
  async function onScan() {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      for (;;) {
        const code = await scanSource.scan()
        if (!code) return
        if (isContainerCode(code)) {
          const found = await getContainerByCode(code)
          const box = found.container
          if (!found.found || !box) {
            scanNotFoundFeedback()
            setError(`Короб «${code}» не найден`)
            return
          }
          if (box.status === 'new' || box.status === 'open') {
            scanNotFoundFeedback()
            setError(`Короб ${box.doc_number} ещё не закрыт — закройте его в задаче сборки`)
            return
          }
          if (boxes.some((b) => b.id === box.id)) {
            setNotice(`Короб ${box.doc_number} уже в списке`)
            continue
          }
          scanSuccessFeedback()
          setBoxes((prev) => [
            { id: box.id, doc_number: box.doc_number, items_qty: box.items_qty, moving: box.status === 'placed' },
            ...prev,
          ])
          continue
        }
        if (isLocationCode(code)) {
          const loc = await getLocationByCode(code)
          if (!loc.found || !loc.location) {
            scanNotFoundFeedback()
            setError(`Место по коду «${code}» не найдено`)
            return
          }
          scanSuccessFeedback()
          setSource({ id: loc.location.id, code: loc.location.code })
          setNotice(`Беру из места ${loc.location.code}`)
          continue
        }
        const found = await getProductByBarcode(code)
        if (!found.found || !found.match) {
          scanNotFoundFeedback()
          setError(`Код «${code}» не найден — это не короб, не место и не товар`)
          return
        }
        scanSuccessFeedback()
        addItem(code, variantTitle(found.match.product_name, [found.match.color_name, found.match.size_name]))
      }
    } catch (err) {
      scanNotFoundFeedback()
      setError(err instanceof Error ? err.message : 'Сканирование не удалось')
    } finally {
      setBusy(false)
    }
  }

  async function onScanZone() {
    if (busy || empty) return
    if (items.some((i) => i.qty <= 0)) {
      setError('Укажите количество в каждой строке')
      return
    }
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
      const scans: ContainerPlaceItemScan[] = items.map((i) => ({
        barcode: i.barcode,
        qty: i.qty,
        ...(i.quality === 'auto' ? {} : { quality: i.quality }),
        ...(source ? { from_zone_id: source.id } : {}),
      }))
      const res = await placeContainers(
        { zone_id: loc.location.id, box_ids: boxes.map((b) => b.id), items: scans },
        newRequestId(),
      )
      scanSuccessFeedback()
      setBoxes([])
      setItems([])
      setSource(null)
      setNotice(`${res.placed_qty} шт. → ${res.zone_name}`)
      loadPending()
    } catch (err) {
      scanNotFoundFeedback()
      setError(err instanceof Error ? err.message : 'Не удалось разместить')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen">
      <AppBar
        title="Перенос"
        sub={empty ? 'короба и товар → место хранения' : `в руках: ${total} шт.`}
        onBack={back}
      />

      <div className="scroll pad-nav">
        <button className="btn" style={{ width: '100%' }} disabled={busy} onClick={() => { void onScan() }}>
          <Icon name="qr" size={18} /> Сканировать короба, товар и место
        </button>
        <div className="line-sub" style={{ textAlign: 'center' }}>
          Сканер не закрывается — пикайте подряд. Закрытый короб встанет на место, уже
          размещённый переедет. Товар с полки берите после скана места, откуда берёте.
        </div>

        {pending && (pending.boxes.length > 0 || pending.aside_qty > 0) && (
          <div className="line">
            <div className="line-name">
              У стола ждут развозки: коробов {pending.boxes.length}
              {pending.aside_qty > 0 ? `, мимо коробов ${pending.aside_qty} шт.` : ''}
            </div>
            <div className="line-sub">Очередь общая — в ней объекты всех задач сборки</div>
          </div>
        )}

        {source && (
          <div className="line">
            <div className="line-row" style={{ marginTop: 0, alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="line-name">Беру из: {source.code}</div>
                <div className="line-sub">Товар в списке спишется из этого места</div>
              </div>
              <button className="btn ghost sm" disabled={busy} onClick={() => setSource(null)}>
                <Icon name="x" size={14} /> Сбросить
              </button>
            </div>
          </div>
        )}

        {notice && (
          <div className="alert ok" style={{ marginTop: 10 }}>
            <Icon name="check" size={15} />
            {notice}
          </div>
        )}

        {!empty && (
          <>
            <div className="sec">
              Взял
              <span className="sec-count">{boxes.length + items.length}</span>
            </div>
            {boxes.map((b) => (
              <div key={b.id} className="line">
                <div className="line-name mono">{b.doc_number}</div>
                <div className="line-sub">
                  {b.items_qty} шт.{b.moving ? ' · переезд из другого места' : ''}
                </div>
                <button
                  className="btn ghost sm"
                  style={{ width: '100%', marginTop: 4 }}
                  disabled={busy}
                  onClick={() => setBoxes((prev) => prev.filter((x) => x.id !== b.id))}
                >
                  <Icon name="x" size={14} /> Убрать из списка
                </button>
              </div>
            ))}
            {items.map((i) => (
              <div key={i.key} className="line">
                <div className="line-name">{i.label}</div>
                <div className="line-sub mono">{i.barcode}</div>
                <div className="line-row">
                  <input
                    className="input num"
                    inputMode="numeric"
                    style={{ width: 84, textAlign: 'right' }}
                    value={i.qty === 0 ? '' : String(i.qty)}
                    onChange={(e) => setItemQty(i.key, e.target.value)}
                    aria-label="Количество"
                  />
                  <button
                    className={`badge ${QUALITY_TONE[i.quality]}`}
                    style={{ border: 'none', cursor: 'pointer' }}
                    disabled={busy}
                    onClick={() => setItems((prev) => prev.map((x) => (
                      x.key === i.key ? { ...x, quality: QUALITY_NEXT[x.quality] } : x
                    )))}
                  >
                    {QUALITY_LABEL[i.quality]}
                  </button>
                  <button
                    className="btn ghost sm"
                    style={{ flex: 1 }}
                    disabled={busy}
                    onClick={() => setItems((prev) => prev.filter((x) => x.key !== i.key))}
                  >
                    <Icon name="x" size={14} /> Убрать
                  </button>
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
          {!empty && (
            <button className="btn ghost" disabled={busy} onClick={() => { setBoxes([]); setItems([]) }}>
              Очистить список
            </button>
          )}
          <button className="btn primary" disabled={busy || empty} onClick={() => { void onScanZone() }}>
            <Icon name="qr" size={18} /> Куда — скан места ({total} шт.)
          </button>
        </div>
      </div>
    </div>
  )
}
