import { useEffect, useMemo, useState } from 'react'
import { getPlannableItems } from '../../../../api/balancesApi'
import type { PlannableItem } from '../../../../api/balancesApi'
import { getDispatchReservations } from '../../../../api/dispatchApi'
import type { DispatchCargoType } from '../../../../api/dispatchApi'
import type { ShipmentCargoType } from '../../../../api/shipmentsApi'
import { Drawer } from '../../../feedback/Drawer'
import { EmptyState } from '../../../primitives/EmptyState'
import { Icon } from '../../../primitives/Icon'
import { Tooltip } from '../../../primitives/Tooltip'
import { NumberStep } from './NumberStep'

type Props = {
  clientId: string | null
  cargoType: ShipmentCargoType | DispatchCargoType
  /**
   * `pack` — выбор для «Задачи упаковки»: источник годного «На хранении» (`storage`),
   * товар ещё предстоит упаковать. `dispatch` — выбор для «Отгрузки»: годный отдаётся
   * прежде всего из «Упаковано» (`ready`), поэтому именно упакованное — главная цифра;
   * «на складе»/«в пути» добираются и упаковываются при подготовке (бэкенд это допускает).
   */
  source?: 'pack' | 'dispatch'
  onAdd: (item: PlannableItem, qty: number, zoneId: string | null, zoneName: string | null) => void
  /**
   * Если задан — включается режим массового выбора: отметить несколько позиций
   * с количеством и добавить все разом. Одиночный onAdd при этом не используется.
   */
  onAddMany?: (rows: { item: PlannableItem; qty: number }[]) => void
  onClose: () => void
}

// Годный груз планируется из свободного годного «На хранении» + товара в пути
// (заявлен в поступлении, ещё не приехал). Брак планируется из суммарного брака
// «На хранении» (в пути брак не считаем). Для отгрузки источник — «Готов к отгрузке»
// (ready): главная цифра — это СВОБОДНЫЙ остаток (минус уже обещанное другим
// незакрытым отгрузкам), чтобы совпадать с серверным гейтом.
type PickRow = {
  item: PlannableItem
  ready: number
  /** «На упаковке»: к отгрузке ещё не готово, но передать в подготовку можно (уйдёт в «Ожидание упаковки»). */
  packing: number
  storage: number
  inTransit: number
  /** Уже обещано другим незакрытым отгрузкам — вычитается из главной цифры (только для dispatch). */
  reserved: number
  /** Свободно к отгрузке сейчас: главный источник минус резерв. */
  free: number
  cap: number
}

function rowKey(item: PlannableItem): string {
  return `${item.product_id}|${item.color_id ?? ''}|${item.size_id ?? ''}`
}

function reservationKey(productId: string, colorId: string | null, sizeId: string | null): string {
  return `${productId}|${colorId ?? ''}|${sizeId ?? ''}`
}

export function BalancePicker({ clientId, cargoType, source = 'pack', onAdd, onAddMany, onClose }: Props) {
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<PickRow[]>([])
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<{ row: PickRow; qty: number } | null>(null)
  const [selected, setSelected] = useState<Record<string, { row: PickRow; qty: number }>>({})

  const multi = !!onAddMany
  const isDefect = cargoType === 'defect'
  // Годный без упаковки: источник отгрузки — годный «На хранении», минуя упаковку.
  const isUnpacked = cargoType === 'good_unpacked'
  // Отгрузка вычитает резерв и показывает свободный остаток главной цифрой.
  const isDispatch = source === 'dispatch'
  // Упакованное (ready) — источник отгрузки годного; при упаковке (pack) — склад.
  const dispatchGood = isDispatch && !isDefect && !isUnpacked

  useEffect(() => {
    const ctrl = new AbortController()
    setLoading(true)
    const reservedP = isDispatch
      ? getDispatchReservations({ client_id: clientId || undefined, cargo_type: cargoType }, ctrl.signal)
          .then((r) => r.items)
          .catch(() => [])
      : Promise.resolve([] as Awaited<ReturnType<typeof getDispatchReservations>>['items'])
    Promise.all([
      getPlannableItems({
        limit: 200,
        search: search || undefined,
        client_id: clientId || undefined,
        cargo_type: cargoType,
      }, ctrl.signal),
      reservedP,
    ])
      .then(([res, reservations]) => {
        if (ctrl.signal.aborted) return
        const reservedMap: Record<string, number> = {}
        for (const rv of reservations) {
          reservedMap[reservationKey(rv.product_id, rv.color_id, rv.size_id)] = rv.reserved
        }
        const next = res.items.map((b): PickRow => {
          // «Упаковано» для отгрузки = разложенное «Готов к отгрузке» (ready) + ещё не
          // размещённое на столе упаковки (packed) — оба можно отгрузить.
          const ready = dispatchGood ? b.ready_good + (b.packed_good ?? 0) : 0
          // «На упаковке» (packing_good): к отгрузке ещё не готово, но передать в
          // подготовку можно — уйдёт в «Ожидание упаковки» и продолжится по готовности.
          const packing = dispatchGood ? (b.packing_good ?? 0) : 0
          const storage = isDefect ? b.storage_defect : b.storage_good
          const inTransit = isDefect || isUnpacked ? 0 : b.in_transit
          const primaryRaw = dispatchGood ? ready : storage
          const reserved = isDispatch ? (reservedMap[rowKey(b)] ?? 0) : 0
          const free = Math.max(0, primaryRaw - reserved)
          return { item: b, ready, packing, storage, inTransit, reserved, free, cap: ready + packing + storage + inTransit }
        })
        setRows(next)
      })
      .catch(() => { /* aborted or error */ })
      .finally(() => {
        if (ctrl.signal.aborted) return
        setLoading(false)
      })
    return () => ctrl.abort()
  }, [search, clientId, cargoType, isDefect, isDispatch, dispatchGood])

  // Совпавший с поисковым запросом код (по вхождению) показывается в строке сразу,
  // без наведения — подтверждение «нашлось именно по этому ШК» после сканирования.
  function matchedBarcode(item: PlannableItem): string | null {
    const q = search.trim()
    if (!q) return null
    return (item.barcodes ?? []).find((b) => b.includes(q)) ?? null
  }

  // Главная цифра позиции: для отгрузки — свободный остаток (минус резерв), иначе склад/брак.
  function primaryQty(row: PickRow): number {
    return isDispatch ? row.free : row.storage
  }
  // Валовый остаток источника (до вычета резерва) — для подсказок.
  function grossQty(row: PickRow): number {
    return dispatchGood ? row.ready : row.storage
  }
  const primaryLabel = isDispatch ? 'свободно' : isDefect ? 'брак' : 'на складе'
  const grossLabel = dispatchGood ? 'упаковано' : isDefect ? 'брак' : 'на складе'

  // Хвост подсказки под главной цифрой: из чего складывается остаток (резерв/склад/в пути).
  function secondaryText(row: PickRow): string {
    const parts: string[] = []
    if (isDispatch && row.reserved > 0) parts.push(`${grossLabel} ${grossQty(row)} · в резерве ${row.reserved}`)
    if (dispatchGood && row.storage > 0) parts.push(`склад ${row.storage}`)
    if (!isDefect && row.inTransit > 0) parts.push(`в пути ${row.inTransit}`)
    return parts.join(' · ')
  }

  function defaultQty(row: PickRow): number {
    // По умолчанию подсказываем то, что реально можно передать в подготовку: для отгрузки
    // это готовое + «на упаковке» за вычетом резерва (для брака — свободный брак). Склад/в
    // пути в подсказку не берём — их довозят и упаковывают отдельно, сейчас лишь черновик.
    if (isDispatch) {
      const sendable = dispatchGood ? Math.max(0, row.ready + row.packing - row.reserved) : row.free
      if (sendable > 0) return sendable
      return row.cap > 0 ? row.cap : 1
    }
    const p = primaryQty(row)
    return p > 0 ? p : (row.cap > 0 ? row.cap : 1)
  }

  function toggle(row: PickRow) {
    const k = rowKey(row.item)
    setSelected((prev) => {
      const next = { ...prev }
      if (next[k]) delete next[k]
      else next[k] = { row, qty: defaultQty(row) }
      return next
    })
  }

  function setSelectedQty(k: string, qty: number) {
    setSelected((prev) => prev[k] ? { ...prev, [k]: { ...prev[k], qty: Math.max(1, qty) } } : prev)
  }

  function selectAllVisible() {
    setSelected((prev) => {
      const next = { ...prev }
      for (const row of rows) {
        const k = rowKey(row.item)
        if (!next[k]) next[k] = { row, qty: defaultQty(row) }
      }
      return next
    })
  }

  const selectedList = useMemo(() => Object.values(selected), [selected])
  const selectedCount = selectedList.length
  const selectedSum = selectedList.reduce((s, e) => s + e.qty, 0)

  const cap = pending ? pending.row.cap : 0
  // Свободно к передаче в подготовку прямо сейчас: годный отгружается только из «Готов
  // к отгрузке» (минус резерв); остальное (склад/в пути) можно лишь сохранить черновиком.
  const onStock = pending ? primaryQty(pending.row) : 0
  const overFree = pending ? pending.qty > onStock : false

  return (
    <Drawer open onClose={onClose} width={520} padded={false}>
      <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--c-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Подобрать товар</div>
            <div style={{ fontSize: 12.5, color: 'var(--c-text-subtle)' }}>
              {isDefect ? 'Брак на хранении' : dispatchGood ? 'Свободный к отгрузке остаток (за вычетом резерва)' : isUnpacked ? 'Свободный годный на хранении (за вычетом резерва)' : 'Годный товар на хранении и в пути'}
              {clientId ? ' · по выбранному клиенту' : ''}
            </div>
          </div>
          <button className="btn ghost icon" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        {!pending && (
          <div style={{ position: 'relative' }}>
            <Icon name="search" size={14} style={{ position: 'absolute', left: 10, top: 8, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
            <input
              className="input"
              style={{ paddingLeft: 32 }}
              placeholder="SKU, название, цвет, размер или ШК…"
              value={search}
              autoFocus
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        )}
        {multi && !pending && rows.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
            <button className="btn ghost sm" onClick={selectAllVisible}>
              <Icon name="check" size={12} />Отметить всё ({rows.length})
            </button>
            {selectedCount > 0 && (
              <button className="btn ghost sm" onClick={() => setSelected({})}>Снять отметки</button>
            )}
          </div>
        )}
      </div>

      {pending ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 20, gap: 20 }}>
          <div
            style={{
              padding: '14px 16px', borderRadius: 8,
              border: '1px solid var(--c-accent)', background: 'var(--c-accent-bg)',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600 }}>{pending.row.item.product_name}</div>
            <div className="t-sub mono" style={{ marginTop: 2 }}>
              {pending.row.item.sku_pending && (
                <span style={{ color: 'var(--c-warning)', fontWeight: 600 }}>
                  Без SKU{(pending.row.item.color_name || pending.row.item.size_name) ? ' · ' : ''}
                </span>
              )}
              {[pending.row.item.product_sku, pending.row.item.color_name, pending.row.item.size_name].filter(Boolean).join(' · ')}
            </div>
            {(pending.row.item.barcodes ?? []).length > 0 && (
              <div className="t-sub mono" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="barcode" size={13} style={{ flexShrink: 0 }} />
                <span style={{ overflowWrap: 'anywhere' }}>{pending.row.item.barcodes!.join(' · ')}</span>
              </div>
            )}
            <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--c-text-muted)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <span>
                {isDispatch ? 'Свободно' : isDefect ? 'Брак' : 'На складе'}:{' '}
                <span className="mono" style={{ fontWeight: 600, color: isDefect ? 'var(--c-warning)' : 'var(--c-success)' }}>
                  {primaryQty(pending.row)}
                </span> шт
              </span>
              {isDispatch && pending.row.reserved > 0 && (
                <span>
                  {dispatchGood ? 'Упаковано' : isDefect ? 'Брак' : 'На складе'}:{' '}
                  <span className="mono" style={{ fontWeight: 600, color: 'var(--c-text-subtle)' }}>
                    {grossQty(pending.row)}
                  </span> шт
                  <span style={{ color: 'var(--c-text-subtle)' }}>{' '}· в резерве {pending.row.reserved}</span>
                </span>
              )}
              {dispatchGood && pending.row.storage > 0 && (
                <span>
                  На складе:{' '}
                  <span className="mono" style={{ fontWeight: 600, color: 'var(--c-text-subtle)' }}>
                    {pending.row.storage}
                  </span> шт
                </span>
              )}
              {!isDefect && pending.row.inTransit > 0 && (
                <span>
                  В пути:{' '}
                  <span className="mono" style={{ fontWeight: 600, color: 'var(--c-text-subtle)' }}>
                    {pending.row.inTransit}
                  </span> шт
                </span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label className="field-label"><span>{isDispatch ? 'План отгрузки' : 'План упаковки'}</span></label>
              <NumberStep
                value={pending.qty}
                onChange={(v) => setPending((p) => p && { ...p, qty: v })}
                min={0}
                warning={pending.qty > cap}
                width={160}
                height={30}
              />
              {pending.qty > cap ? (
                <div style={{ fontSize: 12, color: 'var(--c-warning)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Icon name="alert" size={12} />Превышает доступное ({cap} шт)
                </div>
              ) : overFree && isDispatch ? (
                <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Icon name="clock" size={12} />Сверх свободного остатка ({onStock} шт): часть в резерве, на складе или в пути — сейчас можно сохранить черновик
                </div>
              ) : overFree ? (
                <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Icon name="clock" size={12} />Часть из товара в пути — отгрузку можно запланировать после прихода
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {loading ? (
            <div style={{ color: 'var(--c-text-muted)', fontSize: 13, padding: 12 }}>Загрузка…</div>
          ) : rows.length === 0 ? (
            <EmptyState title="Ничего не найдено" sub={isDefect ? 'Нет брака на хранении по запросу' : isUnpacked ? 'Нет годного товара на хранении по запросу' : 'Нет остатков и товара в пути по запросу'} />
          ) : (
            rows.map((row, i) => {
              const k = rowKey(row.item)
              const checked = !!selected[k]
              const secondary = secondaryText(row)
              return (
                <div
                  key={`${k}__${i}`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                    borderRadius: 8, border: `1px solid ${checked ? 'var(--c-accent)' : 'var(--c-border)'}`,
                    background: checked ? 'var(--c-accent-bg)' : undefined,
                    cursor: 'pointer',
                  }}
                  onClick={() => multi ? toggle(row) : setPending({ row, qty: 0 })}
                >
                  {multi && (
                    <span className={`t-checkbox ${checked ? 'checked' : ''}`} style={{ flexShrink: 0 }}>
                      {checked && <Icon name="check" size={10} />}
                    </span>
                  )}
                  <div style={{ width: 34, height: 34, borderRadius: 6, background: 'var(--c-bg-sunken)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon name="box" size={14} style={{ color: 'var(--c-text-muted)' }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{row.item.product_name}</div>
                    <div className="t-sub mono">
                      {row.item.sku_pending && (
                        <span style={{ color: 'var(--c-warning)', fontWeight: 600 }}>
                          Без SKU{(row.item.color_name || row.item.size_name) ? ' · ' : ''}
                        </span>
                      )}
                      {[row.item.product_sku, row.item.color_name, row.item.size_name].filter(Boolean).join(' · ')}
                      <BarcodeChip barcodes={row.item.barcodes ?? []} matched={matchedBarcode(row.item)} />
                    </div>
                  </div>
                  {multi && checked ? (
                    <div onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                      <NumberStep
                        value={selected[k].qty}
                        onChange={(v) => setSelectedQty(k, v)}
                        warning={selected[k].qty > row.cap}
                        width={104}
                      />
                      <div className="t-sub" style={{ textAlign: 'right', marginTop: 2, whiteSpace: 'nowrap' }}>
                        {primaryLabel} {primaryQty(row)}{secondary ? ` · ${secondary}` : ''}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div className="mono" style={{ color: isDefect ? 'var(--c-warning)' : 'var(--c-success)', fontWeight: 500, fontSize: 13 }}>
                          {primaryQty(row)}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>
                          {primaryLabel}
                        </div>
                        {secondary && (
                          <div style={{ fontSize: 11, color: 'var(--c-text-subtle)', marginTop: 1 }}>
                            {secondary}
                          </div>
                        )}
                      </div>
                      {!multi && <Icon name="plus" size={14} style={{ color: 'var(--c-accent)', flexShrink: 0 }} />}
                    </>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}

      <div style={{ padding: '12px 20px', borderTop: '1px solid var(--c-border)', display: 'flex', gap: 8 }}>
        {pending ? (
          <>
            <button className="btn" style={{ flex: 1 }} onClick={() => setPending(null)}>Назад</button>
            <button
              className="btn primary"
              style={{ flex: 1 }}
              disabled={pending.qty <= 0 || pending.qty > cap}
              onClick={() => onAdd(
                pending.row.item,
                pending.qty,
                null,
                null,
              )}
            >
              <Icon name="plus" size={13} />Добавить
            </button>
          </>
        ) : multi ? (
          <>
            <button className="btn" style={{ flex: 1 }} onClick={onClose}>Отмена</button>
            <button
              className="btn primary"
              style={{ flex: 2 }}
              disabled={selectedCount === 0}
              onClick={() => { onAddMany!(selectedList.map((e) => ({ item: e.row.item, qty: e.qty }))); onClose() }}
            >
              <Icon name="plus" size={13} />
              Добавить отмеченные{selectedCount > 0 ? ` · ${selectedCount} · ${selectedSum} шт` : ''}
            </button>
          </>
        ) : (
          <button className="btn" style={{ width: '100%' }} onClick={onClose}>Готово</button>
        )}
      </div>
    </Drawer>
  )
}

function BarcodeChip({ barcodes, matched }: { barcodes: string[]; matched: string | null }) {
  if (barcodes.length === 0) return null
  if (matched) {
    return (
      <span style={{ marginLeft: 6, display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--c-accent-bg)', color: 'var(--c-accent)', borderRadius: 4, padding: '1px 6px', fontSize: 11.5, fontWeight: 500, verticalAlign: 'text-bottom' }}>
        <Icon name="barcode" size={13} />{matched}
      </span>
    )
  }
  return (
    <Tooltip content={barcodes.join(' · ')} maxWidth={280}>
      <span style={{ marginLeft: 6, display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--c-bg-sunken)', borderRadius: 4, padding: '1px 6px', fontSize: 11, fontWeight: 500, color: 'var(--c-text-subtle)', verticalAlign: 'text-bottom', cursor: 'default' }}>
        <Icon name="barcode" size={13} />ШК{barcodes.length > 1 ? ` ${barcodes.length}` : ''}
      </span>
    </Tooltip>
  )
}
