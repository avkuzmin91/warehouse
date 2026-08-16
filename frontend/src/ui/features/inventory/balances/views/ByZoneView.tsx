import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  getBalancesByZone,
  getBalancesSummary,
  createZoneRelocation,
  createZoneRelocationsBulk,
  createQualityChange,
  createWriteOff,
  INV_OP_LABELS,
  INV_QUALITY_LABELS,
  WRITEOFF_REASON_LABELS,
} from '../../../../../api/balancesApi'
import type { BalanceSummary, BalanceZoneItem, InvOpStatus, InvQuality, WriteOffReason } from '../../../../../api/balancesApi'
import { useLookups } from '../../../../../hooks/useLookups'
import { useFilterParam, useFilterParamsActions, usePageParam } from '../../../../../hooks/useFilterParams'
import { Table, Td } from '../../../../data/Table'
import { Combobox } from '../../../../data/Combobox'
import { FiltersBar, FilterCombobox, FilterSelect } from '../../../../data/FiltersBar'
import { Pagination } from '../../../../data/Pagination'
import { useConfirm } from '../../../../feedback/ConfirmDialog'
import { Drawer } from '../../../../feedback/Drawer'
import { useToast } from '../../../../feedback/Toast'
import { Card, CardHead } from '../../../../primitives/Card'
import { KPI } from '../../../../primitives/KPI'
import { Icon } from '../../../../primitives/Icon'
import { Badge } from '../../../../primitives/Badge'
import type { BadgeTone } from '../../../../primitives/Badge'
import { SkeletonRows } from '../../../../primitives/Skeleton'
import { EmptyState } from '../../../../primitives/EmptyState'
import { NumberStep } from '../../shared/NumberStep'
import { ProductLink } from '../../../shared/ProductLink'

type LocationGroup = {
  locationId: string | null
  locationName: string
  items: BalanceZoneItem[]
  totalQty: number
}

// Страница списка остатков по местам = N местоположений (со всеми их строками).
const ZONE_PAGE_SIZE = 25

const OP_TONE: Record<InvOpStatus, BadgeTone> = {
  storage: 'accent',
  packing: 'info',
  packed:  'info',
  ready:   'success',
}

const QUALITY_TONE: Record<InvQuality, BadgeTone> = {
  good:   'success',
  defect: 'warning',
}

export function ByZoneView() {
  const [items, setItems] = useState<BalanceZoneItem[]>([])
  const [summary, setSummary] = useState<BalanceSummary | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = usePageParam()
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useFilterParam('search', '')
  const [place, setPlace] = useFilterParam('place', '')
  const [clientId, setClientId] = useFilterParam('client', '')
  const [opFilter, setOpFilter] = useFilterParam('op', '')
  const [qualityFilter, setQualityFilter] = useFilterParam('quality', '')
  const { clients, unloadingZones } = useLookups()
  const { setMany } = useFilterParamsActions()
  const toast = useToast()

  // Массовая консолидация: отмеченные строки «На хранении» → одно место. Ключ —
  // бакет×место; выбор переживает смену страницы/фильтров (собрать с разных страниц).
  const [selected, setSelected] = useState<Record<string, { item: BalanceZoneItem; qty: number }>>({})
  const [bulkToZoneId, setBulkToZoneId] = useState('')
  const [bulkComment, setBulkComment] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)

  // Перемещение между местоположениями: любой нетерминальный статус — товар можно
  // временно переставить, даже когда он на упаковке или готов к отгрузке.
  const [reloc, setReloc] = useState<BalanceZoneItem | null>(null)
  const [toZoneId, setToZoneId] = useState('')
  const [relocQty, setRelocQty] = useState(0)
  const [relocComment, setRelocComment] = useState('')
  const [relocSaving, setRelocSaving] = useState(false)
  const [relocError, setRelocError] = useState('')

  // Смена качества в пределах места: «На хранении» — обе стороны, вне хранения —
  // только годный → брак (товар выбывает из процесса и возвращается на хранение).
  const [qual, setQual] = useState<BalanceZoneItem | null>(null)
  const [qualQty, setQualQty] = useState(0)
  const [qualComment, setQualComment] = useState('')
  const [qualSaving, setQualSaving] = useState(false)
  const [qualError, setQualError] = useState('')

  // Списание с остатков (терминальное): из любого нетерминального статуса.
  const confirm = useConfirm()
  const [woff, setWoff] = useState<BalanceZoneItem | null>(null)
  const [woffQty, setWoffQty] = useState(0)
  const [woffReason, setWoffReason] = useState<WriteOffReason | ''>('')
  const [woffComment, setWoffComment] = useState('')
  const [woffSaving, setWoffSaving] = useState(false)
  const [woffError, setWoffError] = useState('')

  const activeZones = useMemo(
    () => unloadingZones.filter((z) => z.is_active && !z.is_deleted),
    [unloadingZones],
  )

  // ── массовая консолидация ──────────────────────────────────────────────────
  function bulkKey(item: BalanceZoneItem): string {
    return [item.product_id, item.color_id, item.size_id, item.client_id, item.location_id, item.op_status, item.quality].join('|')
  }
  function bulkSelectable(item: BalanceZoneItem): boolean {
    return !!item.location_id && item.qty > 0
  }
  function toggleBulk(item: BalanceZoneItem) {
    const key = bulkKey(item)
    setSelected((prev) => {
      if (prev[key]) {
        const next = { ...prev }
        delete next[key]
        return next
      }
      return { ...prev, [key]: { item, qty: item.qty } }
    })
  }
  function setBulkQty(key: string, qty: number) {
    setSelected((prev) => (prev[key] ? { ...prev, [key]: { ...prev[key], qty } } : prev))
  }
  function toggleBulkGroup(group: LocationGroup) {
    const rows = group.items.filter(bulkSelectable)
    const allIn = rows.length > 0 && rows.every((i) => selected[bulkKey(i)])
    setSelected((prev) => {
      const next = { ...prev }
      for (const i of rows) {
        if (allIn) delete next[bulkKey(i)]
        else next[bulkKey(i)] = next[bulkKey(i)] ?? { item: i, qty: i.qty }
      }
      return next
    })
  }

  const selectedList = Object.entries(selected)
  const selectedCount = selectedList.length
  const selectedSum = selectedList.reduce((s, [, e]) => s + (e.qty > 0 ? e.qty : 0), 0)
  // Строки, уже лежащие в целевом месте, в перемещение не попадают.
  const bulkMovable = selectedList.filter(([, e]) => e.item.location_id !== bulkToZoneId)
  const bulkSkipped = selectedCount - bulkMovable.length
  const bulkInvalid = selectedList.some(([, e]) => e.qty <= 0 || e.qty > e.item.qty)
  // Товар вне «На хранении» привязан к документу: переезд корректен, но может
  // разойтись с уже собранным набором подготовки — предупреждаем.
  const bulkReservedCount = bulkMovable.filter(([, e]) => e.item.op_status !== 'storage').length

  async function submitBulk() {
    if (!bulkToZoneId) { toast('Выберите место назначения', 'error'); return }
    if (bulkInvalid) { toast('Проверьте количества: от 1 до остатка строки', 'error'); return }
    const movable = bulkMovable
    if (movable.length === 0) { toast('Все отмеченные позиции уже в этом месте', 'error'); return }
    const zoneName = activeZones.find((z) => z.id === bulkToZoneId)?.name ?? bulkToZoneId
    const sum = movable.reduce((s, [, e]) => s + e.qty, 0)
    const ok = await confirm({
      title: 'Переместить отмеченное?',
      body: `${movable.length} поз. · ${sum} шт будут перемещены в «${zoneName}»${bulkSkipped > 0 ? `. Ещё ${bulkSkipped} поз. уже там — будут пропущены` : ''}.`,
      confirmLabel: 'Переместить',
    })
    if (!ok) return
    setBulkSaving(true)
    try {
      const res = await createZoneRelocationsBulk({
        to_zone_id: bulkToZoneId,
        comment: bulkComment.trim() || null,
        items: movable.map(([, e]) => ({
          product_id:   e.item.product_id,
          product_name: e.item.product_name,
          product_sku:  e.item.product_sku,
          color_id:     e.item.color_id,
          color_name:   e.item.color_name,
          size_id:      e.item.size_id,
          size_name:    e.item.size_name,
          client_id:    e.item.client_id,
          client_name:  e.item.client_name,
          op:           e.item.op_status,
          quality:      e.item.quality,
          from_zone_id: e.item.location_id!,
          qty:          e.qty,
        })),
      })
      toast(`Перемещено: ${res.moved} шт`, 'success')
      setSelected({})
      setBulkToZoneId('')
      setBulkComment('')
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка перемещения', 'error')
    } finally {
      setBulkSaving(false)
    }
  }

  function openReloc(item: BalanceZoneItem) {
    setReloc(item)
    setToZoneId('')
    setRelocQty(0)
    setRelocComment('')
    setRelocError('')
  }

  function openQual(item: BalanceZoneItem) {
    setQual(item)
    setQualQty(0)
    setQualComment('')
    setQualError('')
  }

  function openWoff(item: BalanceZoneItem) {
    setWoff(item)
    setWoffQty(0)
    setWoffReason('')
    setWoffComment('')
    setWoffError('')
  }

  async function submitReloc() {
    if (!reloc) return
    setRelocError('')
    if (!toZoneId) { setRelocError('Выберите местоположение назначения'); return }
    setRelocSaving(true)
    try {
      await createZoneRelocation({
        product_id:   reloc.product_id,
        product_name: reloc.product_name,
        product_sku:  reloc.product_sku,
        color_id:     reloc.color_id,
        color_name:   reloc.color_name,
        size_id:      reloc.size_id,
        size_name:    reloc.size_name,
        client_id:    reloc.client_id,
        client_name:  reloc.client_name,
        op:           reloc.op_status,
        quality:      reloc.quality,
        from_zone_id: reloc.location_id,
        to_zone_id:   toZoneId,
        qty:          relocQty,
        comment:      relocComment.trim() || null,
      })
      toast('Товар перемещён', 'success')
      setReloc(null)
      await load()
    } catch (e) {
      setRelocError(e instanceof Error ? e.message : 'Ошибка перемещения')
    } finally {
      setRelocSaving(false)
    }
  }

  async function submitQual() {
    if (!qual || !qual.location_id) return
    setQualError('')
    setQualSaving(true)
    try {
      await createQualityChange({
        product_id:   qual.product_id,
        product_name: qual.product_name,
        product_sku:  qual.product_sku,
        color_id:     qual.color_id,
        color_name:   qual.color_name,
        size_id:      qual.size_id,
        size_name:    qual.size_name,
        client_id:    qual.client_id,
        client_name:  qual.client_name,
        op:           qual.op_status,
        zone_id:      qual.location_id,
        from_quality: qual.quality,
        to_quality:   qual.quality === 'defect' ? 'good' : 'defect',
        qty:          qualQty,
        comment:      qualComment.trim() || null,
      })
      toast('Качество товара изменено', 'success')
      setQual(null)
      await load()
    } catch (e) {
      setQualError(e instanceof Error ? e.message : 'Ошибка смены качества')
    } finally {
      setQualSaving(false)
    }
  }

  async function submitWoff() {
    if (!woff || !woff.location_id) return
    setWoffError('')
    if (!woffReason) { setWoffError('Укажите причину списания'); return }
    if (woffReason === 'other' && !woffComment.trim()) { setWoffError('Для причины «Прочее» укажите комментарий'); return }
    const ok = await confirm({
      title: 'Списать товар с остатков?',
      body: `${woff.product_name} — ${woffQty} шт будет списано безвозвратно. Причина: ${WRITEOFF_REASON_LABELS[woffReason]}.`,
      danger: true,
      confirmLabel: 'Списать',
    })
    if (!ok) return
    setWoffSaving(true)
    try {
      await createWriteOff({
        product_id:   woff.product_id,
        product_name: woff.product_name,
        product_sku:  woff.product_sku,
        color_id:     woff.color_id,
        color_name:   woff.color_name,
        size_id:      woff.size_id,
        size_name:    woff.size_name,
        client_id:    woff.client_id,
        client_name:  woff.client_name,
        op:           woff.op_status,
        zone_id:      woff.location_id,
        quality:      woff.quality,
        qty:          woffQty,
        reason:       woffReason,
        comment:      woffComment.trim() || null,
      })
      toast('Товар списан с остатков', 'success')
      setWoff(null)
      await load()
    } catch (e) {
      setWoffError(e instanceof Error ? e.message : 'Ошибка списания')
    } finally {
      setWoffSaving(false)
    }
  }

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    try {
      const [res, sum] = await Promise.all([
        getBalancesByZone({
          search: search || undefined,
          client_id: clientId || undefined,
          location: place || undefined,
          op_status: (opFilter || undefined) as InvOpStatus | undefined,
          quality: (qualityFilter || undefined) as InvQuality | undefined,
          page,
          limit: ZONE_PAGE_SIZE,
        }, signal),
        getBalancesSummary({
          search: search || undefined,
          client_id: clientId || undefined,
        }, signal),
      ])
      if (signal?.aborted) return
      setItems(res.items)
      setTotal(res.total)
      setSummary(sum)
    } catch (e) {
      if (signal?.aborted) return
      throw e
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [search, clientId, place, opFilter, qualityFilter, page])

  // Debounce поиска: отмена предыдущего запроса + пауза перед новым при вводе текста
  useEffect(() => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => void load(ctrl.signal), search || place ? 250 : 0)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [load, search, place])

  const groups = useMemo<LocationGroup[]>(() => {
    const map = new Map<string, LocationGroup>()
    for (const item of items) {
      const key = item.location_id ?? '__none__'
      let group = map.get(key)
      if (!group) {
        group = {
          locationId: item.location_id,
          locationName: item.location_name ?? 'Без места',
          items: [],
          totalQty: 0,
        }
        map.set(key, group)
      }
      group.items.push(item)
      group.totalQty += item.qty
    }
    return [...map.values()]
  }, [items])

  // Итоги — из /balances/summary (не зависят от усечения списка);
  // фильтры статуса/качества применяются выбором корзин.
  const kpi = useMemo(() => {
    const useGood = qualityFilter !== 'defect'
    const useDefect = qualityFilter !== 'good'
    const opOn = (op: InvOpStatus) => !opFilter || opFilter === op
    const bucket = (op: InvOpStatus, good: number, defect: number) =>
      opOn(op) ? (useGood ? good : 0) + (useDefect ? defect : 0) : 0
    const s = summary
    const storageQty = s ? bucket('storage', s.storage_good, s.storage_defect) : 0
    const packingQty = s ? bucket('packing', s.packing_good, s.packing_defect) : 0
    const packedQty = s ? bucket('packed', s.packed_good, s.packed_defect) : 0
    const readyQty = s ? bucket('ready', s.ready_good, s.ready_defect) : 0
    const defectQty = s ? bucket('storage', 0, s.storage_defect) + bucket('packing', 0, s.packing_defect) + bucket('packed', 0, s.packed_defect) + bucket('ready', 0, s.ready_defect) : 0
    return {
      totalQty: storageQty + packingQty + packedQty + readyQty,
      storageQty, packingQty, packedQty, readyQty, defectQty,
    }
  }, [summary, opFilter, qualityFilter])

  const kpiVal = (n: number) => (summary ? n.toLocaleString('ru-RU') : '—')
  const changeSearch = (v: string) => setSearch(v)
  const changePlace = (v: string) => setPlace(v)
  const changeClient = (v: string) => setClientId(v)
  const changeOp = (v: string) => setOpFilter(v)
  const changeQuality = (v: string) => setQualityFilter(v)
  const toggleOp = (op: InvOpStatus) => setOpFilter(opFilter === op ? '' : op)
  const resetFilters = () => setMany({ client: null, op: null, quality: null, place: null, search: null })

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <FiltersBar>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Icon name="search" size={13} style={{ position: 'absolute', left: 9, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
            <input
              className="input sm"
              style={{ paddingLeft: 28, width: 220, paddingRight: search ? 26 : undefined }}
              placeholder="Товар, SKU или ШК…"
              value={search}
              onChange={(e) => changeSearch(e.target.value)}
            />
            {search && (
              <button
                style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'var(--c-text-subtle)' }}
                onClick={() => changeSearch('')}
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </div>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Icon name="boxes" size={13} style={{ position: 'absolute', left: 9, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
            <input
              className="input sm"
              style={{ paddingLeft: 28, width: 170, paddingRight: place ? 26 : undefined }}
              placeholder="Место, ячейка…"
              value={place}
              onChange={(e) => changePlace(e.target.value)}
            />
            {place && (
              <button
                style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'var(--c-text-subtle)' }}
                onClick={() => changePlace('')}
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </div>
          <FilterCombobox
            label="Клиент"
            value={clientId}
            options={[{ value: '', label: 'Все клиенты' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
            onChange={(v) => changeClient(v)}
            placeholder="Поиск клиента…"
          />
          <FilterSelect
            label="Статус"
            value={opFilter}
            options={[
              { value: '', label: 'Все статусы' },
              { value: 'storage', label: INV_OP_LABELS.storage },
              { value: 'packing', label: INV_OP_LABELS.packing },
              { value: 'packed', label: INV_OP_LABELS.packed },
              { value: 'ready', label: INV_OP_LABELS.ready },
            ]}
            onChange={changeOp}
          />
          <FilterSelect
            label="Качество"
            value={qualityFilter}
            options={[
              { value: '', label: 'Любое качество' },
              { value: 'good', label: INV_QUALITY_LABELS.good },
              { value: 'defect', label: INV_QUALITY_LABELS.defect },
            ]}
            onChange={changeQuality}
          />
          {(clientId || opFilter || qualityFilter || place || search) && (
            <button className="btn ghost sm" onClick={resetFilters}>
              <Icon name="x" size={12} />Сбросить
            </button>
          )}
          <button
            className="btn ghost sm icon"
            title="Обновить"
            onClick={() => load()}
          >
            <Icon name="refresh" size={14} style={loading ? { animation: 'spin 0.7s linear infinite' } : undefined} />
          </button>
        </FiltersBar>
      </div>

      <div className="kpi-grid" style={{ marginBottom: 20, gridTemplateColumns: 'repeat(6, 1fr)' }}>
        <KPI label="Всего единиц" value={kpiVal(kpi.totalQty)} unit="шт" />
        <KPI
          label={INV_OP_LABELS.storage}
          value={kpiVal(kpi.storageQty)}
          valueColor="var(--c-accent)"
          unit="шт"
          active={opFilter === 'storage'}
          onClick={() => toggleOp('storage')}
        />
        <KPI
          label={INV_OP_LABELS.packing}
          value={kpiVal(kpi.packingQty)}
          valueColor="var(--c-info)"
          unit="шт"
          active={opFilter === 'packing'}
          onClick={() => toggleOp('packing')}
        />
        <KPI
          label={INV_OP_LABELS.packed}
          value={kpiVal(kpi.packedQty)}
          valueColor="var(--c-info)"
          unit="шт"
          active={opFilter === 'packed'}
          onClick={() => toggleOp('packed')}
        />
        <KPI
          label={INV_OP_LABELS.ready}
          value={kpiVal(kpi.readyQty)}
          valueColor="var(--c-success)"
          unit="шт"
          active={opFilter === 'ready'}
          onClick={() => toggleOp('ready')}
        />
        <KPI
          label="Брак (из них)"
          value={kpiVal(kpi.defectQty)}
          valueColor="var(--c-warning)"
          unit="шт"
          active={qualityFilter === 'defect'}
          onClick={() => changeQuality(qualityFilter === 'defect' ? '' : 'defect')}
        />
      </div>

      {loading ? (
        <Table>
          <tbody><SkeletonRows rows={8} cols={5} /></tbody>
        </Table>
      ) : groups.length === 0 ? (
        <EmptyState title="Остатков нет" sub="Данные появятся после завершения поступлений с указанным местоположением" />
      ) : (
        <div className="col gap-16">
          {groups.map((group) => (
            <Card key={group.locationId ?? '__none__'}>
              <CardHead>
                {group.items.some(bulkSelectable) && (() => {
                  const rows = group.items.filter(bulkSelectable)
                  const allIn = rows.every((i) => selected[bulkKey(i)])
                  return (
                    <span
                      className={`t-checkbox ${allIn ? 'checked' : ''}`}
                      style={{ flexShrink: 0, cursor: 'pointer', marginRight: 2 }}
                      title={allIn ? 'Снять отметки с ячейки' : 'Отметить всю ячейку'}
                      onClick={() => toggleBulkGroup(group)}
                    >
                      {allIn && <Icon name="check" size={10} />}
                    </span>
                  )
                })()}
                <Icon name="boxes" size={15} className="ic-accent" />
                <span className="card-head-title">{group.locationName}</span>
                <Badge tone="accent" style={{ marginLeft: 6 }}>{group.items.length}</Badge>
                <div className="flex-1" />
                <span className="t-sub mono">{group.totalQty.toLocaleString('ru-RU')} шт</span>
              </CardHead>
              <Table>
                <thead>
                  <tr>
                    <th style={{ width: 34 }} />
                    <th>Товар</th>
                    <th>Клиент</th>
                    <th style={{ width: 150 }}>Статус</th>
                    <th style={{ width: 100 }}>Качество</th>
                    <th style={{ textAlign: 'right', width: 110 }}>Количество</th>
                    <th style={{ width: 108 }} />
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((item, i) => {
                    const key = bulkKey(item)
                    const entry = bulkSelectable(item) ? selected[key] : undefined
                    return (
                    <tr key={`${item.product_id}-${item.color_id}-${item.size_id}-${item.op_status}-${item.quality}-${i}`}>
                      <Td>
                        {bulkSelectable(item) && (
                          <span
                            className={`t-checkbox ${entry ? 'checked' : ''}`}
                            style={{ cursor: 'pointer' }}
                            title="Отметить для массового перемещения"
                            onClick={() => toggleBulk(item)}
                          >
                            {entry && <Icon name="check" size={10} />}
                          </span>
                        )}
                      </Td>
                      <Td>
                        <div style={{ fontWeight: 500 }}>
                          <ProductLink productId={item.product_id}>{item.product_name}</ProductLink>
                        </div>
                        <div className="t-sub mono">
                          {[item.product_sku, item.color_name, item.size_name].filter(Boolean).join(' · ')}
                        </div>
                      </Td>
                      <Td style={{ color: 'var(--c-text-muted)', fontSize: 13 }}>
                        {item.client_name ?? '—'}
                      </Td>
                      <Td>
                        <Badge tone={OP_TONE[item.op_status]}>{INV_OP_LABELS[item.op_status]}</Badge>
                      </Td>
                      <Td>
                        <Badge tone={QUALITY_TONE[item.quality]}>{INV_QUALITY_LABELS[item.quality]}</Badge>
                      </Td>
                      <Td className="num" style={{ fontWeight: 600 }}>
                        {entry ? (
                          <input
                            className="input sm num"
                            inputMode="numeric"
                            value={entry.qty === 0 ? '' : String(entry.qty)}
                            onChange={(e) => {
                              const raw = e.target.value.replace(/\D/g, '')
                              setBulkQty(key, raw === '' ? 0 : Math.max(0, parseInt(raw, 10)))
                            }}
                            style={{
                              width: 76, textAlign: 'right',
                              borderColor: entry.qty <= 0 || entry.qty > item.qty ? 'var(--c-warning)' : undefined,
                              color: entry.qty <= 0 || entry.qty > item.qty ? 'var(--c-warning)' : undefined,
                            }}
                            title={`Остаток ${item.qty.toLocaleString('ru-RU')} шт`}
                          />
                        ) : (
                          item.qty.toLocaleString('ru-RU')
                        )}
                      </Td>
                      <Td>
                        <div style={{ display: 'flex', gap: 2 }}>
                          <button
                            className="btn ghost icon sm"
                            title="Переместить в другое местоположение"
                            onClick={() => openReloc(item)}
                          >
                            <Icon name="arrowRight" size={14} />
                          </button>
                          {item.location_id && (item.op_status === 'storage' || item.quality === 'good') && (
                            <button
                              className="btn ghost icon sm"
                              title={item.quality === 'defect' ? 'Перевести в годный' : 'Перевести в брак'}
                              onClick={() => openQual(item)}
                            >
                              <Icon name="refresh" size={14} />
                            </button>
                          )}
                          {item.location_id && (
                            <button
                              className="btn ghost icon sm"
                              title="Списать с остатков"
                              onClick={() => openWoff(item)}
                            >
                              <Icon name="trash" size={14} />
                            </button>
                          )}
                        </div>
                      </Td>
                    </tr>
                    )
                  })}
                </tbody>
              </Table>
            </Card>
          ))}
        </div>
      )}

      {!loading && total > ZONE_PAGE_SIZE && (
        <div style={{ marginTop: 16 }}>
          <Pagination page={page} pageSize={ZONE_PAGE_SIZE} total={total} onPage={setPage} />
        </div>
      )}

      {selectedCount > 0 && (
        <div style={{
          position: 'sticky', bottom: 12, marginTop: 16, zIndex: 5,
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          padding: '10px 14px', borderRadius: 'var(--r-lg)',
          border: '1px solid var(--c-accent)', background: 'var(--c-bg-elev)', boxShadow: 'var(--sh-1)',
        }}>
          <span style={{ fontSize: 13 }}>
            Отмечено <b className="num">{selectedCount}</b> · <b className="num">{selectedSum.toLocaleString('ru-RU')}</b> шт
          </span>
          <button className="btn ghost sm" disabled={bulkSaving} onClick={() => setSelected({})}>
            Снять отметки
          </button>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input
              className="input sm"
              placeholder="Комментарий (необязательно)"
              value={bulkComment}
              disabled={bulkSaving}
              onChange={(e) => setBulkComment(e.target.value)}
              style={{ width: 200 }}
            />
            <Icon name="arrowRight" size={14} style={{ color: 'var(--c-text-subtle)' }} />
            <div style={{ width: 220 }}>
              <Combobox
                value={bulkToZoneId || null}
                placeholder="Куда переместить"
                options={activeZones.map((z) => ({ value: z.id, label: z.name }))}
                onChange={(v) => setBulkToZoneId(String(v ?? ''))}
                disabled={bulkSaving}
                clearable
              />
            </div>
            <button className="btn primary sm" disabled={bulkSaving} onClick={() => void submitBulk()}>
              <Icon name="check" size={13} />Переместить
            </button>
          </div>
          {bulkToZoneId && bulkSkipped > 0 && (
            <span style={{ fontSize: 12, color: 'var(--c-text-subtle)', width: '100%' }}>
              {bulkSkipped} поз. уже в этом месте — будут пропущены
            </span>
          )}
          {bulkReservedCount > 0 && (
            <span style={{ fontSize: 12, color: 'var(--c-warning)', width: '100%' }}>
              {bulkReservedCount} поз. вне «На хранении» — товар привязан к задаче упаковки
              или отгрузке. Место сменится, но если его сейчас набирают, набор придётся
              переделать.
            </span>
          )}
        </div>
      )}

      <Drawer
        open={reloc !== null}
        onClose={() => setReloc(null)}
        title="Перемещение товара"
        subtitle={reloc ? `${reloc.product_name} · ${[reloc.product_sku, reloc.color_name, reloc.size_name].filter(Boolean).join(' · ')}` : undefined}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={() => setReloc(null)} disabled={relocSaving}>Отмена</button>
            <button className="btn primary" onClick={() => void submitReloc()} disabled={relocSaving}>
              <Icon name="check" size={14} />Переместить
            </button>
          </div>
        }
      >
        {reloc && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', rowGap: 8, columnGap: 14, fontSize: 13 }}>
              <span style={{ color: 'var(--c-text-muted)' }}>Статус</span>
              <span><Badge tone={OP_TONE[reloc.op_status]}>{INV_OP_LABELS[reloc.op_status]}</Badge></span>
              <span style={{ color: 'var(--c-text-muted)' }}>Качество</span>
              <span><Badge tone={QUALITY_TONE[reloc.quality]}>{INV_QUALITY_LABELS[reloc.quality]}</Badge></span>
              <span style={{ color: 'var(--c-text-muted)' }}>Клиент</span>
              <span>{reloc.client_name ?? '—'}</span>
              <span style={{ color: 'var(--c-text-muted)' }}>Текущее местоположение</span>
              <span>{reloc.location_name ?? 'Без места'}</span>
              <span style={{ color: 'var(--c-text-muted)' }}>Доступно</span>
              <span className="mono" style={{ fontWeight: 600 }}>{reloc.qty.toLocaleString('ru-RU')} шт</span>
            </div>

            {reloc.op_status !== 'storage' && (
              <div className="t-sub" style={{ fontSize: 12.5, color: 'var(--c-warning)' }}>
                Товар привязан к задаче упаковки или отгрузке — перемещается только место хранения, статус и резерв документа сохраняются.
              </div>
            )}

            <div>
              <label className="field-label"><span>Местоположение назначения <span style={{ color: 'var(--c-danger)' }}>*</span></span></label>
              <Combobox
                value={toZoneId}
                placeholder="Выберите местоположение"
                options={activeZones.filter((z) => z.id !== reloc.location_id).map((z) => ({ value: z.id, label: z.name }))}
                onChange={(v) => setToZoneId(String(v ?? ''))}
                clearable
              />
            </div>

            <div>
              <label className="field-label"><span>Количество</span></label>
              <NumberStep value={relocQty} min={1} onChange={(v) => setRelocQty(Math.min(reloc.qty, v))} height={34} />
              <div className="t-sub" style={{ fontSize: 12, marginTop: 4 }}>Максимум: {reloc.qty}</div>
            </div>

            <div>
              <label className="field-label"><span>Комментарий</span></label>
              <textarea
                className="input"
                style={{ height: 60, paddingTop: 8, paddingBottom: 8, resize: 'vertical' }}
                value={relocComment}
                onChange={(e) => setRelocComment(e.target.value)}
                placeholder="Необязательно"
              />
            </div>

            {relocError && <div style={{ fontSize: 12.5, color: 'var(--c-danger)' }}>{relocError}</div>}
          </div>
        )}
      </Drawer>

      <Drawer
        open={qual !== null}
        onClose={() => setQual(null)}
        title="Смена качества товара"
        subtitle={qual ? `${qual.product_name} · ${[qual.product_sku, qual.color_name, qual.size_name].filter(Boolean).join(' · ')}` : undefined}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={() => setQual(null)} disabled={qualSaving}>Отмена</button>
            <button className="btn primary" onClick={() => void submitQual()} disabled={qualSaving || qualQty <= 0}>
              <Icon name="check" size={14} />Изменить качество
            </button>
          </div>
        }
      >
        {qual && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', rowGap: 8, columnGap: 14, fontSize: 13 }}>
              <span style={{ color: 'var(--c-text-muted)' }}>Статус</span>
              <span><Badge tone={OP_TONE[qual.op_status]}>{INV_OP_LABELS[qual.op_status]}</Badge></span>
              <span style={{ color: 'var(--c-text-muted)' }}>Качество</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Badge tone={QUALITY_TONE[qual.quality]}>{INV_QUALITY_LABELS[qual.quality]}</Badge>
                <Icon name="arrowRight" size={12} style={{ color: 'var(--c-text-subtle)' }} />
                <Badge tone={QUALITY_TONE[qual.quality === 'defect' ? 'good' : 'defect']}>
                  {INV_QUALITY_LABELS[qual.quality === 'defect' ? 'good' : 'defect']}
                </Badge>
              </span>
              <span style={{ color: 'var(--c-text-muted)' }}>Клиент</span>
              <span>{qual.client_name ?? '—'}</span>
              <span style={{ color: 'var(--c-text-muted)' }}>Местоположение</span>
              <span>{qual.location_name ?? 'Без места'}</span>
              <span style={{ color: 'var(--c-text-muted)' }}>Доступно</span>
              <span className="mono" style={{ fontWeight: 600 }}>{qual.qty.toLocaleString('ru-RU')} шт</span>
            </div>

            {qual.op_status !== 'storage' && (
              <div className="t-sub" style={{ fontSize: 12.5, color: 'var(--c-warning)' }}>
                Товар привязан к задаче упаковки или отгрузке. Брак выбывает из процесса и вернётся «На хранение» в этом же месте — документ уедет без него.
              </div>
            )}

            <div>
              <label className="field-label"><span>Количество</span></label>
              <NumberStep value={qualQty} min={1} onChange={(v) => setQualQty(Math.min(qual.qty, v))} height={34} />
              <div className="t-sub" style={{ fontSize: 12, marginTop: 4 }}>Максимум: {qual.qty}</div>
            </div>

            <div>
              <label className="field-label"><span>Комментарий</span></label>
              <textarea
                className="input"
                style={{ height: 60, paddingTop: 8, paddingBottom: 8, resize: 'vertical' }}
                value={qualComment}
                onChange={(e) => setQualComment(e.target.value)}
                placeholder="Например: брак исправлен после доработки"
              />
            </div>

            {qualError && <div style={{ fontSize: 12.5, color: 'var(--c-danger)' }}>{qualError}</div>}
          </div>
        )}
      </Drawer>

      <Drawer
        open={woff !== null}
        onClose={() => setWoff(null)}
        title="Списание с остатков"
        subtitle={woff ? `${woff.product_name} · ${[woff.product_sku, woff.color_name, woff.size_name].filter(Boolean).join(' · ')}` : undefined}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={() => setWoff(null)} disabled={woffSaving}>Отмена</button>
            <button className="btn primary" onClick={() => void submitWoff()} disabled={woffSaving || woffQty <= 0}>
              <Icon name="trash" size={14} />Списать
            </button>
          </div>
        }
      >
        {woff && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', rowGap: 8, columnGap: 14, fontSize: 13 }}>
              <span style={{ color: 'var(--c-text-muted)' }}>Статус</span>
              <span><Badge tone={OP_TONE[woff.op_status]}>{INV_OP_LABELS[woff.op_status]}</Badge></span>
              <span style={{ color: 'var(--c-text-muted)' }}>Качество</span>
              <span><Badge tone={QUALITY_TONE[woff.quality]}>{INV_QUALITY_LABELS[woff.quality]}</Badge></span>
              <span style={{ color: 'var(--c-text-muted)' }}>Клиент</span>
              <span>{woff.client_name ?? '—'}</span>
              <span style={{ color: 'var(--c-text-muted)' }}>Местоположение</span>
              <span>{woff.location_name ?? 'Без места'}</span>
              <span style={{ color: 'var(--c-text-muted)' }}>Доступно</span>
              <span className="mono" style={{ fontWeight: 600 }}>{woff.qty.toLocaleString('ru-RU')} шт</span>
            </div>

            <div className="t-sub" style={{ fontSize: 12.5, color: 'var(--c-warning)' }}>
              Товар будет списан безвозвратно и исчезнет с остатков. Списание попадёт в журнал движений и будет видно клиенту.
              {woff.op_status !== 'storage' && ' Товар привязан к задаче упаковки или отгрузке — документ уедет без него.'}
            </div>

            <div>
              <label className="field-label"><span>Причина <span style={{ color: 'var(--c-danger)' }}>*</span></span></label>
              <Combobox
                value={woffReason}
                placeholder="Выберите причину"
                options={Object.entries(WRITEOFF_REASON_LABELS).map(([value, label]) => ({ value, label }))}
                onChange={(v) => setWoffReason((v ?? '') as WriteOffReason | '')}
                clearable
              />
            </div>

            <div>
              <label className="field-label"><span>Количество</span></label>
              <NumberStep value={woffQty} min={1} onChange={(v) => setWoffQty(Math.min(woff.qty, v))} height={34} />
              <div className="t-sub" style={{ fontSize: 12, marginTop: 4 }}>Максимум: {woff.qty}</div>
            </div>

            <div>
              <label className="field-label">
                <span>Комментарий{woffReason === 'other' && <span style={{ color: 'var(--c-danger)' }}> *</span>}</span>
              </label>
              <textarea
                className="input"
                style={{ height: 60, paddingTop: 8, paddingBottom: 8, resize: 'vertical' }}
                value={woffComment}
                onChange={(e) => setWoffComment(e.target.value)}
                placeholder="Например: повреждено при хранении"
              />
            </div>

            {woffError && <div style={{ fontSize: 12.5, color: 'var(--c-danger)' }}>{woffError}</div>}
          </div>
        )}
      </Drawer>
    </>
  )
}
