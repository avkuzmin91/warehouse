import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { newRequestId } from '../api/http'
import { useNav } from '../nav/NavContext'
import { useHardwareBack } from '../nav/backHandlers'
import {
  getContainer,
  getContainerByCode,
  getPendingPlacement,
  isContainerCode,
  placeContainers,
  type ContainerItem,
  type ContainerPendingPlacement,
  type ContainerPlaceItemScan,
  type ContainerPlaceSource,
} from '../api/containersApi'
import { getBalancesByZone } from '../api/balancesApi'
import { getLocationByCode, isLocationCode } from '../api/locationsApi'
import { getProductByBarcode } from '../api/productsApi'
import { AppBar } from '../components/AppBar'
import { Icon } from '../components/Icon'
import { scanSource } from '../scan/ScanSource'
import { scanNotFoundFeedback, scanSuccessFeedback } from '../utils/feedback'
import { variantTitle } from '../utils/format'

/** Качество россыпи: «авто» — определит backend, если в источнике товар одного качества. */
type ItemQuality = 'auto' | 'good' | 'defect'

const QUALITY_NEXT: Record<ItemQuality, ItemQuality> = { auto: 'good', good: 'defect', defect: 'auto' }
const QUALITY_LABEL: Record<ItemQuality, string> = { auto: 'качество: авто', good: 'годный', defect: 'брак' }
const QUALITY_TONE: Record<ItemQuality, string> = { auto: '', good: 'success', defect: 'danger' }

export type PlaceSource =
  | { kind: 'collected' }
  | { kind: 'location'; id: string; code: string }
  | { kind: 'container'; id: string; doc_number: string; zone_id: string | null; zone_name: string | null }

type PlaceTarget =
  | { kind: 'location'; id: string; code: string }
  | { kind: 'container'; id: string; doc_number: string; zone_id: string | null; zone_name: string | null }

type EndpointKind = 'location' | 'container'

/** С чем открыт экран: источник и/или уже отсканированный короб (со скан-кнопки). */
export type PlaceInit = { source?: PlaceSource; box?: ContainerItem }

type BufferBox = { id: string; doc_number: string; items_qty: number; moving: boolean }
type BufferItem = {
  key: string
  barcode: string
  label: string
  product_id: string
  color_id: string | null
  size_id: string | null
  qty: number
  quality: ItemQuality
}

/** Что лежит в источнике, по вариантам: проверка «этого товара тут нет» на каждом скане. */
type Snapshot = Map<string, number>

const COLLECTED: PlaceSource = { kind: 'collected' }

function variantKey(v: { product_id: string; color_id: string | null; size_id: string | null }): string {
  return `${v.product_id}|${v.color_id ?? ''}|${v.size_id ?? ''}`
}

function sourceLabel(s: PlaceSource): string {
  if (s.kind === 'collected') return 'Зона упаковки'
  if (s.kind === 'location') return `Ячейка ${s.code}`
  return `Короб ${s.doc_number}`
}

function sourceWhere(s: PlaceSource): string {
  if (s.kind === 'collected') return 'у стола'
  if (s.kind === 'location') return `в ячейке ${s.code}`
  return `в коробе ${s.doc_number}`
}

function targetLabel(t: PlaceTarget): string {
  return t.kind === 'location' ? `Ячейка ${t.code}` : `Короб ${t.doc_number}`
}

function toApiSource(s: PlaceSource): ContainerPlaceSource {
  if (s.kind === 'collected') return { kind: 'collected' }
  return { kind: s.kind, id: s.id }
}

function boxFromItem(box: ContainerItem): BufferBox {
  return { id: box.id, doc_number: box.doc_number, items_qty: box.items_qty, moving: box.status === 'placed' }
}

/** Короб как объект переноса: сверка с названным источником — ошибка, а не молчаливая правка учёта. */
function boxSourceError(box: ContainerItem, source: PlaceSource): string | null {
  if (box.status === 'new' || box.status === 'open') {
    return `Короб ${box.doc_number} ещё не закрыт — закройте его в задаче сборки`
  }
  if (source.kind === 'container') return 'Из короба берут только товар — короб в коробе не лежит'
  if (source.kind === 'collected' && box.status === 'placed') {
    return `Короб ${box.doc_number} уже стоит в ячейке ${box.zone_name ?? '—'} — укажите эту ячейку как источник`
  }
  if (source.kind === 'location') {
    if (box.status === 'closed') return `Короб ${box.doc_number} ещё у стола — источник «Зона упаковки»`
    if (box.zone_id !== source.id) {
      return `Короб ${box.doc_number} числится в ячейке ${box.zone_name ?? '—'}, а не ${source.code}`
    }
  }
  return null
}

function StepCard({
  n, title, value, locked, children,
}: {
  n: number
  title: string
  value: string | null
  locked: boolean
  children: ReactNode
}) {
  return (
    <div className="line" style={locked ? { opacity: 0.5 } : undefined} aria-disabled={locked}>
      <div className="line-head">
        <div style={{ minWidth: 0 }}>
          <div className="line-sub" style={{ marginTop: 0 }}>Шаг {n}</div>
          <div className="line-name">{title}</div>
        </div>
        {value && (
          <span className="badge success" style={{ flex: '0 0 auto', maxWidth: '55%' }}>
            <span className="dot" />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

/** «Перемещение»: откуда → что → куда → подтвердить.
 *
 * Три шага видны всегда, активен только следующий за заполненным. «Откуда» по
 * умолчанию — зона упаковки (то, что собрано у стола и ждёт развозки), так что
 * развозка короба остаётся двумя сканами: короб, потом место. Товар набирается
 * поштучным сканом, количество — число сканов. В учёт ничего не пишется, пока
 * кладовщик не увидел сводку и не нажал «Подтвердить перемещение».
 *
 * Названный источник — ещё и сверка: короб, который числится в другом месте, или
 * товар, которого в источнике нет, отбиваются прямо на скане, а не пятидесятым
 * сканом позже при отправке.
 */
export function PlaceScreen({ init }: { init?: PlaceInit }) {
  const { back } = useNav()
  const [source, setSource] = useState<PlaceSource>(init?.source ?? COLLECTED)
  const [boxes, setBoxes] = useState<BufferBox[]>(init?.box ? [boxFromItem(init.box)] : [])
  const [items, setItems] = useState<BufferItem[]>([])
  const [target, setTarget] = useState<PlaceTarget | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // Смена источника при набранной пачке: список очищается, поэтому спрашиваем.
  const [resetAsk, setResetAsk] = useState<null | 'collected' | EndpointKind>(null)
  // Сверка ячейки на сводке: необязательный скан места, где должен стоять короб.
  const [cellChecked, setCellChecked] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
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

  // Состав источника подгружается один раз при его выборе; без него сканы не
  // проверяются локально — последнее слово всё равно за backend при подтверждении.
  useEffect(() => {
    const ac = new AbortController()
    setSnapshot(null)
    const load = async (): Promise<Snapshot> => {
      const snap: Snapshot = new Map()
      const add = (v: { product_id: string; color_id: string | null; size_id: string | null }, qty: number) => {
        const k = variantKey(v)
        snap.set(k, (snap.get(k) ?? 0) + qty)
      }
      if (source.kind === 'collected') {
        const r = await getPendingPlacement(ac.signal)
        r.aside.forEach((a) => add(a, a.qty))
      } else if (source.kind === 'container') {
        const r = await getContainer(source.id, ac.signal)
        r.contents.forEach((c) => add(c, c.qty))
      } else {
        const r = await getBalancesByZone({ location: source.code }, ac.signal)
        r.items
          .filter((b) => b.location_id === source.id && b.op_status === 'storage')
          .forEach((b) => add(b, b.qty))
      }
      return snap
    }
    load()
      .then((snap) => { if (!ac.signal.aborted) setSnapshot(snap) })
      .catch(() => {})
    return () => ac.abort()
  }, [source])

  // Сводка перехватывает аппаратную «Назад»: она возвращает к шагу 3, а не уводит
  // с экрана, иначе набранная пачка теряется одним случайным нажатием.
  useHardwareBack(() => { if (!busy) setTarget(null) }, target !== null)

  const boxQty = boxes.reduce((s, b) => s + b.items_qty, 0)
  const itemQty = items.reduce((s, i) => s + i.qty, 0)
  const total = boxQty + itemQty
  const empty = boxes.length === 0 && items.length === 0

  function clearAll() {
    setBoxes([])
    setItems([])
    setTarget(null)
    setCellChecked(null)
  }

  function applySource(next: PlaceSource) {
    setSource(next)
    clearAll()
    setResetAsk(null)
    setError('')
    setNotice(`Откуда: ${sourceLabel(next)}`)
  }

  /** Проверка товара по снимку источника: чего нет — отбивается на скане. */
  function itemScanError(variant: BufferItem, nextQty: number): string | null {
    if (!snapshot) return null
    const have = snapshot.get(variantKey(variant)) ?? 0
    if (have <= 0) return `Этого товара нет ${sourceWhere(source)} — проверьте, что сканируете`
    if (nextQty > have) return `${sourceWhere(source)[0].toUpperCase()}${sourceWhere(source).slice(1)} только ${have} шт. этого товара`
    return null
  }

  function targetError(next: PlaceTarget, boxBuf: BufferBox[]): string | null {
    if (next.kind === 'location') {
      if (source.kind === 'location' && source.id === next.id) return 'Источник и приёмник совпадают'
      return null
    }
    if (boxBuf.length > 0) return 'Короб в короб не вкладывается'
    if (source.kind === 'container' && source.id === next.id) return 'Источник и приёмник — один и тот же короб'
    return null
  }

  /** Скан «Откуда» / «Куда»: место или размещённый короб. Строка — текст ошибки.
   *
   * Кнопка задаёт ожидаемый тип кода: человек нажал «Короб» и видит, что отсканировал не то,
   * вместо молчаливой подстановки места.
   */
  async function resolveEndpoint(
    code: string, role: 'source' | 'target', expect: EndpointKind,
  ): Promise<PlaceTarget | string> {
    if (isLocationCode(code)) {
      if (expect !== 'location') return `Код «${code}» — это ячейка, а нужен короб`
      const loc = await getLocationByCode(code)
      if (!loc.found || !loc.location) return `Ячейка по коду «${code}» не найдена`
      return { kind: 'location', id: loc.location.id, code: loc.location.code }
    }
    if (isContainerCode(code)) {
      if (expect !== 'container') return `Код «${code}» — это короб, а нужна ячейка`
      const found = await getContainerByCode(code)
      const box = found.container
      if (!found.found || !box) return `Короб «${code}» не найден`
      if (box.status !== 'placed') {
        return role === 'target'
          ? `Короб ${box.doc_number} ещё не размещён — докладывать можно только в короб на месте`
          : `Короб ${box.doc_number} ещё не размещён — его состав меняют в задаче сборки`
      }
      return { kind: 'container', id: box.id, doc_number: box.doc_number, zone_id: box.zone_id, zone_name: box.zone_name }
    }
    return expect === 'location' ? `Код «${code}» — не ячейка` : `Код «${code}» — не короб`
  }

  /** Шаг 1: один скан по кнопке «Место» или «Короб».
   *
   * Порядок «ячейка, потом короб» тоже принимается: если источник уже место, а
   * следом отсканирован короб, из него достают товар, а ячейка становится сверкой —
   * короб, который числится не там, отбивается ошибкой.
   */
  async function scanSourceStep(expect: EndpointKind) {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const code = await scanSource.scan()
      if (!code) return
      const found = await resolveEndpoint(code, 'source', expect)
      if (typeof found === 'string') {
        scanNotFoundFeedback()
        setError(found)
        return
      }
      if (found.kind === 'container' && source.kind === 'location' && found.zone_id !== source.id) {
        scanNotFoundFeedback()
        setError(`Короб ${found.doc_number} числится в ячейке ${found.zone_name ?? '—'}, а не ${source.code}`)
        return
      }
      scanSuccessFeedback()
      if (found.kind === 'location') applySource({ kind: 'location', id: found.id, code: found.code })
      else {
        applySource({
          kind: 'container', id: found.id, doc_number: found.doc_number,
          zone_id: found.zone_id, zone_name: found.zone_name,
        })
      }
    } catch (err) {
      scanNotFoundFeedback()
      setError(err instanceof Error ? err.message : 'Сканирование не удалось')
    } finally {
      setBusy(false)
    }
  }

  /** Шаг 2: сканер не закрывается, объекты набираются подряд. Скан места завершает набор и заполняет шаг 3. */
  async function scanObjects() {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    // Внутри серии состояние читается из локальных снимков: set* в этом замыкании не видны.
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
          const problem = boxSourceError(box, source)
          if (problem) {
            scanNotFoundFeedback()
            setError(problem)
            return
          }
          if (boxBuf.some((b) => b.id === box.id)) {
            scanNotFoundFeedback()
            setNotice(`Короб ${box.doc_number} уже в списке`)
            continue
          }
          scanSuccessFeedback()
          boxBuf = [boxFromItem(box), ...boxBuf]
          setBoxes(boxBuf)
          continue
        }
        if (isLocationCode(code)) {
          const found = await resolveEndpoint(code, 'target', 'location')
          if (typeof found === 'string') {
            scanNotFoundFeedback()
            setError(found)
            return
          }
          if (boxBuf.length === 0 && itemBuf.length === 0) {
            scanNotFoundFeedback()
            setError('Сначала отсканируйте, что переносите, — ячейка назначения идёт третьим шагом')
            return
          }
          const problem = targetError(found, boxBuf)
          if (problem) {
            scanNotFoundFeedback()
            setError(problem)
            return
          }
          scanSuccessFeedback()
          setTarget(found)
          return
        }
        const found = await getProductByBarcode(code)
        if (!found.found || !found.match) {
          scanNotFoundFeedback()
          setError(`Код «${code}» не найден — это не короб, не ячейка и не товар`)
          return
        }
        const m = found.match
        const idx = itemBuf.findIndex((i) => i.barcode === code)
        const nextQty = idx < 0 ? 1 : itemBuf[idx].qty + 1
        const probe: BufferItem = idx < 0
          ? {
            key: `${code}-${Date.now()}`, barcode: code,
            label: variantTitle(m.product_name, [m.color_name, m.size_name]),
            product_id: m.product_id, color_id: m.color_id, size_id: m.size_id,
            qty: 1, quality: 'auto',
          }
          : itemBuf[idx]
        const problem = itemScanError(probe, nextQty)
        if (problem) {
          scanNotFoundFeedback()
          setError(problem)
          return
        }
        scanSuccessFeedback()
        if (idx < 0) itemBuf = [probe, ...itemBuf]
        else {
          itemBuf = [...itemBuf]
          itemBuf[idx] = { ...itemBuf[idx], qty: nextQty }
        }
        setItems(itemBuf)
      }
    } catch (err) {
      scanNotFoundFeedback()
      setError(err instanceof Error ? err.message : 'Сканирование не удалось')
    } finally {
      setBusy(false)
    }
  }

  /** Шаг 3: один скан по кнопке «В место» или «В короб». Дальше сводка. */
  async function scanTargetStep(expect: EndpointKind) {
    if (busy || empty) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const code = await scanSource.scan()
      if (!code) return
      const found = await resolveEndpoint(code, 'target', expect)
      if (typeof found === 'string') {
        scanNotFoundFeedback()
        setError(found)
        return
      }
      const problem = targetError(found, boxes)
      if (problem) {
        scanNotFoundFeedback()
        setError(problem)
        return
      }
      scanSuccessFeedback()
      setTarget(found)
    } catch (err) {
      scanNotFoundFeedback()
      setError(err instanceof Error ? err.message : 'Сканирование не удалось')
    } finally {
      setBusy(false)
    }
  }

  function decItem(key: string) {
    setItems((prev) => prev
      .map((x) => (x.key === key ? { ...x, qty: x.qty - 1 } : x))
      .filter((x) => x.qty > 0))
  }

  function dropBox(id: string) {
    setBoxes((prev) => prev.filter((x) => x.id !== id))
  }

  async function submit() {
    if (busy || empty || !target) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const scans: ContainerPlaceItemScan[] = items.map((i) => ({
        barcode: i.barcode,
        qty: i.qty,
        ...(i.quality === 'auto' ? {} : { quality: i.quality }),
      }))
      const res = await placeContainers(
        {
          source: toApiSource(source),
          target: { kind: target.kind, id: target.id },
          box_ids: boxes.map((b) => b.id),
          items: scans,
        },
        newRequestId(),
      )
      scanSuccessFeedback()
      // Источник остаётся: одна тележка развозится по нескольким полкам без повторного выбора.
      setBoxes([])
      setItems([])
      setTarget(null)
      setNotice(
        `${res.placed_qty} шт. → ${res.target_container ? `короб ${res.target_container.doc_number}` : res.zone_name}`,
      )
      loadPending()
      if (source.kind !== 'collected') setSource({ ...source })  // перечитать снимок источника
    } catch (err) {
      scanNotFoundFeedback()
      setError(err instanceof Error ? err.message : 'Не удалось переместить')
    } finally {
      setBusy(false)
    }
  }

  function runSourceChoice(kind: 'collected' | EndpointKind) {
    if (kind === 'collected') applySource(COLLECTED)
    else void scanSourceStep(kind)
  }

  function askOrRun(kind: 'collected' | EndpointKind) {
    if (busy) return
    if (!empty) {
      setResetAsk(kind)
      return
    }
    runSourceChoice(kind)
  }

  /** Схема «ячейка, потом короб» на приёмнике: место уже отсканировано, товар кладут в короб на этой полке. */
  async function refineTargetToBox() {
    if (busy || !target || target.kind !== 'location' || boxes.length > 0) return
    setBusy(true)
    setError('')
    try {
      const code = await scanSource.scan()
      if (!code) return
      const found = await resolveEndpoint(code, 'target', 'container')
      if (typeof found === 'string' || found.kind !== 'container') {
        scanNotFoundFeedback()
        setError(typeof found === 'string' ? found : 'Отсканируйте короб')
        return
      }
      if (found.zone_id !== target.id) {
        scanNotFoundFeedback()
        setError(`Короб ${found.doc_number} числится в ячейке ${found.zone_name ?? '—'}, а не ${target.code}`)
        return
      }
      const problem = targetError(found, boxes)
      if (problem) {
        scanNotFoundFeedback()
        setError(problem)
        return
      }
      scanSuccessFeedback()
      setTarget(found)
    } catch (err) {
      scanNotFoundFeedback()
      setError(err instanceof Error ? err.message : 'Сканирование не удалось')
    } finally {
      setBusy(false)
    }
  }

  /** Сверка ячейки на сводке — только для короба-приёмника: откуда взяли, уже проверено на скане. */
  const cellCheckBox = target?.kind === 'container' ? target : null

  async function checkCell() {
    if (busy || !cellCheckBox) return
    setBusy(true)
    setError('')
    try {
      const code = await scanSource.scan()
      if (!code) return
      const found = await resolveEndpoint(code, 'target', 'location')
      if (typeof found === 'string' || found.kind !== 'location') {
        scanNotFoundFeedback()
        setError(typeof found === 'string' ? found : 'Отсканируйте ячейку')
        return
      }
      if (found.id !== cellCheckBox.zone_id) {
        scanNotFoundFeedback()
        setError(`Короб ${cellCheckBox.doc_number} числится в ячейке ${cellCheckBox.zone_name ?? '—'}, а отсканирована ${found.code}`)
        return
      }
      scanSuccessFeedback()
      setCellChecked(found.code)
    } catch (err) {
      scanNotFoundFeedback()
      setError(err instanceof Error ? err.message : 'Сканирование не удалось')
    } finally {
      setBusy(false)
    }
  }

  const showQuality = source.kind !== 'container'
  const sourceValue = sourceLabel(source)
  const objectsValue = empty ? null : `${total} шт.`

  if (target) {
    return (
      <div className="screen">
        <AppBar title="Подтверждение" sub={`${sourceLabel(source)} → ${targetLabel(target)}`} onBack={() => setTarget(null)} />
        <div className="scroll pad-nav">
          <div className="line">
            <div className="line-sub" style={{ marginTop: 0 }}>Откуда</div>
            <div className="line-name">{sourceLabel(source)}</div>
            <div className="line-sub">Куда</div>
            <div className="line-name">
              {targetLabel(target)}
              {target.kind === 'container' && target.zone_name ? ` · стоит в ${target.zone_name}` : ''}
            </div>
          </div>

          <div className="sec">
            Что переносим
            <span className="sec-count">{boxes.length + items.length}</span>
          </div>
          {boxes.map((b) => (
            <div key={b.id} className="line">
              <div className="line-name mono">{b.doc_number}</div>
              <div className="line-sub">{b.items_qty} шт.{b.moving ? ' · переезд' : ' · размещение'}</div>
            </div>
          ))}
          {items.map((i) => (
            <div key={i.key} className="line">
              <div className="line-head">
                <div style={{ minWidth: 0 }}>
                  <div className="line-name">{i.label}</div>
                  <div className="line-sub mono">{i.barcode}</div>
                </div>
                <div className="line-name" style={{ flex: '0 0 auto' }}>{i.qty} шт.</div>
              </div>
              {showQuality && <div className="line-sub">{QUALITY_LABEL[i.quality]}</div>}
            </div>
          ))}

          <div className="actionbar">
            {error && (
              <div className="alert">
                <Icon name="alert" size={15} />
                <span style={{ flex: 1 }}>{error}</span>
                <button className="line-undo" onClick={() => setError('')} aria-label="Закрыть">
                  <Icon name="x" size={13} />
                </button>
              </div>
            )}
            {target.kind === 'location' && boxes.length === 0 && (
              <button className="btn ghost" disabled={busy} onClick={() => { void refineTargetToBox() }}>
                <Icon name="qr" size={16} /> Кладу в короб на этой полке — скан QR короба
              </button>
            )}
            {cellCheckBox && (
              cellChecked ? (
                <div className="alert ok">
                  <Icon name="check" size={15} />
                  Ячейка сверена: {cellChecked}
                </div>
              ) : (
                <button className="btn ghost" disabled={busy} onClick={() => { void checkCell() }}>
                  <Icon name="qr" size={16} /> Сверить ячейку короба {cellCheckBox.doc_number} — не обязательно
                </button>
              )
            )}
            <button className="btn primary" disabled={busy} onClick={() => { void submit() }}>
              {busy ? <span className="spin spin-sm" /> : <Icon name="check" size={18} />}
              {' '}Подтвердить перемещение · {total} шт.
            </button>
            <button className="btn ghost" disabled={busy} onClick={() => { setTarget(null); setCellChecked(null) }}>
              Назад — изменить «Куда»
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="screen">
      <AppBar
        title="Перемещение"
        sub={empty ? 'откуда → что → куда' : `в руках: ${total} шт.`}
        onBack={back}
      />

      <div className="scroll pad-nav">
        {notice && (
          <div className="alert ok" style={{ marginBottom: 10 }}>
            <Icon name="check" size={15} />
            {notice}
          </div>
        )}

        <StepCard n={1} title="Откуда" value={sourceValue} locked={false}>
          {resetAsk ? (
            <>
              <div className="line-sub" style={{ textAlign: 'center', margin: '8px 0 2px' }}>
                Сменить «Откуда»? Набранное очистится
              </div>
              <div className="line-row" style={{ marginTop: 0 }}>
                <button className="btn ghost" style={{ flex: 1 }} disabled={busy} onClick={() => setResetAsk(null)}>Нет</button>
                <button
                  className="btn"
                  style={{ flex: 1 }}
                  disabled={busy}
                  onClick={() => {
                    const kind = resetAsk
                    clearAll()
                    setResetAsk(null)
                    runSourceChoice(kind)
                  }}
                >
                  Да, сменить
                </button>
              </div>
            </>
          ) : (
            <div className="line-row">
              <button
                className={source.kind === 'collected' ? 'btn sm' : 'btn ghost sm'}
                style={{ flex: 1 }}
                disabled={busy || source.kind === 'collected'}
                onClick={() => askOrRun('collected')}
              >
                Зона упаковки
              </button>
              <button
                className={source.kind === 'location' ? 'btn sm' : 'btn ghost sm'}
                style={{ flex: 1 }}
                disabled={busy}
                onClick={() => askOrRun('location')}
              >
                <Icon name="qr" size={15} /> Ячейка
              </button>
              <button
                className={source.kind === 'container' ? 'btn sm' : 'btn ghost sm'}
                style={{ flex: 1 }}
                disabled={busy}
                onClick={() => askOrRun('container')}
              >
                <Icon name="qr" size={15} /> Короб
              </button>
            </div>
          )}
          {source.kind === 'collected' && pending && (pending.boxes.length > 0 || pending.aside_qty > 0) && (
            <div className="line-sub">
              У стола ждут развозки: коробов {pending.boxes.length}
              {pending.aside_qty > 0 ? `, без короба ${pending.aside_qty} шт.` : ''}
            </div>
          )}
          {source.kind === 'container' && (
            <div className="line-sub">Стоит в {source.zone_name ?? '—'} · из короба берут только товар</div>
          )}
          {source.kind === 'location' && (
            <div className="line-sub">Достаёте из короба на этой полке — нажмите «Короб» и отсканируйте его</div>
          )}
        </StepCard>

        <StepCard n={2} title="Что переносим" value={objectsValue} locked={false}>
          <button className="btn" style={{ width: '100%', marginTop: 10 }} disabled={busy} onClick={() => { void scanObjects() }}>
            <Icon name="qr" size={18} /> {empty ? 'Сканировать короба или товар' : 'Сканировать дальше'}
          </button>
          <div className="line-sub" style={{ textAlign: 'center' }}>
            Товар — по одной штуке, каждый скан +1. Сканер не закрывается.
          </div>
          {boxes.map((b) => (
            <div key={b.id} className="line-head" style={{ marginTop: 10, alignItems: 'center' }}>
              <div style={{ minWidth: 0 }}>
                <div className="line-name mono">{b.doc_number}</div>
                <div className="line-sub" style={{ marginTop: 0 }}>{b.items_qty} шт.{b.moving ? ' · переезд' : ''}</div>
              </div>
              <button className="line-undo" disabled={busy} onClick={() => dropBox(b.id)}>
                <Icon name="x" size={13} /> Убрать
              </button>
            </div>
          ))}
          {items.map((i) => (
            <div key={i.key} style={{ marginTop: 10 }}>
              <div className="line-head" style={{ alignItems: 'center' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="line-name">{i.label}</div>
                  <div className="line-sub mono" style={{ marginTop: 0 }}>{i.barcode}</div>
                </div>
                <div className="line-name" style={{ flex: '0 0 auto', marginLeft: 8 }}>{i.qty} шт.</div>
              </div>
              <div className="line-foot">
                {showQuality && (
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
                )}
                <span style={{ flex: 1 }} />
                <button className="line-undo" disabled={busy} onClick={() => decItem(i.key)}>−1 шт.</button>
              </div>
            </div>
          ))}
        </StepCard>

        <StepCard n={3} title="Куда" value={null} locked={empty}>
          <div className="line-row">
            <button
              className="btn primary"
              style={{ flex: 1 }}
              disabled={busy || empty}
              onClick={() => { void scanTargetStep('location') }}
            >
              <Icon name="qr" size={18} /> В ячейку
            </button>
            <button
              className="btn primary"
              style={{ flex: 1 }}
              disabled={busy || empty || boxes.length > 0}
              onClick={() => { void scanTargetStep('container') }}
            >
              <Icon name="qr" size={18} /> В короб
            </button>
          </div>
          <div className="line-sub" style={{ textAlign: 'center' }}>
            {empty
              ? 'Откроется после шага 2'
              : boxes.length > 0
                ? 'Короба едут только в ячейку — короб в короб не вкладывается'
                : 'Скан ячейки или размещённого короба, затем сводка и подтверждение'}
          </div>
        </StepCard>

        {error && (
          <div className="alert">
            <Icon name="alert" size={15} />
            <span style={{ flex: 1 }}>{error}</span>
            <button className="line-undo" onClick={() => setError('')} aria-label="Закрыть">
              <Icon name="x" size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
