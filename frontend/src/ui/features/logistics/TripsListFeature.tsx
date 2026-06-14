import { useNavigate } from 'react-router-dom'
import { getTrips, tripStatusLabel, tripStatusTone } from '../../../api/tripsApi'
import type { TripListItem, TripStatus, TripDirection } from '../../../api/tripsApi'
import { ListPage } from '../../layouts/ListPage'
import { Table, Td } from '../../data/Table'
import { FilterSelect } from '../../data/FiltersBar'
import { DateRange } from '../../data/DateRange'
import { Pagination } from '../../data/Pagination'
import { KPI } from '../../primitives/KPI'
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
import { canViewCosts } from '../../../utils/access'

const PAGE_SIZE = 25

const ACTIVE: TripStatus[] = ['draft', 'awaiting_arrival', 'unloading', 'costing']
const IN_QUEUE: TripStatus[] = ['awaiting_arrival', 'unloading']

const TYPE_OPTIONS: { value: '' | TripDirection; label: string }[] = [
  { value: '', label: 'Все типы' },
  { value: 'inbound', label: 'Поступление' },
  { value: 'outbound', label: 'Отгрузка' },
]

const GROUPS: { id: string; label: string; statuses: TripStatus[] }[] = [
  { id: 'all', label: 'Все', statuses: [] },
  { id: 'draft', label: 'Черновики', statuses: ['draft'] },
  { id: 'warehouse', label: 'На складе', statuses: ['awaiting_arrival', 'unloading'] },
  { id: 'costing', label: 'Уточнение', statuses: ['costing'] },
  { id: 'closed', label: 'Закрыты', statuses: ['closed', 'cancelled'] },
]

function fmtMoney(v: number | null | undefined): string {
  return v == null ? '—' : v.toLocaleString('ru-RU')
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 30, padding: '0 14px', borderRadius: 99, cursor: 'pointer', fontFamily: 'inherit',
        border: `1px solid ${active ? 'transparent' : 'var(--c-border-strong)'}`,
        background: active ? 'var(--c-accent-bg)' : 'transparent',
        color: active ? 'var(--c-accent-text)' : 'var(--c-text-muted)',
        fontSize: 12.5, fontWeight: 500,
      }}
    >
      {children}
    </button>
  )
}

function EtaCell({ eta }: { eta: string | null }) {
  if (!eta) return <span className="t-sub">—</span>
  const d = new Date(eta)
  if (Number.isNaN(d.getTime())) return <span className="mono">{eta}</span>
  return (
    <div style={{ lineHeight: 1.3 }}>
      <div className="mono" style={{ fontSize: 12.5 }}>{d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}</div>
      <div className="t-sub mono" style={{ fontSize: 11 }}>{d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</div>
    </div>
  )
}

function tripDirection(direction: string | null | undefined): TripDirection {
  return direction === 'outbound' ? 'outbound' : 'inbound'
}

function TypeBadge({ direction }: { direction: string | null | undefined }) {
  const outbound = tripDirection(direction) === 'outbound'
  return (
    <Badge
      style={{
        background: 'var(--c-bg-sunken)',
        borderColor: 'var(--c-border)',
        color: 'var(--c-text-muted)',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <Icon
          name={outbound ? 'truckOut' : 'truckIn'}
          size={16}
          style={{ color: outbound ? 'var(--c-info)' : 'var(--c-success)' }}
        />
        {outbound ? 'Отгрузка' : 'Поступление'}
      </span>
    </Badge>
  )
}

export function TripsListFeature() {
  const navigate = useNavigate()
  const { carriers } = useLookups()
  const { user } = useCurrentUser()
  const showCosts = canViewCosts(user)

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
      eta_from: from || undefined,
      eta_to: to || undefined,
    }, signal),
    [typeFilter, group, carrier, from, to, page],
  )
  const trips: TripListItem[] = data?.items ?? []
  const total = data?.total ?? 0
  const colCount = showCosts ? 9 : 7

  const { data: activeData } = useApi((signal) => getTrips({ direction: typeFilter || undefined, statuses: ACTIVE, limit: 1 }, signal), [typeFilter])
  const { data: queueData } = useApi((signal) => getTrips({ direction: typeFilter || undefined, statuses: IN_QUEUE, limit: 1 }, signal), [typeFilter])

  return (
    <ListPage
      title="Рейсы"
      subtitle="Транспортные рейсы поступлений и отгрузок"
      actions={
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
      }
    >
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <KPI label="Активных рейсов" value={activeData ? activeData.total : '…'} />
        <KPI label="В очереди склада" value={queueData ? queueData.total : '…'} />
        <KPI label="Простой за период" value="—" />
        <KPI label="Ср. обработка" value="—" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {GROUPS.map((g) => (
          <Chip key={g.id} active={group === g.id} onClick={() => setGroup(g.id)}>{g.label}</Chip>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <FilterSelect
            label="Тип"
            value={typeFilter}
            options={TYPE_OPTIONS}
            onChange={(v) => setType(v)}
          />
          <FilterSelect
            label="Перевозчик"
            value={carrier}
            options={[{ value: '', label: 'Все перевозчики' }, ...carriers.map((c) => ({ value: c.id, label: c.name }))]}
            onChange={(v) => setCarrier(v)}
          />
          <DateRange
            from={from} to={to}
            onFromChange={(v) => setFrom(v)}
            onToChange={(v) => setTo(v)}
            onClear={() => setMany({ from: '', to: '' })}
          />
        </div>
      </div>

      <Table>
        <thead>
          <tr>
            <th style={{ width: 130 }}>Тип</th>
            <th style={{ width: 120 }}>Номер</th>
            <th style={{ width: 170 }}>Статус</th>
            <th>Маршрут</th>
            <th style={{ width: 160 }}>Перевозчик</th>
            <th style={{ textAlign: 'right', width: 90 }}>Строки</th>
            <th style={{ width: 130 }}>План</th>
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
            trips.map((t) => {
              const direction = tripDirection(t.direction)
              return (
                <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/logistics/trips/${t.id}`)}>
                  <Td><TypeBadge direction={direction} /></Td>
                  <Td className="mono" style={{ fontWeight: 500 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {t.trip_number}
                      {direction === 'outbound' && t.cargo_type === 'defect' && <Badge tone="warning">Брак</Badge>}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={tripStatusTone(t.status) as BadgeTone} dot>{tripStatusLabel(t.status, direction)}</Badge>
                  </Td>
                  <Td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <Icon name={direction === 'outbound' ? 'truckOut' : 'truckIn'} size={14} style={{ color: 'var(--c-text-subtle)', flexShrink: 0 }} />
                      {t.origin_name ?? '—'}
                    </span>
                  </Td>
                  <Td className="t-sub">{t.carrier_name ?? '—'}</Td>
                  <Td className="num">{t.receipts_count}</Td>
                  <Td><EtaCell eta={t.eta} /></Td>
                  {showCosts && <Td className="num">{fmtMoney(t.cost_estimate)}</Td>}
                  {showCosts && <Td className="num">{fmtMoney(t.logistics_cost_actual)}</Td>}
                </tr>
              )
            })
          )}
        </tbody>
      </Table>

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
    </ListPage>
  )
}
