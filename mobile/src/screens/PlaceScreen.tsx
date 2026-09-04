import { useCallback, useEffect, useState } from 'react'
import { newRequestId } from '../api/http'
import { useNav } from '../nav/NavContext'
import { useHardwareBack } from '../nav/backHandlers'
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

type Zone = { id: string; code: string }
type BufferBox = { id: string; doc_number: string; items_qty: number; moving: boolean }
type BufferItem = { key: string; barcode: string; label: string; qty: number; quality: ItemQuality }

function withItem(list: BufferItem[], barcode: string, label: string): BufferItem[] {
  const idx = list.findIndex((i) => i.barcode === barcode)
  if (idx < 0) return [{ key: `${barcode}-${Date.now()}`, barcode, label, qty: 1, quality: 'auto' }, ...list]
  const next = [...list]
  next[idx] = { ...next[idx], qty: next[idx].qty + 1 }
  return next
}

/** «Перенос»: пачка коробов и товара уезжает в одно место хранения.
 *
 * Физика такая: кладовщик берёт стопку коробов (или товар с полки), везёт к стеллажу
 * и там пикает объекты, потом место. Поэтому серия сканов не прерывается: скан места
 * сам по себе и есть команда «положил» — руки к телефону возвращаются один раз за
 * ходку, а не на каждый объект.
 *
 * Роль отсканированного места выводится из буфера, отдельного режима нет: пустые руки
 * плюс место = «беру отсюда» (положить нечего), полные плюс место = «кладу сюда».
 * Источник нужен только россыпи с полки — короб и собранное у стола система находит сама.
 *
 * Скан места назначения не отправляет пачку сразу, а показывает подтверждение: это
 * единственная защита от чужой этикетки на стеллаже, и там же правятся количество и
 * качество россыпи (при открытом сканере в список не попасть).
 */
export function PlaceScreen({ source: initialSource }: { source?: Zone }) {
  const { back } = useNav()
  const [source, setSource] = useState<Zone | null>(initialSource ?? null)
  const [dest, setDest] = useState<Zone | null>(null)
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

  // Подтверждение перехватывает аппаратную «Назад»: она отменяет отправку, а не уводит
  // с экрана, иначе набранная пачка теряется одним случайным нажатием.
  useHardwareBack(() => { if (!busy) setDest(null) }, dest !== null)

  const boxQty = boxes.reduce((s, b) => s + b.items_qty, 0)
  const itemQty = items.reduce((s, i) => s + i.qty, 0)
  const total = boxQty + itemQty
  const empty = boxes.length === 0 && items.length === 0

  function setItemQty(key: string, raw: string) {
    const digits = raw.replace(/\D/g, '')
    setItems((prev) => prev.map((x) => (
      x.key === key ? { ...x, qty: digits === '' ? 0 : Math.max(0, parseInt(digits, 10)) } : x
    )))
  }

  function dropBox(id: string) {
    const next = boxes.filter((x) => x.id !== id)
    setBoxes(next)
    if (next.length === 0 && items.length === 0) setDest(null)
  }

  function dropItem(key: string) {
    const next = items.filter((x) => x.key !== key)
    setItems(next)
    if (next.length === 0 && boxes.length === 0) setDest(null)
  }

  // Сканер не закрывается между сканами: человек стоит со стопкой и щёлкает подряд.
  // Ошибка серию рвёт, но буфер не трогает — набранное не должно теряться из-за
  // одного чужого кода.
  async function onScan() {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    // Состояние внутри серии читается из локального снимка: setBoxes/setItems в этом
    // замыкании не видны, поэтому по самому `boxes` повторный скан того же короба не
    // отсеивался бы, а по `items` пустота буфера читалась бы неверно — и место
    // назначения приняли бы за источник.
    let boxBuf = boxes
    let itemBuf = items
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
          if (boxBuf.some((b) => b.id === box.id)) {
            scanNotFoundFeedback()
            setNotice(`Короб ${box.doc_number} уже в списке`)
            continue
          }
          scanSuccessFeedback()
          boxBuf = [
            { id: box.id, doc_number: box.doc_number, items_qty: box.items_qty, moving: box.status === 'placed' },
            ...boxBuf,
          ]
          setBoxes(boxBuf)
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
          const zone = { id: loc.location.id, code: loc.location.code }
          if (boxBuf.length === 0 && itemBuf.length === 0) {
            setSource(zone)
            setNotice(`Беру из места ${zone.code}`)
            continue
          }
          setDest(zone)
          return
        }
        const found = await getProductByBarcode(code)
        if (!found.found || !found.match) {
          scanNotFoundFeedback()
          setError(`Код «${code}» не найден — это не короб, не место и не товар`)
          return
        }
        scanSuccessFeedback()
        itemBuf = withItem(
          itemBuf,
          code,
          variantTitle(found.match.product_name, [found.match.color_name, found.match.size_name]),
        )
        setItems(itemBuf)
      }
    } catch (err) {
      scanNotFoundFeedback()
      setError(err instanceof Error ? err.message : 'Сканирование не удалось')
    } finally {
      setBusy(false)
    }
  }

  /** Разовый скан места: запасной вход, если серия оборвалась, и явное «беру отсюда» с набранной пачкой. */
  async function scanZone(role: 'from' | 'to') {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const code = await scanSource.scan()
      if (!code) return
      if (!isLocationCode(code)) {
        scanNotFoundFeedback()
        setError(`Код «${code}» — не место хранения`)
        return
      }
      const loc = await getLocationByCode(code)
      if (!loc.found || !loc.location) {
        scanNotFoundFeedback()
        setError(`Место по коду «${code}» не найдено`)
        return
      }
      scanSuccessFeedback()
      const zone = { id: loc.location.id, code: loc.location.code }
      if (role === 'from') {
        setSource(zone)
        setNotice(`Беру из места ${zone.code}`)
        return
      }
      setDest(zone)
    } catch (err) {
      scanNotFoundFeedback()
      setError(err instanceof Error ? err.message : 'Сканирование не удалось')
    } finally {
      setBusy(false)
    }
  }

  async function submit() {
    if (busy || empty || !dest) return
    if (items.some((i) => i.qty <= 0)) {
      setError('Укажите количество в каждой строке')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const scans: ContainerPlaceItemScan[] = items.map((i) => ({
        barcode: i.barcode,
        qty: i.qty,
        ...(i.quality === 'auto' ? {} : { quality: i.quality }),
        ...(source ? { from_zone_id: source.id } : {}),
      }))
      const res = await placeContainers(
        { zone_id: dest.id, box_ids: boxes.map((b) => b.id), items: scans },
        newRequestId(),
      )
      scanSuccessFeedback()
      setBoxes([])
      setItems([])
      setSource(null)
      setDest(null)
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
        sub={dest ? `кладу в ${dest.code}` : empty ? 'короба и товар → место хранения' : `в руках: ${total} шт.`}
        onBack={back}
      />

      <div className="scroll pad-nav">
        {!dest && (
          <>
            <button className="btn" style={{ width: '100%' }} disabled={busy} onClick={() => { void onScan() }}>
              <Icon name="qr" size={18} /> {empty ? 'Сканировать' : 'Сканировать дальше'}
            </button>
            <div className="line-sub" style={{ textAlign: 'center' }}>
              Сканер не закрывается — пикайте подряд, последним место: его скан и означает
              «положил». Пустой список плюс место — наоборот, «беру отсюда».
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
          </>
        )}

        {dest && (
          <div className="line">
            <div className="line-name">Кладу в: {dest.code}</div>
            <div className="line-sub">Проверьте состав и подтвердите — пачка уедет одним движением</div>
          </div>
        )}

        {source && (
          <div className="line">
            <div className="line-row" style={{ marginTop: 0, alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="line-name">Беру из: {source.code}</div>
                <div className="line-sub">Товар в списке спишется из этого места</div>
              </div>
              {!dest && (
                <button className="btn ghost sm" disabled={busy} onClick={() => setSource(null)}>
                  <Icon name="x" size={14} /> Сбросить
                </button>
              )}
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
                  onClick={() => dropBox(b.id)}
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
                    onClick={() => dropItem(i.key)}
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
          {dest ? (
            <>
              <button className="btn ghost" disabled={busy} onClick={() => setDest(null)}>
                Отмена — вернуться к сканированию
              </button>
              <button className="btn primary" disabled={busy || empty} onClick={() => { void submit() }}>
                {busy ? <span className="spin spin-sm" /> : <Icon name="check" size={18} />}
                {' '}Разместить {total} шт. → {dest.code}
              </button>
            </>
          ) : (
            <>
              {!empty && (
                <div className="line-row" style={{ marginTop: 0 }}>
                  <button
                    className="btn ghost"
                    style={{ flex: 1 }}
                    disabled={busy}
                    onClick={() => { setBoxes([]); setItems([]) }}
                  >
                    Очистить список
                  </button>
                  {!source && (
                    <button
                      className="btn ghost"
                      style={{ flex: 1 }}
                      disabled={busy}
                      onClick={() => { void scanZone('from') }}
                    >
                      <Icon name="qr" size={16} /> Беру из места
                    </button>
                  )}
                </div>
              )}
              <button
                className="btn primary"
                disabled={busy || empty}
                onClick={() => { void scanZone('to') }}
              >
                <Icon name="qr" size={18} /> Куда — скан места ({total} шт.)
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
