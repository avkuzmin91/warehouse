import { useState, useEffect, useCallback, useMemo } from 'react'
import { getBalancesByZone, createZoneRelocation } from '../../../../../api/balancesApi'
import type { BalanceZoneItem, BalanceZoneStatus } from '../../../../../api/balancesApi'
import { useLookups } from '../../../../../hooks/useLookups'
import { Table, Td } from '../../../../data/Table'
import { Combobox } from '../../../../data/Combobox'
import { FiltersBar, FilterCombobox, FilterSelect } from '../../../../data/FiltersBar'
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

const STATUS_LABELS: Record<BalanceZoneStatus, string> = {
  good: 'Годный',
  defect: 'Брак',
  on_review: 'На проверке',
}

const STATUS_TONE: Record<BalanceZoneStatus, BadgeTone> = {
  good: 'success',
  defect: 'warning',
  on_review: 'accent',
}

export function ByZoneView() {
  const [items, setItems] = useState<BalanceZoneItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [clientId, setClientId] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const { clients, unloadingZones } = useLookups()
  const toast = useToast()

  // Перемещение между местами (вариант B). reloc = строка, которую двигаем.
  const [reloc, setReloc] = useState<BalanceZoneItem | null>(null)
  const [toZoneId, setToZoneId] = useState('')
  const [relocQty, setRelocQty] = useState(0)
  const [relocComment, setRelocComment] = useState('')
  const [relocSaving, setRelocSaving] = useState(false)
  const [relocError, setRelocError] = useState('')

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

  async function submitReloc() {
    if (!reloc) return
    setRelocError('')
    if (!toZoneId) { setRelocError('Выберите место назначения'); return }
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
        status:       reloc.status as 'good' | 'defect',
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

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getBalancesByZone({
        search: search || undefined,
        client_id: clientId || undefined,
      })
      setItems(res.items)
    } finally {
      setLoading(false)
    }
  }, [search, clientId])

  useEffect(() => { load() }, [load])

  const filteredItems = useMemo(
    () => statusFilter
      ? items.filter((item) => item.status === statusFilter)
      : items,
    [items, statusFilter],
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

  const kpi = useMemo(() => {
    const goodQty = filteredItems.reduce((sum, item) => sum + (item.status === 'good' ? item.qty : 0), 0)
    const defectQty = filteredItems.reduce((sum, item) => sum + (item.status === 'defect' ? item.qty : 0), 0)
    const onReviewQty = filteredItems.reduce((sum, item) => sum + (item.status === 'on_review' ? item.qty : 0), 0)
    return { totalQty: goodQty + defectQty + onReviewQty, goodQty, defectQty, onReviewQty }
  }, [filteredItems])

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
            value={statusFilter}
            options={[
              { value: '', label: 'Все статусы' },
              { value: 'on_review', label: STATUS_LABELS.on_review },
              { value: 'good', label: STATUS_LABELS.good },
              { value: 'defect', label: STATUS_LABELS.defect },
            ]}
            onChange={setStatusFilter}
          />
          {(clientId || statusFilter) && (
            <button className="btn ghost sm" onClick={() => { setClientId(''); setStatusFilter('') }}>
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

      <div className="kpi-grid" style={{ marginBottom: 20 }}>
        <KPI label="Всего единиц" value={kpi.totalQty.toLocaleString('ru-RU')} unit="шт" />
        <KPI label="Годный" value={kpi.goodQty.toLocaleString('ru-RU')} valueColor="var(--c-success)" unit="шт" />
        <KPI label="Брак" value={kpi.defectQty.toLocaleString('ru-RU')} valueColor="var(--c-warning)" unit="шт" />
        <KPI label="На проверке" value={kpi.onReviewQty.toLocaleString('ru-RU')} valueColor="var(--c-accent)" unit="шт" />
      </div>

      {loading ? (
        <Table>
          <tbody><SkeletonRows rows={8} cols={4} /></tbody>
        </Table>
      ) : groups.length === 0 ? (
        <EmptyState title="Остатков нет" sub="Данные появятся после завершения поступлений с указанным местом хранения" />
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
                    <th style={{ width: 130 }}>Статус</th>
                    <th style={{ textAlign: 'right', width: 110 }}>Количество</th>
                    <th style={{ width: 44 }} />
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((item, i) => (
                    <tr key={`${item.product_id}-${item.color_id}-${item.size_id}-${item.status}-${i}`}>
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
                        <Badge tone={STATUS_TONE[item.status]}>{STATUS_LABELS[item.status]}</Badge>
                      </Td>
                      <Td className="num" style={{ fontWeight: 600 }}>
                        {item.qty.toLocaleString('ru-RU')}
                      </Td>
                      <Td>
                        {(item.status === 'good' || item.status === 'defect') && (
                          <button
                            className="btn ghost icon sm"
                            title="Переместить в другое место"
                            onClick={() => openReloc(item)}
                          >
                            <Icon name="arrowRight" size={14} />
                          </button>
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
              <span style={{ color: 'var(--c-text-muted)' }}>Статус</span>
              <span><Badge tone={STATUS_TONE[reloc.status]}>{STATUS_LABELS[reloc.status]}</Badge></span>
              <span style={{ color: 'var(--c-text-muted)' }}>Клиент</span>
              <span>{reloc.client_name ?? '—'}</span>
              <span style={{ color: 'var(--c-text-muted)' }}>Текущее место</span>
              <span>{reloc.location_name ?? 'Без места'}</span>
              <span style={{ color: 'var(--c-text-muted)' }}>Доступно</span>
              <span className="mono" style={{ fontWeight: 600 }}>{reloc.qty.toLocaleString('ru-RU')} шт</span>
            </div>

            <div>
              <label className="field-label"><span>Место назначения <span style={{ color: 'var(--c-danger)' }}>*</span></span></label>
              <Combobox
                value={toZoneId}
                placeholder="Выберите место"
                options={activeZones.filter((z) => z.id !== reloc.location_id).map((z) => ({ value: z.id, label: z.name }))}
                onChange={(v) => setToZoneId(String(v ?? ''))}
                clearable
              />
            </div>

            <div>
              <label className="field-label"><span>Количество</span></label>
              <NumberStep value={relocQty} min={1} onChange={(v) => setRelocQty(Math.min(reloc.qty, v))} />
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
    </>
  )
}
