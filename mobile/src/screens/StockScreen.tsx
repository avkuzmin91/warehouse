import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getUnloadingZones, type Zone } from '../api/lookupsApi'
import {
  createQualityChange,
  createRelocation,
  createWriteOff,
  getBalancesByZone,
  OP_STATUS_LABELS,
  OP_STATUS_TONE,
  QUALITY_LABELS,
  WRITEOFF_REASON_LABELS,
  type WriteOffReason,
  type ZoneBalance,
} from '../api/balancesApi'
import { newRequestId } from '../api/http'
import { balanceKey } from '../utils/balanceKey'
import { AppBar } from '../components/AppBar'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { ZoneField } from '../components/ZoneField'
import { PullToRefresh } from '../components/PullToRefresh'

// Место = физическая зона хранения; ∅ — товар без привязки к месту.
type Place = {
  key: string
  name: string
  rows: ZoneBalance[]
  total: number
  positions: number
}

function variantLabel(it: { color_name: string | null; size_name: string | null }): string {
  return [it.color_name, it.size_name].filter(Boolean).join(' · ')
}

// Сортировка строк места: сначала «На хранении», потом по процессу, потом по качеству.
const OP_ORDER: Record<string, number> = { storage: 0, packing: 1, packed: 2, ready: 3 }
function rowSort(a: ZoneBalance, b: ZoneBalance): number {
  const o = (OP_ORDER[a.op_status] ?? 9) - (OP_ORDER[b.op_status] ?? 9)
  if (o !== 0) return o
  if (a.quality !== b.quality) return a.quality === 'good' ? -1 : 1
  return (a.location_name ?? '').localeCompare(b.location_name ?? '', 'ru')
}

// Сортировка вариантов внутри артикула: цвет, размер по сетке (sort_order,
// без порядка — после упорядоченных по имени), затем процесс/качество.
function variantSort(a: ZoneBalance, b: ZoneBalance): number {
  const c = (a.color_name ?? '').localeCompare(b.color_name ?? '', 'ru')
  if (c !== 0) return c
  const ao = a.size_sort_order ?? null
  const bo = b.size_sort_order ?? null
  if (ao != null && bo != null && ao !== bo) return ao - bo
  if (ao != null && bo == null) return -1
  if (ao == null && bo != null) return 1
  const s = (a.size_name ?? '').localeCompare(b.size_name ?? '', 'ru')
  if (s !== 0) return s
  return rowSort(a, b)
}

// Группа строк места по артикулу×клиенту: одежда с её цветами/размерами
// сворачивается в одну карточку, «не одежда» остаётся плоской строкой.
type ProductGroup = {
  key: string
  product_name: string
  product_sku: string
  rows: ZoneBalance[]
  total: number
  flat: boolean
}

function groupByProduct(rows: ZoneBalance[]): ProductGroup[] {
  const map = new Map<string, ProductGroup>()
  for (const r of rows) {
    const key = `${r.product_id}__${r.client_id ?? ''}`
    let g = map.get(key)
    if (!g) {
      g = { key, product_name: r.product_name, product_sku: r.product_sku, rows: [], total: 0, flat: false }
      map.set(key, g)
    }
    g.rows.push(r)
    g.total += r.qty
  }
  for (const g of map.values()) {
    g.rows.sort(variantSort)
    // Один вариант (техника: один цвет, без размеров) — плоская строка без разворота.
    g.flat = g.rows.length === 1
  }
  return [...map.values()].sort((a, b) => a.product_name.localeCompare(b.product_name, 'ru'))
}

export function StockScreen() {
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<ZoneBalance[]>([])
  const [zones, setZones] = useState<Zone[]>([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [selected, setSelected] = useState<string | null>(null)
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())
  const [moveFrom, setMoveFrom] = useState<ZoneBalance | null>(null)
  const [qualFrom, setQualFrom] = useState<ZoneBalance | null>(null)
  const [woffFrom, setWoffFrom] = useState<ZoneBalance | null>(null)

  const load = useCallback((q: string, signal?: AbortSignal, silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    return getBalancesByZone({ search: q.trim() || undefined }, signal)
      .then((r) => {
        if (signal?.aborted) return
        setItems(r.items)
        setTruncated(r.truncated)
      })
      .catch((err) => {
        if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить остатки')
      })
      .finally(() => {
        if (!signal?.aborted) setLoading(false)
      })
  }, [])

  // Поиск с задержкой — не дёргаем бэк на каждую букву.
  useEffect(() => {
    const ac = new AbortController()
    const t = setTimeout(() => load(search, ac.signal), 300)
    return () => {
      clearTimeout(t)
      ac.abort()
    }
  }, [search, load])

  useEffect(() => {
    const ac = new AbortController()
    getUnloadingZones(ac.signal)
      .then((z) => setZones(z.filter((x) => x.is_active !== false && !x.is_deleted)))
      .catch(() => {})
    return () => ac.abort()
  }, [])

  // Перезагрузка после перемещения отменяет предыдущий незавершённый reload (M2).
  const reloadAc = useRef<AbortController | null>(null)
  const reload = useCallback(() => {
    reloadAc.current?.abort()
    const ac = new AbortController()
    reloadAc.current = ac
    load(search, ac.signal)
  }, [load, search])
  useEffect(() => () => reloadAc.current?.abort(), [])

  // Pull-to-refresh: тихий reload без полноэкранного спиннера, отдаём промис обёртке.
  const refresh = useCallback(() => {
    reloadAc.current?.abort()
    const ac = new AbortController()
    reloadAc.current = ac
    return load(search, ac.signal, true)
  }, [load, search])

  // Группируем по ИМЕНИ места: безымянные локации (легаси-остаток без места,
  // процессные псевдо-зоны, удалённые зоны) сворачиваем в одну корзину «Без места»,
  // иначе их сотни — список становится бесполезным. Перемещение всё равно идёт по
  // реальному location_id строки, а не по ключу группы.
  const NAMELESS = '∅'
  const places = useMemo(() => {
    const map = new Map<string, Place>()
    for (const it of items) {
      const key = it.location_name ?? NAMELESS
      let p = map.get(key)
      if (!p) {
        p = { key, name: it.location_name ?? 'Без места', rows: [], total: 0, positions: 0 }
        map.set(key, p)
      }
      p.rows.push(it)
      p.total += it.qty
    }
    for (const p of map.values()) {
      p.positions = new Set(p.rows.map((r) => `${balanceKey(r)}__${r.client_id ?? ''}`)).size
      p.rows.sort(rowSort)
    }
    // Названные места — по алфавиту, «Без места» — всегда в конце.
    return [...map.values()].sort((a, b) => {
      if (a.key === NAMELESS) return 1
      if (b.key === NAMELESS) return -1
      return a.name.localeCompare(b.name, 'ru')
    })
  }, [items])

  const selectedPlace = places.find((p) => p.key === selected) ?? null

  // Внутри места артикулы свёрнуты в группы; при активном поиске раскрываем все —
  // найденный вариант не должен прятаться под свёрнутым артикулом.
  const groups = useMemo(
    () => (selectedPlace ? groupByProduct(selectedPlace.rows) : []),
    [selectedPlace],
  )
  const searchActive = search.trim() !== ''
  const isGroupOpen = (key: string) => searchActive || openGroups.has(key)
  const toggleGroup = (key: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Заголовок: список / название места.
  const heading = selectedPlace ? selectedPlace.name : 'Остатки'
  const subheading = selectedPlace
    ? `${selectedPlace.positions} позиц. · ${selectedPlace.total} шт`
    : 'Где лежит товар'

  return (
    <div className="screen">
      <AppBar
        title={heading}
        sub={subheading}
        onBack={selected ? () => setSelected(null) : undefined}
      />

      <PullToRefresh className="scroll pad-nav" onRefresh={refresh}>
        {error && items.length === 0 && (
          <div className="alert">
            <Icon name="alert" size={15} />
            {error}
          </div>
        )}
        {!selectedPlace && (
          <>
            <div className="input search-wrap" style={{ marginBottom: 14 }}>
              <Icon name="search" size={18} />
              <input
                type="search"
                inputMode="search"
                autoCapitalize="none"
                autoCorrect="off"
                placeholder="Поиск по названию или SKU"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {truncated && (
              <div className="alert warn">
                <Icon name="alert" size={15} />
                Показаны не все остатки — уточните поиск.
              </div>
            )}

            {loading ? (
              <div className="center">
                <div className="spin" />
                <div>Загрузка остатков…</div>
              </div>
            ) : items.length === 0 ? (
              <div className="center">
                <div className="center-ico">
                  <Icon name="archive" size={26} />
                </div>
                <div>{search.trim() ? 'Ничего не найдено' : 'Нет остатков'}</div>
              </div>
            ) : (
              <>
                <div className="sec">
                  Места
                  <span className="sec-count">{places.length}</span>
                </div>
                {places.map((p) => (
                  <button key={p.key} className="tile" onClick={() => setSelected(p.key)}>
                    <div className="tile-ico gray">
                      <Icon name="pin" size={20} />
                    </div>
                    <div className="tile-body">
                      <div className="tile-title">{p.name}</div>
                      <div className="tile-meta">
                        {p.positions} {p.positions === 1 ? 'позиция' : 'позиц.'}
                      </div>
                    </div>
                    <span className="tile-qty">
                      {p.total}
                      <span className="u">шт</span>
                    </span>
                    <span className="tile-chev">
                      <Icon name="chev" size={18} />
                    </span>
                  </button>
                ))}
              </>
            )}
          </>
        )}

        {selectedPlace && (
          <>
            <div className="sec">
              Товары
              <span className="sec-count">{groups.length}</span>
            </div>
            {groups.map((g) => {
              const open = isGroupOpen(g.key)
              const renderRows = (rows: ZoneBalance[], hideProduct: boolean) =>
                rows.map((r, i) => (
                  <RowCard
                    key={`${g.key}__${r.location_id ?? '∅'}__${r.color_id ?? ''}__${r.size_id ?? ''}__${r.op_status}__${r.quality}__${i}`}
                    row={r}
                    hideProduct={hideProduct}
                    onMove={() => setMoveFrom(r)}
                    onQuality={() => setQualFrom(r)}
                    onWriteOff={() => setWoffFrom(r)}
                  />
                ))
              if (g.flat) return renderRows(g.rows, false)
              return (
                <div key={g.key}>
                  <button className="tile" onClick={() => toggleGroup(g.key)}>
                    <div className="tile-body">
                      <div className="tile-title">{g.product_name}</div>
                      <div className="tile-meta mono">
                        {g.product_sku} · {g.rows.length} поз.
                      </div>
                    </div>
                    <span className="tile-qty">
                      {g.total}
                      <span className="u">шт</span>
                    </span>
                    <span className="tile-chev" style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }}>
                      <Icon name="chev" size={18} />
                    </span>
                  </button>
                  {open && renderRows(g.rows, true)}
                </div>
              )
            })}
          </>
        )}
      </PullToRefresh>

      {moveFrom && (
        <MoveSheet
          from={moveFrom}
          zones={zones}
          onClose={() => setMoveFrom(null)}
          onDone={(qty) => {
            setMoveFrom(null)
            toast(`Перемещено ${qty} шт`)
            reload()
          }}
        />
      )}

      {qualFrom && (
        <QualitySheet
          from={qualFrom}
          onClose={() => setQualFrom(null)}
          onDone={(qty) => {
            setQualFrom(null)
            toast(`Качество изменено: ${qty} шт`)
            reload()
          }}
        />
      )}

      {woffFrom && (
        <WriteOffSheet
          from={woffFrom}
          onClose={() => setWoffFrom(null)}
          onDone={(qty) => {
            setWoffFrom(null)
            toast(`Списано ${qty} шт`)
            reload()
          }}
        />
      )}
    </div>
  )
}

function RowCard({
  row,
  hideProduct = false,
  onMove,
  onQuality,
  onWriteOff,
}: {
  row: ZoneBalance
  /** Строка внутри группы артикула: имя товара уже в шапке группы — показываем вариант. */
  hideProduct?: boolean
  onMove: () => void
  onQuality: () => void
  onWriteOff: () => void
}) {
  // Место уже в заголовке экрана — в строке показываем товар (или вариант в группе).
  const primary = hideProduct
    ? variantLabel(row) || 'Без цвета и размера'
    : [row.product_name, variantLabel(row)].filter(Boolean).join(' · ')
  // Действия доступны для любого нетерминального статуса с привязкой к месту
  // (бэк требует зону-источник). Вне «На хранении» качество меняется только good → defect.
  const actionable = !!row.location_id && row.qty > 0
  const qualityAllowed = actionable && (row.op_status === 'storage' || row.quality === 'good')
  return (
    <div className="line">
      <div className="line-row" style={{ marginTop: 0, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="line-name">{primary}</div>
          <div className="line-sub mono">{row.product_sku}</div>
          <div className="pills">
            <span className={`pill ${OP_STATUS_TONE[row.op_status]}`}>{OP_STATUS_LABELS[row.op_status]}</span>
            <span className={`pill ${row.quality}`}>{QUALITY_LABELS[row.quality]}</span>
          </div>
        </div>
        <span className="tile-qty">
          {row.qty}
          <span className="u">шт</span>
        </span>
        {actionable && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <button className="icon-btn" onClick={onMove} aria-label="Переместить" title="Переместить">
              <Icon name="arrowRight" size={18} />
            </button>
            <div style={{ display: 'flex', gap: 4 }}>
              {qualityAllowed && (
                <button
                  className="icon-btn"
                  onClick={onQuality}
                  aria-label={row.quality === 'defect' ? 'Перевести в годный' : 'Перевести в брак'}
                  title={row.quality === 'defect' ? 'Перевести в годный' : 'Перевести в брак'}
                >
                  <Icon name="refresh" size={18} />
                </button>
              )}
              <button className="icon-btn" onClick={onWriteOff} aria-label="Списать" title="Списать">
                <Icon name="trash" size={18} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function MoveSheet({
  from,
  zones,
  onClose,
  onDone,
}: {
  from: ZoneBalance
  zones: Zone[]
  onClose: () => void
  onDone: (qty: number) => void
}) {
  const [toZoneId, setToZoneId] = useState('')
  const [qtyStr, setQtyStr] = useState(String(from.qty))
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Один логический перенос на эту шторку — стабильный id переживает повтор при обрыве сети.
  const [requestId] = useState(newRequestId)

  const targetOptions = zones
    .filter((z) => z.id !== from.location_id)
    .map((z) => ({ value: z.id, label: z.name }))
  const variant = variantLabel(from)
  const dirty = toZoneId !== '' || qtyStr !== String(from.qty) || comment !== ''

  async function submit() {
    if (saving) return
    if (!toZoneId) {
      setError('Выберите место назначения')
      return
    }
    const qty = parseInt(qtyStr, 10) || 0
    if (qty < 1 || qty > from.qty) {
      setError(`Укажите количество от 1 до ${from.qty}`)
      return
    }
    setSaving(true)
    setError('')
    try {
      await createRelocation({
        product_id: from.product_id,
        product_name: from.product_name,
        product_sku: from.product_sku,
        color_id: from.color_id,
        color_name: from.color_name,
        size_id: from.size_id,
        size_name: from.size_name,
        client_id: from.client_id,
        client_name: from.client_name,
        op: from.op_status,
        quality: from.quality,
        from_zone_id: from.location_id,
        to_zone_id: toZoneId,
        qty,
        comment: comment.trim() || null,
      }, requestId)
      onDone(qty)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось переместить')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet onClose={onClose} dirty={dirty} locked={saving}>
        <h3>Переместить</h3>
        <div className="line-sub" style={{ marginBottom: 14 }}>
          {variant ? `${from.product_name} · ${variant}` : from.product_name} ·{' '}
          <span className={from.quality === 'defect' ? 'delta under' : ''}>{QUALITY_LABELS[from.quality]}</span>
        </div>

        <div className="summary" style={{ marginBottom: 16 }}>
          <div className="kv">
            <span className="k">Статус</span>
            <span className="v">{OP_STATUS_LABELS[from.op_status]}</span>
          </div>
          <div className="kv">
            <span className="k">Откуда</span>
            <span className="v">{from.location_name ?? 'Без места'}</span>
          </div>
          <div className="kv">
            <span className="k">Доступно</span>
            <span className="v mono">{from.qty} шт</span>
          </div>
        </div>

        {from.op_status !== 'storage' && (
          <div className="alert warn" style={{ marginBottom: 12 }}>
            <Icon name="alert" size={15} />
            Товар привязан к задаче упаковки или отгрузке — меняется только место, статус и резерв сохраняются.
          </div>
        )}

        <div className="field">
          <div className="flabel">
            Куда <span className="req">*</span>
          </div>
          <div className="line-row" style={{ marginTop: 0 }}>
            <ZoneField
              value={toZoneId}
              options={targetOptions}
              placeholder="Место назначения…"
              title="Куда переместить"
              onError={setError}
              allowUnlisted
              validateScan={(loc) =>
                loc.id === from.location_id ? 'Это исходное место — выберите другое' : null
              }
              onChange={setToZoneId}
            />
          </div>
        </div>

        <div className="field">
          <div className="flabel">Сколько</div>
          <div className="line-row" style={{ marginTop: 0 }}>
            <input
              className="input num"
              type="text"
              inputMode="numeric"
              value={qtyStr}
              onChange={(e) => setQtyStr(e.target.value.replace(/\D/g, ''))}
            />
            <button className="btn ghost" style={{ flex: 1 }} onClick={() => setQtyStr(String(from.qty))}>
              Всё ({from.qty})
            </button>
          </div>
        </div>

        <div className="field">
          <div className="flabel">Комментарий (необязательно)</div>
          <input
            className="input"
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Причина перемещения"
          />
        </div>

        {error && (
          <div className="alert" style={{ marginTop: 4 }}>
            <Icon name="alert" size={15} />
            {error}
          </div>
        )}

        <div className="line-row" style={{ marginTop: 4 }}>
          <button className="btn ghost" style={{ flex: 1 }} onClick={onClose}>
            Отмена
          </button>
          <button className="btn" style={{ flex: 2 }} disabled={saving} onClick={() => void submit()}>
            {saving ? <span className="spin spin-sm" /> : 'Переместить'}
          </button>
        </div>
    </Sheet>
  )
}

function QualitySheet({
  from,
  onClose,
  onDone,
}: {
  from: ZoneBalance
  onClose: () => void
  onDone: (qty: number) => void
}) {
  const [qtyStr, setQtyStr] = useState(String(from.qty))
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const toQuality = from.quality === 'defect' ? 'good' : 'defect'
  const variant = variantLabel(from)
  const dirty = qtyStr !== String(from.qty) || comment !== ''
  const qty = parseInt(qtyStr, 10) || 0

  async function submit() {
    if (saving) return
    if (!from.location_id) return
    if (qty < 1 || qty > from.qty) {
      setError(`Укажите количество от 1 до ${from.qty}`)
      return
    }
    setSaving(true)
    setError('')
    try {
      await createQualityChange({
        product_id: from.product_id,
        product_name: from.product_name,
        product_sku: from.product_sku,
        color_id: from.color_id,
        color_name: from.color_name,
        size_id: from.size_id,
        size_name: from.size_name,
        client_id: from.client_id,
        client_name: from.client_name,
        op: from.op_status,
        zone_id: from.location_id,
        from_quality: from.quality,
        to_quality: toQuality,
        qty,
        comment: comment.trim() || null,
      })
      onDone(qty)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось изменить качество')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet onClose={onClose} dirty={dirty} locked={saving}>
        <h3>{toQuality === 'defect' ? 'Перевести в брак' : 'Перевести в годный'}</h3>
        <div className="line-sub" style={{ marginBottom: 14 }}>
          {variant ? `${from.product_name} · ${variant}` : from.product_name}
        </div>

        <div className="summary" style={{ marginBottom: 16 }}>
          <div className="kv">
            <span className="k">Статус</span>
            <span className="v">{OP_STATUS_LABELS[from.op_status]}</span>
          </div>
          <div className="kv">
            <span className="k">Качество</span>
            <span className="v">{QUALITY_LABELS[from.quality]} → {QUALITY_LABELS[toQuality]}</span>
          </div>
          <div className="kv">
            <span className="k">Место</span>
            <span className="v">{from.location_name ?? 'Без места'}</span>
          </div>
          <div className="kv">
            <span className="k">Доступно</span>
            <span className="v mono">{from.qty} шт</span>
          </div>
        </div>

        {from.op_status !== 'storage' && (
          <div className="alert warn" style={{ marginBottom: 12 }}>
            <Icon name="alert" size={15} />
            Товар привязан к задаче упаковки или отгрузке. Брак вернётся «На хранение» в этом же месте — документ уедет без него.
          </div>
        )}

        <div className="field">
          <div className="flabel">Сколько</div>
          <div className="line-row" style={{ marginTop: 0 }}>
            <input
              className="input num"
              type="text"
              inputMode="numeric"
              value={qtyStr}
              onChange={(e) => setQtyStr(e.target.value.replace(/\D/g, ''))}
            />
            <button className="btn ghost" style={{ flex: 1 }} onClick={() => setQtyStr(String(from.qty))}>
              Всё ({from.qty})
            </button>
          </div>
        </div>

        <div className="field">
          <div className="flabel">Комментарий (необязательно)</div>
          <input
            className="input"
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={toQuality === 'good' ? 'Например: брак исправлен' : 'Например: найдено повреждение'}
          />
        </div>

        {error && (
          <div className="alert" style={{ marginTop: 4 }}>
            <Icon name="alert" size={15} />
            {error}
          </div>
        )}

        <div className="line-row" style={{ marginTop: 4 }}>
          <button className="btn ghost" style={{ flex: 1 }} onClick={onClose}>
            Отмена
          </button>
          <button className="btn" style={{ flex: 2 }} disabled={saving} onClick={() => void submit()}>
            {saving ? <span className="spin spin-sm" /> : toQuality === 'defect' ? 'В брак' : 'В годный'}
          </button>
        </div>
    </Sheet>
  )
}

function WriteOffSheet({
  from,
  onClose,
  onDone,
}: {
  from: ZoneBalance
  onClose: () => void
  onDone: (qty: number) => void
}) {
  const [qtyStr, setQtyStr] = useState(String(from.qty))
  const [reason, setReason] = useState<WriteOffReason | ''>('')
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)

  const variant = variantLabel(from)
  const dirty = qtyStr !== String(from.qty) || reason !== '' || comment !== ''
  const qty = parseInt(qtyStr, 10) || 0

  async function submit() {
    if (saving) return
    if (!from.location_id) return
    if (!reason) {
      setError('Укажите причину списания')
      return
    }
    if (reason === 'other' && !comment.trim()) {
      setError('Для причины «Прочее» укажите комментарий')
      return
    }
    if (qty < 1 || qty > from.qty) {
      setError(`Укажите количество от 1 до ${from.qty}`)
      return
    }
    if (!confirming) {
      setError('')
      setConfirming(true)
      return
    }
    setSaving(true)
    setError('')
    try {
      await createWriteOff({
        product_id: from.product_id,
        product_name: from.product_name,
        product_sku: from.product_sku,
        color_id: from.color_id,
        color_name: from.color_name,
        size_id: from.size_id,
        size_name: from.size_name,
        client_id: from.client_id,
        client_name: from.client_name,
        op: from.op_status,
        zone_id: from.location_id,
        quality: from.quality,
        qty,
        reason,
        comment: comment.trim() || null,
      })
      onDone(qty)
    } catch (err) {
      setConfirming(false)
      setError(err instanceof Error ? err.message : 'Не удалось списать')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet onClose={onClose} dirty={dirty} locked={saving}>
        <h3>Списать с остатков</h3>
        <div className="line-sub" style={{ marginBottom: 14 }}>
          {variant ? `${from.product_name} · ${variant}` : from.product_name} ·{' '}
          <span className={from.quality === 'defect' ? 'delta under' : ''}>{QUALITY_LABELS[from.quality]}</span>
        </div>

        <div className="summary" style={{ marginBottom: 16 }}>
          <div className="kv">
            <span className="k">Статус</span>
            <span className="v">{OP_STATUS_LABELS[from.op_status]}</span>
          </div>
          <div className="kv">
            <span className="k">Место</span>
            <span className="v">{from.location_name ?? 'Без места'}</span>
          </div>
          <div className="kv">
            <span className="k">Доступно</span>
            <span className="v mono">{from.qty} шт</span>
          </div>
        </div>

        <div className="alert warn" style={{ marginBottom: 12 }}>
          <Icon name="alert" size={15} />
          Списание безвозвратно — товар исчезнет с остатков.
          {from.op_status !== 'storage' && ' Товар привязан к задаче упаковки или отгрузке — документ уедет без него.'}
        </div>

        <div className="field">
          <div className="flabel">
            Причина <span className="req">*</span>
          </div>
          <select
            className="input"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value as WriteOffReason | '')
              setConfirming(false)
            }}
          >
            <option value="">Выберите причину…</option>
            {Object.entries(WRITEOFF_REASON_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <div className="flabel">Сколько</div>
          <div className="line-row" style={{ marginTop: 0 }}>
            <input
              className="input num"
              type="text"
              inputMode="numeric"
              value={qtyStr}
              onChange={(e) => {
                setQtyStr(e.target.value.replace(/\D/g, ''))
                setConfirming(false)
              }}
            />
            <button
              className="btn ghost"
              style={{ flex: 1 }}
              onClick={() => {
                setQtyStr(String(from.qty))
                setConfirming(false)
              }}
            >
              Всё ({from.qty})
            </button>
          </div>
        </div>

        <div className="field">
          <div className="flabel">Комментарий{reason === 'other' ? ' *' : ' (необязательно)'}</div>
          <input
            className="input"
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Например: повреждено при хранении"
          />
        </div>

        {error && (
          <div className="alert" style={{ marginTop: 4 }}>
            <Icon name="alert" size={15} />
            {error}
          </div>
        )}

        {confirming && (
          <div className="alert warn" style={{ marginTop: 4 }}>
            <Icon name="alert" size={15} />
            Нажмите «Списать» ещё раз для подтверждения: {qty} шт будет списано безвозвратно.
          </div>
        )}

        <div className="line-row" style={{ marginTop: 4 }}>
          <button className="btn ghost" style={{ flex: 1 }} onClick={onClose}>
            Отмена
          </button>
          <button className="btn danger" style={{ flex: 2 }} disabled={saving} onClick={() => void submit()}>
            {saving ? <span className="spin spin-sm" /> : confirming ? 'Списать — подтверждаю' : 'Списать'}
          </button>
        </div>
    </Sheet>
  )
}
