import { useNavigate } from 'react-router-dom'
import { getTrips, TRIP_STATUS_LABELS, tripStatusTone } from '../../../api/tripsApi'
import type { TripListItem, TripStatus } from '../../../api/tripsApi'
import { ListPage } from '../../layouts/ListPage'
import { Table, Td } from '../../data/Table'
import { FilterSelect } from '../../data/FiltersBar'
import { DateRange } from '../../data/DateRange'
import { KPI } from '../../primitives/KPI'
import { Badge } from '../../primitives/Badge'
import type { BadgeTone } from '../../primitives/Badge'
import { Icon } from '../../primitives/Icon'
import type { IconName } from '../../primitives/Icon'
import { SkeletonRows } from '../../primitives/Skeleton'
import { EmptyState } from '../../primitives/EmptyState'
import { useApi } from '../../../hooks/useApi'
import { useLookups } from '../../../hooks/useLookups'
import { useFilterParam, useFilterParamsActions } from '../../../hooks/useFilterParams'

const ACTIVE: TripStatus[] = ['draft', 'awaiting_arrival', 'unloading', 'costing']
const IN_QUEUE: TripStatus[] = ['awaiting_arrival', 'unloading']

const GROUPS: { id: string; label: string; statuses: TripStatus[] }[] = [
  { id: 'all', label: 'Все', statuses: [] },
  { id: 'draft', label: 'Черновики', statuses: ['draft'] },
  { id: 'warehouse', label: 'На складе', statuses: ['awaiting_arrival', 'unloading'] },
  { id: 'costing', label: 'Уточнение', statuses: ['costing'] },
  { id: 'closed', label: 'Закрыты', statuses: ['closed', 'cancelled'] },
]

function vehicleIcon(name: string | null): IconName {
  const n = (name ?? '').toLowerCase()
  if (n.includes('реф')) return 'snow'
  if (n.includes('изотерм')) return 'box'
  if (n.includes('борт')) return 'truckOut'
  return 'truckIn'
}

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

export function TripsListFeature() {
  const navigate = useNavigate()
  const { carriers } = useLookups()

  const [group, setGroup] = useFilterParam('group', 'all')
  const [carrier, setCarrier] = useFilterParam('carrier', '')
  const [from, setFrom] = useFilterParam('from', '')
  const [to, setTo] = useFilterParam('to', '')
  const { setMany } = useFilterParamsActions()

  const { data, loading } = useApi((signal) => getTrips({ limit: 200 }, signal), [])
  const trips: TripListItem[] = data?.items ?? []

  const kpiActive = trips.filter((t) => ACTIVE.includes(t.status)).length
  const kpiQueue = trips.filter((t) => IN_QUEUE.includes(t.status)).length

  const groupDef = GROUPS.find((g) => g.id === group) ?? GROUPS[0]
  const filtered = trips.filter((t) => {
    if (groupDef.statuses.length && !groupDef.statuses.includes(t.status)) return false
    if (carrier && (t.carrier_name ?? '') !== carrier) return false
    const etaDay = t.eta ? t.eta.slice(0, 10) : ''
    if (from && (!etaDay || etaDay < from)) return false
    if (to && (!etaDay || etaDay > to)) return false
    return true
  })

  return (
    <ListPage
      title="Рейсы"
      subtitle="Транспортные поездки на склад · поступления"
      actions={
        <button className="btn primary" onClick={() => navigate('/logistics/trips/new')}>
          <Icon name="plus" size={14} />Новый рейс
        </button>
      }
    >
      {/* KPI-полоса */}
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <KPI label="Активных рейсов" value={loading ? '…' : kpiActive} />
        <KPI label="В очереди склада" value={loading ? '…' : kpiQueue} />
        <KPI label="Простой за период" value="—" />
        <KPI label="Ср. разгрузка" value="—" />
      </div>

      {/* Фильтры */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {GROUPS.map((g) => (
          <Chip key={g.id} active={group === g.id} onClick={() => setGroup(g.id)}>{g.label}</Chip>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <FilterSelect
            label="Перевозчик"
            value={carrier}
            options={[{ value: '', label: 'Все перевозчики' }, ...carriers.map((c) => ({ value: c.name, label: c.name }))]}
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
            <th style={{ width: 120 }}>Номер</th>
            <th style={{ width: 170 }}>Статус</th>
            <th>Откуда</th>
            <th style={{ width: 160 }}>Перевозчик</th>
            <th style={{ textAlign: 'right', width: 64 }}>Кли.</th>
            <th style={{ textAlign: 'right', width: 70 }}>Пост.</th>
            <th style={{ width: 130 }}>План. прибытие</th>
            <th style={{ textAlign: 'right', width: 90 }}>План ₽</th>
            <th style={{ textAlign: 'right', width: 90 }}>Факт ₽</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <SkeletonRows rows={8} cols={9} />
          ) : filtered.length === 0 ? (
            <tr><td colSpan={9}><EmptyState title="Рейсов нет" sub={group === 'all' ? 'Создайте первый рейс' : undefined} /></td></tr>
          ) : (
            filtered.map((t) => (
              <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/logistics/trips/${t.id}`)}>
                <Td className="mono" style={{ fontWeight: 500 }}>{t.trip_number}</Td>
                <Td>
                  <Badge tone={tripStatusTone(t.status) as BadgeTone} dot>{TRIP_STATUS_LABELS[t.status]}</Badge>
                </Td>
                <Td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Icon name={vehicleIcon(t.vehicle_type_name)} size={14} style={{ color: 'var(--c-text-subtle)', flexShrink: 0 }} />
                    {t.origin_name ?? '—'}
                  </span>
                </Td>
                <Td className="t-sub">{t.carrier_name ?? '—'}</Td>
                <Td className="num">—</Td>
                <Td className="num">{t.receipts_count}</Td>
                <Td><EtaCell eta={t.eta} /></Td>
                <Td className="num">{fmtMoney(t.cost_estimate)}</Td>
                <Td className="num">{fmtMoney(t.logistics_cost_actual)}</Td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
    </ListPage>
  )
}
