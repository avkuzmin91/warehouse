import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  getBalancesByZone,
  getBalancesSummary,
  createZoneRelocation,
  createQualityChange,
  createWriteOff,
  INV_OP_LABELS,
  INV_QUALITY_LABELS,
  WRITEOFF_REASON_LABELS,
} from '../../../../../api/balancesApi'
import type { BalanceSummary, BalanceZoneItem, InvOpStatus, InvQuality, WriteOffReason } from '../../../../../api/balancesApi'
import { useLookups } from '../../../../../hooks/useLookups'
import { Table, Td } from '../../../../data/Table'
import { Combobox } from '../../../../data/Combobox'
import { FiltersBar, FilterCombobox, FilterSelect } from '../../../../data/FiltersBar'
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

type LocationGroup = {
  locationId: string | null
  locationName: string
  items: BalanceZoneItem[]
  totalQty: number
}

const OP_TONE: Record<InvOpStatus, BadgeTone> = {
  storage: 'accent',
  packing: 'info',
  ready:   'success',
}

const QUALITY_TONE: Record<InvQuality, BadgeTone> = {
  good:   'success',
  defect: 'warning',
}

export function ByZoneView() {
  const [items, setItems] = useState<BalanceZoneItem[]>([])
  const [summary, setSummary] = useState<BalanceSummary | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [clientId, setClientId] = useState('')
  const [opFilter, setOpFilter] = useState('')
  const [qualityFilter, setQualityFilter] = useState('')
  const { clients, unloadingZones } = useLookups()
  const toast = useToast()

  // Перемещение между местоположениями: только товар «На хранении».
  const [reloc, setReloc] = useState<BalanceZoneItem | null>(null)
  const [toZoneId, setToZoneId] = useState('')
  const [relocQty, setRelocQty] = useState(0)
  const [relocComment, setRelocComment] = useState('')
  const [relocSaving, setRelocSaving] = useState(false)
  const [relocError, setRelocError] = useState('')

  // Смена качества (Брак ↔ Годный) в пределах места: только товар «На хранении».
  const [qual, setQual] = useState<BalanceZoneItem | null>(null)
  const [qualQty, setQualQty] = useState(0)
  const [qualComment, setQualComment] = useState('')
  const [qualSaving, setQualSaving] = useState(false)
  const [qualError, setQualError] = useState('')

  // Списание с остатков (терминальное): только товар «На хранении».
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

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [res, sum] = await Promise.all([
        getBalancesByZone({
          search: search || undefined,
          client_id: clientId || undefined,
        }),
        getBalancesSummary({
          search: search || undefined,
          client_id: clientId || undefined,
        }),
      ])
      setItems(res.items)
      setTruncated(res.truncated)
      setSummary(sum)
    } finally {
      setLoading(false)
    }
  }, [search, clientId])

  useEffect(() => { load() }, [load])

  const filteredItems = useMemo(
    () => items.filter((item) =>
      (!opFilter || item.op_status === opFilter)
      && (!qualityFilter || item.quality === qualityFilter),
    ),
    [items, opFilter, qualityFilter],
  )

  const groups = useMemo<LocationGroup[]>(() => {
    const map = new Map<string, LocationGroup>()
    for (const item of filteredItems) {
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
  }, [filteredItems])

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
    const readyQty = s ? bucket('ready', s.ready_good, s.ready_defect) : 0
    const defectQty = s ? bucket('storage', 0, s.storage_defect) + bucket('packing', 0, s.packing_defect) + bucket('ready', 0, s.ready_defect) : 0
    return {
      totalQty: storageQty + packingQty + readyQty,
      storageQty, packingQty, readyQty, defectQty,
    }
  }, [summary, opFilter, qualityFilter])

  const kpiVal = (n: number) => (summary ? n.toLocaleString('ru-RU') : '—')
  const toggleOp = (op: InvOpStatus) => setOpFilter(opFilter === op ? '' : op)

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <FiltersBar>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Icon name="search" size={13} style={{ position: 'absolute', left: 9, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
            <input
              className="input sm"
              style={{ paddingLeft: 28, width: 220, paddingRight: search ? 26 : undefined }}
              placeholder="Товар, SKU…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'var(--c-text-subtle)' }}
                onClick={() => setSearch('')}
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </div>
          <FilterCombobox
            label="Клиент"
            value={clientId}
            options={[{ value: '', label: 'Все клиенты' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
            onChange={(v) => setClientId(v)}
            placeholder="Поиск клиента…"
          />
          <FilterSelect
            label="Статус"
            value={opFilter}
            options={[
              { value: '', label: 'Все статусы' },
              { value: 'storage', label: INV_OP_LABELS.storage },
              { value: 'packing', label: INV_OP_LABELS.packing },
              { value: 'ready', label: INV_OP_LABELS.ready },
            ]}
            onChange={setOpFilter}
          />
          <FilterSelect
            label="Качество"
            value={qualityFilter}
            options={[
              { value: '', label: 'Любое качество' },
              { value: 'good', label: INV_QUALITY_LABELS.good },
              { value: 'defect', label: INV_QUALITY_LABELS.defect },
            ]}
            onChange={setQualityFilter}
          />
          {(clientId || opFilter || qualityFilter) && (
            <button className="btn ghost sm" onClick={() => { setClientId(''); setOpFilter(''); setQualityFilter('') }}>
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

      <div className="kpi-grid" style={{ marginBottom: 20, gridTemplateColumns: 'repeat(5, 1fr)' }}>
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
          onClick={() => setQualityFilter(qualityFilter === 'defect' ? '' : 'defect')}
        />
      </div>

      {truncated && !loading && (
        <div
          className="t-sub"
          style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, background: 'var(--c-bg-sunken)', color: 'var(--c-warning)' }}
        >
          Показаны не все строки — список обрезан серверным лимитом. Уточните фильтры; итоги в карточках посчитаны по всем данным.
        </div>
      )}

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
                <Icon name="boxes" size={15} className="ic-accent" />
                <span className="card-head-title">{group.locationName}</span>
                <Badge tone="accent" style={{ marginLeft: 6 }}>{group.items.length}</Badge>
                <div className="flex-1" />
                <span className="t-sub mono">{group.totalQty.toLocaleString('ru-RU')} шт</span>
              </CardHead>
              <Table>
                <thead>
                  <tr>
                    <th>Товар</th>
                    <th>Клиент</th>
                    <th style={{ width: 150 }}>Статус</th>
                    <th style={{ width: 100 }}>Качество</th>
                    <th style={{ textAlign: 'right', width: 110 }}>Количество</th>
                    <th style={{ width: 108 }} />
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((item, i) => (
                    <tr key={`${item.product_id}-${item.color_id}-${item.size_id}-${item.op_status}-${item.quality}-${i}`}>
                      <Td>
                        <div style={{ fontWeight: 500 }}>{item.product_name}</div>
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
                        {item.qty.toLocaleString('ru-RU')}
                      </Td>
                      <Td>
                        {item.op_status === 'storage' && (
                          <div style={{ display: 'flex', gap: 2 }}>
                            <button
                              className="btn ghost icon sm"
                              title="Переместить в другое местоположение"
                              onClick={() => openReloc(item)}
                            >
                              <Icon name="arrowRight" size={14} />
                            </button>
                            {item.location_id && (
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
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          ))}
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
              <span style={{ color: 'var(--c-text-muted)' }}>Качество</span>
              <span><Badge tone={QUALITY_TONE[reloc.quality]}>{INV_QUALITY_LABELS[reloc.quality]}</Badge></span>
              <span style={{ color: 'var(--c-text-muted)' }}>Клиент</span>
              <span>{reloc.client_name ?? '—'}</span>
              <span style={{ color: 'var(--c-text-muted)' }}>Текущее местоположение</span>
              <span>{reloc.location_name ?? 'Без места'}</span>
              <span style={{ color: 'var(--c-text-muted)' }}>Доступно</span>
              <span className="mono" style={{ fontWeight: 600 }}>{reloc.qty.toLocaleString('ru-RU')} шт</span>
            </div>

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
