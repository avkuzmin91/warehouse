import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getUnloadingZones, type Zone } from '../api/lookupsApi'
import {
  createRelocation,
  getBalancesByZone,
  OP_STATUS_LABELS,
  QUALITY_LABELS,
  type ZoneBalance,
} from '../api/balancesApi'
import { newRequestId } from '../api/http'
import { balanceKey } from '../utils/balanceKey'
import { AppBar } from '../components/AppBar'
import { Icon } from '../components/Icon'
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

// Сортировка строк места: сначала «На хранении» (перемещаемое), потом по качеству.
const OP_ORDER: Record<string, number> = { storage: 0, packing: 1, ready: 2 }
function rowSort(a: ZoneBalance, b: ZoneBalance): number {
  const o = (OP_ORDER[a.op_status] ?? 9) - (OP_ORDER[b.op_status] ?? 9)
  if (o !== 0) return o
  if (a.quality !== b.quality) return a.quality === 'good' ? -1 : 1
  return (a.location_name ?? '').localeCompare(b.location_name ?? '', 'ru')
}

export function StockScreen() {
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<ZoneBalance[]>([])
  const [zones, setZones] = useState<Zone[]>([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [okMsg, setOkMsg] = useState('')

  const [selected, setSelected] = useState<string | null>(null)
  const [moveFrom, setMoveFrom] = useState<ZoneBalance | null>(null)

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
        {error && (
          <div className="alert">
            <Icon name="alert" size={15} />
            {error}
          </div>
        )}
        {okMsg && (
          <div className="alert ok">
            <Icon name="check" size={15} />
            {okMsg}
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
                onChange={(e) => {
                  setSearch(e.target.value)
                  setOkMsg('')
                }}
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
            <div className="sec">Где лежит</div>
            {selectedPlace.rows.map((r, i) => (
              <RowCard
                key={`${r.location_id ?? '∅'}__${r.op_status}__${r.quality}__${i}`}
                row={r}
                onMove={() => {
                  setOkMsg('')
                  setMoveFrom(r)
                }}
              />
            ))}
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
            setOkMsg(`Перемещено ${qty} шт`)
            reload()
          }}
        />
      )}
    </div>
  )
}

function RowCard({ row, onMove }: { row: ZoneBalance; onMove: () => void }) {
  // Место уже в заголовке экрана — в строке показываем товар.
  const primary = [row.product_name, variantLabel(row)].filter(Boolean).join(' · ')
  // Перемещать можно только товар «На хранении» с привязкой к месту (бэк требует from_zone).
  const movable = row.op_status === 'storage' && !!row.location_id && row.qty > 0
  return (
    <div className="line">
      <div className="line-row" style={{ marginTop: 0, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="line-name">{primary}</div>
          <div className="line-sub mono">{row.product_sku}</div>
          <div className="pills">
            <span className="pill">{OP_STATUS_LABELS[row.op_status]}</span>
            <span className={`pill ${row.quality}`}>{QUALITY_LABELS[row.quality]}</span>
          </div>
        </div>
        <span className="tile-qty">
          {row.qty}
          <span className="u">шт</span>
        </span>
        {movable && (
          <button className="icon-btn" onClick={onMove} aria-label="Переместить" title="Переместить">
            <Icon name="arrowRight" size={18} />
          </button>
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
  const [qty, setQty] = useState(from.qty)
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Один логический перенос на эту шторку — стабильный id переживает повтор при обрыве сети.
  const [requestId] = useState(newRequestId)

  const targetOptions = zones
    .filter((z) => z.id !== from.location_id)
    .map((z) => ({ value: z.id, label: z.name }))
  const variant = variantLabel(from)

  async function submit() {
    if (saving) return
    if (!toZoneId) {
      setError('Выберите место назначения')
      return
    }
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
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <h3>Переместить</h3>
        <div className="line-sub" style={{ marginBottom: 14 }}>
          {variant ? `${from.product_name} · ${variant}` : from.product_name} ·{' '}
          <span className={from.quality === 'defect' ? 'delta under' : ''}>{QUALITY_LABELS[from.quality]}</span>
        </div>

        <div className="summary" style={{ marginBottom: 16 }}>
          <div className="kv">
            <span className="k">Откуда</span>
            <span className="v">{from.location_name ?? 'Без места'}</span>
          </div>
          <div className="kv">
            <span className="k">Доступно</span>
            <span className="v mono">{from.qty} шт</span>
          </div>
        </div>

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
              min={1}
              max={from.qty}
              value={qty}
              onChange={(e) => setQty(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
            />
            <button className="btn ghost" style={{ flex: 1 }} onClick={() => setQty(from.qty)}>
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
            {saving ? '…' : 'Переместить'}
          </button>
        </div>
      </div>
    </div>
  )
}
