import { Fragment, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { getTrips, tripStatusLabel, tripStatusTone } from '../../../api/tripsApi'
import type { TripListItem, TripStatus, TripDirection } from '../../../api/tripsApi'
import { ListPage } from '../../layouts/ListPage'
import { Table, Td } from '../../data/Table'
import { FiltersBar, FilterSelect, FilterCombobox } from '../../data/FiltersBar'
import { DateRange } from '../../data/DateRange'
import { Pagination } from '../../data/Pagination'
import { Badge } from '../../primitives/Badge'
import type { BadgeTone } from '../../primitives/Badge'
import { Dropdown } from '../../primitives/Dropdown'
import { Icon } from '../../primitives/Icon'
import { SkeletonRows } from '../../primitives/Skeleton'
import { EmptyState } from '../../primitives/EmptyState'
import { useApi } from '../../../hooks/useApi'
import { useLookups } from '../../../hooks/useLookups'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { useFilterParam, useFilterParamsActions, usePageParam } from '../../../hooks/useFilterParams'
import { canCreateDocuments, canViewCosts } from '../../../utils/access'

const PAGE_SIZE = 25

const TYPE_OPTIONS: { value: '' | TripDirection; label: string }[] = [
  { value: '', label: 'Все типы' },
  { value: 'inbound', label: 'Поступление' },
  { value: 'outbound', label: 'Отгрузка' },
]

const GROUPS: { id: string; label: string; statuses: TripStatus[] }[] = [
  { id: 'all', label: 'Все статусы', statuses: [] },
  { id: 'draft', label: 'Черновики', statuses: ['draft'] },
  { id: 'warehouse', label: 'На складе', statuses: ['awaiting_arrival', 'unloading'] },
  { id: 'costing', label: 'Уточнение', statuses: ['costing'] },
  { id: 'closed', label: 'Закрыты', statuses: ['closed', 'cancelled'] },
]

const STATUS_OPTIONS = GROUPS.map((g) => ({ value: g.id === 'all' ? '' : g.id, label: g.label }))

function fmtMoney(v: number | null | undefined): string {
  return v == null ? '—' : v.toLocaleString('ru-RU')
}

function TimeCell({ eta }: { eta: string | null }) {
  if (!eta) return <span className="t-sub">—</span>
  const d = new Date(eta)
  if (Number.isNaN(d.getTime())) return <span className="mono">{eta}</span>
  return <span className="mono" style={{ fontSize: 12.5 }}>{d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
}

function tripDirection(direction: string | null | undefined): TripDirection {
  return direction === 'outbound' ? 'outbound' : 'inbound'
}

function TypeBadge({ direction }: { direction: string | null | undefined }) {
  const outbound = tripDirection(direction) === 'outbound'
  return (
    <Badge tone={outbound ? 'info' : 'success'}>
      <Icon name={outbound ? 'arrowUp' : 'arrowDown'} size={13} />
      {outbound ? 'Отгрузка' : 'Поступление'}
    </Badge>
  )
}

type TripDayGroup = {
  key: string
  label: string
  outCount: number
  inCount: number
  rows: TripListItem[]
}

function startOfDayMs(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function dayKeyOf(eta: string | null): string {
  if (!eta) return 'no-date'
  const d = new Date(eta)
  if (Number.isNaN(d.getTime())) return 'no-date'
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function dayLabelOf(eta: string | null, today: number): string {
  if (!eta) return 'Без плановой даты'
  const d = new Date(eta)
  if (Number.isNaN(d.getTime())) return 'Без плановой даты'
  const diffDays = Math.round((startOfDayMs(d) - today) / 86_400_000)
  const rel = diffDays === 0 ? 'Сегодня' : diffDays === 1 ? 'Завтра' : diffDays === -1 ? 'Вчера' : null
  const date = d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' })
  const weekday = d.toLocaleDateString('ru-RU', { weekday: 'long' })
  return rel ? `${rel} · ${date} · ${weekday}` : `${date} · ${weekday}`
}

/** Группировка рейсов по плановому дню; внутри дня — сначала отгрузки, затем поступления.
 *  Порядок дней наследуется из выдачи backend (eta DESC, no-date в конце). */
function groupTripsByDay(trips: TripListItem[], today: number): TripDayGroup[] {
  const map = new Map<string, TripDayGroup>()
  for (const t of trips) {
    const key = dayKeyOf(t.eta)
    let g = map.get(key)
    if (!g) {
      g = { key, label: dayLabelOf(t.eta, today), outCount: 0, inCount: 0, rows: [] }
      map.set(key, g)
    }
    if (tripDirection(t.direction) === 'outbound') g.outCount += 1
    else g.inCount += 1
    g.rows.push(t)
  }
  for (const g of map.values()) {
    g.rows = [
      ...g.rows.filter((r) => tripDirection(r.direction) === 'outbound'),
      ...g.rows.filter((r) => tripDirection(r.direction) !== 'outbound'),
    ]
  }
  return [...map.values()]
}

export function TripsListFeature() {
  const navigate = useNavigate()
  const { carriers } = useLookups()
  const { user } = useCurrentUser()
  const showCosts = canViewCosts(user)
  const canCreate = canCreateDocuments(user)

  const [search, setSearch] = useFilterParam('search', '')
  const [typeRaw, setType] = useFilterParam('type', '')
  const typeFilter: '' | TripDirection = typeRaw === 'outbound' || typeRaw === 'inbound' ? typeRaw : ''
  const [group, setGroup] = useFilterParam('group', 'all')
  const [carrier, setCarrier] = useFilterParam('carrier', '')
  const [from, setFrom] = useFilterParam('from', '')
  const [to, setTo] = useFilterParam('to', '')
  const [page, setPage] = usePageParam()
  const { setMany } = useFilterParamsActions()

  const groupDef = GROUPS.find((g) => g.id === group) ?? GROUPS[0]
  const statuses = groupDef.statuses.length ? groupDef.statuses : undefined

  const { data, loading } = useApi(
    (signal) => getTrips({
      page,
      limit: PAGE_SIZE,
      direction: typeFilter || undefined,
      statuses,
      carrier_id: carrier || undefined,
      search: search.trim() || undefined,
      eta_from: from || undefined,
      eta_to: to || undefined,
    }, signal),
    [typeFilter, group, carrier, search, from, to, page],
  )
  const trips: TripListItem[] = data?.items ?? []
  const total = data?.total ?? 0
  const colCount = showCosts ? 10 : 8
  const dayGroups = useMemo(() => groupTripsByDay(trips, startOfDayMs(new Date())), [trips])

  return (
    <ListPage
      title="Рейсы"
      subtitle="Транспортные рейсы поступлений и отгрузок"
      actions={
        canCreate ? (
        <Dropdown
          trigger={
            <button className="btn primary" type="button">
              <Icon name="plus" size={14} />Новый рейс
              <Icon name="chevDown" size={12} />
            </button>
          }
          items={[
            {
              label: 'Рейс поступления',
              icon: <Icon name="truckIn" size={16} style={{ color: 'var(--c-success)' }} />,
              onClick: () => navigate('/logistics/trips/new?dir=inbound'),
            },
            {
              label: 'Рейс отгрузки товара',
              icon: <Icon name="truckOut" size={16} style={{ color: 'var(--c-info)' }} />,
              onClick: () => navigate('/logistics/trips/new?dir=outbound'),
            },
            {
              label: 'Рейс отгрузки брака',
              icon: <Icon name="alert" size={16} style={{ color: 'var(--c-warning)' }} />,
              onClick: () => navigate('/logistics/trips/new?dir=outbound&cargo=defect'),
            },
          ]}
        />
        ) : undefined
      }
      filters={
        <FiltersBar>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Icon name="search" size={13} style={{ position: 'absolute', left: 9, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
            <input
              className="input sm"
              style={{ paddingLeft: 28, width: 240, paddingRight: search ? 26 : undefined }}
              placeholder="Номер, маршрут, SKU, товар…"
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
          <FilterSelect
            label="Тип"
            value={typeFilter}
            options={TYPE_OPTIONS}
            onChange={(v) => setType(v)}
          />
          <FilterSelect
            label="Статус"
            value={group === 'all' ? '' : group}
            options={STATUS_OPTIONS}
            onChange={(v) => setGroup(v || 'all')}
          />
          <FilterCombobox
            label="Перевозчик"
            value={carrier}
            options={[{ value: '', label: 'Все перевозчики' }, ...carriers.map((c) => ({ value: c.id, label: c.name }))]}
            onChange={(v) => setCarrier(v)}
            placeholder="Поиск перевозчика…"
          />
          <DateRange
            from={from} to={to}
            onFromChange={(v) => setFrom(v)}
            onToChange={(v) => setTo(v)}
            onClear={() => setMany({ from: '', to: '' })}
          />
          {(typeFilter || carrier || from || to || search || group !== 'all') && (
            <button className="btn ghost sm" onClick={() => setMany({ type: '', carrier: '', from: '', to: '', search: '', group: '' })}>
              <Icon name="x" size={12} />Сбросить
            </button>
          )}
        </FiltersBar>
      }
    >
      <Table>
        <thead>
          <tr>
            <th style={{ width: 130 }}>Тип</th>
            <th style={{ width: 120 }}>Номер</th>
            <th style={{ width: 90 }}>Время</th>
            <th style={{ width: 170 }}>Статус</th>
            <th>Маршрут</th>
            <th style={{ width: 160 }}>Перевозчик</th>
            <th style={{ textAlign: 'right', width: 90 }}>Строки</th>
            <th style={{ textAlign: 'right', width: 90 }}>Товар</th>
            {showCosts && <th style={{ textAlign: 'right', width: 90 }}>План ₽</th>}
            {showCosts && <th style={{ textAlign: 'right', width: 90 }}>Факт ₽</th>}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <SkeletonRows rows={8} cols={colCount} />
          ) : trips.length === 0 ? (
            <tr><td colSpan={colCount}><EmptyState title="Рейсов нет" sub={group === 'all' ? 'Создайте первый рейс' : undefined} /></td></tr>
          ) : (
            dayGroups.map((g) => (
              <Fragment key={g.key}>
                <tr className="list-day-row">
                  <td colSpan={colCount}>
                    <div className="list-day-head">
                      <span className="list-day-title"><Icon name="calendar" size={14} />{g.label}</span>
                      <span className="list-day-counts">
                        {g.outCount > 0 && <span style={{ color: 'var(--c-info)' }}>{g.outCount} отгр.</span>}
                        {g.outCount > 0 && g.inCount > 0 && <span className="t-sub">·</span>}
                        {g.inCount > 0 && <span style={{ color: 'var(--c-success)' }}>{g.inCount} поступл.</span>}
                      </span>
                    </div>
                  </td>
                </tr>
                {g.rows.map((t) => {
                  const direction = tripDirection(t.direction)
                  return (
                    <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/logistics/trips/${t.id}`)}>
                      <Td style={{ borderLeft: `3px solid ${direction === 'outbound' ? 'var(--c-info)' : 'var(--c-success)'}` }}><TypeBadge direction={direction} /></Td>
                      <Td className="mono" style={{ fontWeight: 500 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {t.trip_number}
                          {direction === 'outbound' && t.cargo_type === 'defect' && <Badge tone="warning">Брак</Badge>}
                        </span>
                      </Td>
                      <Td><TimeCell eta={t.eta} /></Td>
                      <Td>
                        <Badge tone={tripStatusTone(t.status) as BadgeTone} dot>{tripStatusLabel(t.status, direction)}</Badge>
                      </Td>
                      <Td>{t.origin_name ?? '—'}</Td>
                      <Td className="t-sub">{t.carrier_name ?? '—'}</Td>
                      <Td className="num">{t.receipts_count}</Td>
                      <Td className="num">{t.items_qty}</Td>
                      {showCosts && <Td className="num">{fmtMoney(t.cost_estimate)}</Td>}
                      {showCosts && <Td className="num">{fmtMoney(t.logistics_cost_actual)}</Td>}
                    </tr>
                  )
                })}
              </Fragment>
            ))
          )}
        </tbody>
      </Table>

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
    </ListPage>
  )
}
