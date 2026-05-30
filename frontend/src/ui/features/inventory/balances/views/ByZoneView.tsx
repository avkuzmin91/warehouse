import { useState, useEffect, useCallback, useMemo } from 'react'
import { getBalancesByZone } from '../../../../../api/balancesApi'
import type { BalanceZoneItem, BalanceZoneStatus } from '../../../../../api/balancesApi'
import { useLookups } from '../../../../../hooks/useLookups'
import { Table, Td } from '../../../../data/Table'
import { FiltersBar, FilterCombobox } from '../../../../data/FiltersBar'
import { Card, CardHead } from '../../../../primitives/Card'
import { Icon } from '../../../../primitives/Icon'
import { Badge } from '../../../../primitives/Badge'
import type { BadgeTone } from '../../../../primitives/Badge'
import { SkeletonRows } from '../../../../primitives/Skeleton'
import { EmptyState } from '../../../../primitives/EmptyState'

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
  const { clients } = useLookups()

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

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <FiltersBar>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Icon name="search" size={13} style={{ position: 'absolute', left: 9, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
            <input
              className="input sm"
              style={{ paddingLeft: 28, width: 220 }}
              placeholder="Товар, SKU…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <FilterCombobox
            label="Клиент"
            value={clientId}
            options={[{ value: '', label: 'Все клиенты' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
            onChange={(v) => setClientId(v)}
            placeholder="Поиск клиента…"
          />
          {clientId && (
            <button className="btn ghost sm" onClick={() => setClientId('')}>
              <Icon name="x" size={12} />Сбросить
            </button>
          )}
        </FiltersBar>
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
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
