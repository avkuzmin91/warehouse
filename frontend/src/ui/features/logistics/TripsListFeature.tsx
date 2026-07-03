import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
import { MOSCOW_TZ, parseMoscow, moscowTodayYmd } from '../../../utils/format'
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
  const d = parseMoscow(eta)
  if (Number.isNaN(d.getTime())) return <span className="mono">{eta}</span>
  return <span className="mono" style={{ fontSize: 12.5 }}>{d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: MOSCOW_TZ })}</span>
}

/** Клиенты рейса: первый + пилюля «+N» при нескольких; полный список — карточкой-списком при наведении.
 *  Список рендерится в портал с position:fixed — иначе overflow:hidden у .t-wrap срезает поповер. */
function ClientsCell({ names }: { names: string[] }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null)

  if (!names || names.length === 0) return <>—</>
  if (names.length === 1) {
    return <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{names[0]}</span>
  }

  const open = () => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 288))
    const placeAbove = window.innerHeight - r.bottom < 220
    setPos(placeAbove
      ? { left, bottom: window.innerHeight - r.top + 6 }
      : { left, top: r.bottom + 6 })
  }

  return (
    <span
      ref={ref}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}
      onMouseEnter={open}
      onMouseLeave={() => setPos(null)}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{names[0]}</span>
      <span style={{
        flexShrink: 0,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1.4,
        padding: '1px 6px',
        borderRadius: 999,
        background: 'var(--c-bg-sunken)',
        color: 'var(--c-text-subtle)',
      }}>+{names.length - 1}</span>
      {pos && createPortal(
        <div style={{
          position: 'fixed',
          left: pos.left,
          top: pos.top,
          bottom: pos.bottom,
          zIndex: 80,
          minWidth: 180,
          maxWidth: 280,
          padding: '5px 0',
          background: 'var(--c-bg-elev)',
          border: '1px solid var(--c-border)',
          borderRadius: 'var(--r-lg)',
          boxShadow: 'var(--sh-2)',
          pointerEvents: 'none',
        }}>
          {names.map((n, i) => (
            <div key={i} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '3px 12px',
              fontSize: 12.5,
              color: 'var(--c-text)',
              whiteSpace: 'nowrap',
            }}>
              <span style={{ width: 4, height: 4, borderRadius: 999, background: 'var(--c-text-subtle)', flexShrink: 0 }} />
              {n}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </span>
  )
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

/** eta — наивная стенная дата Москвы; день берём из литеральных YYYY-MM-DD, без сдвига по поясу. */
function etaYmd(eta: string | null): string | null {
  if (!eta) return null
  const ymd = eta.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null
}

function ymdUtcMs(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function dayKeyOf(eta: string | null): string {
  return etaYmd(eta) ?? 'no-date'
}

function dayLabelOf(eta: string | null, todayYmd: string): string {
  const ymd = etaYmd(eta)
  if (!ymd) return 'Без плановой даты'
  const diffDays = Math.round((ymdUtcMs(ymd) - ymdUtcMs(todayYmd)) / 86_400_000)
  const rel = diffDays === 0 ? 'Сегодня' : diffDays === 1 ? 'Завтра' : diffDays === -1 ? 'Вчера' : null
  const d = parseMoscow(eta!)
  const date = d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', timeZone: MOSCOW_TZ })
  const weekday = d.toLocaleDateString('ru-RU', { weekday: 'long', timeZone: MOSCOW_TZ })
  return rel ? `${rel} · ${date} · ${weekday}` : `${date} · ${weekday}`
}

/** Группировка рейсов по плановому дню; внутри дня — сначала отгрузки, затем поступления.
 *  Порядок дней наследуется из выдачи backend (eta DESC, no-date в конце). */
function groupTripsByDay(trips: TripListItem[], todayYmd: string): TripDayGroup[] {
  const map = new Map<string, TripDayGroup>()
  for (const t of trips) {
    const key = dayKeyOf(t.eta)
    let g = map.get(key)
    if (!g) {
      g = { key, label: dayLabelOf(t.eta, todayYmd), outCount: 0, inCount: 0, rows: [] }
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
  const { carriers, clients } = useLookups()
  const { user } = useCurrentUser()
  const showCosts = canViewCosts(user)
  const canCreate = canCreateDocuments(user)

  const [search, setSearch] = useFilterParam('search', '')
  const [typeRaw, setType] = useFilterParam('type', '')
  const typeFilter: '' | TripDirection = typeRaw === 'outbound' || typeRaw === 'inbound' ? typeRaw : ''
  const [group, setGroup] = useFilterParam('group', 'all')
  const [carrier, setCarrier] = useFilterParam('carrier', '')
  const [client, setClient] = useFilterParam('client', '')
  const [from, setFrom] = useFilterParam('from', '')
  const [to, setTo] = useFilterParam('to', '')
  const [page, setPage] = usePageParam()
  const { setMany } = useFilterParamsActions()

  // Debounce поиска: инпут меняется мгновенно, URL и запрос — после паузы.
  // Sync-эффект подхватывает внешнюю смену URL («Сбросить», «Назад»).
  const [searchInput, setSearchInput] = useState(search)
  useEffect(() => { setSearchInput(search) }, [search])
  useEffect(() => {
    if (searchInput === search) return
    const timer = setTimeout(() => setSearch(searchInput), 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, search])

  const groupDef = GROUPS.find((g) => g.id === group) ?? GROUPS[0]
  const statuses = groupDef.statuses.length ? groupDef.statuses : undefined

  const { data, loading } = useApi(
    (signal) => getTrips({
      page,
      limit: PAGE_SIZE,
      direction: typeFilter || undefined,
      statuses,
      carrier_id: carrier || undefined,
      client_id: client || undefined,
      search: search.trim() || undefined,
      eta_from: from || undefined,
      eta_to: to || undefined,
    }, signal),
    [typeFilter, group, carrier, client, search, from, to, page],
  )
  const trips: TripListItem[] = data?.items ?? []
  const total = data?.total ?? 0
  const colCount = showCosts ? 10 : 8
  const dayGroups = useMemo(() => groupTripsByDay(trips, moscowTodayYmd()), [trips])

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
              style={{ paddingLeft: 28, width: 240, paddingRight: searchInput ? 26 : undefined }}
              placeholder="Номер, маршрут, SKU, товар…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            {searchInput && (
              <button
                style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'var(--c-text-subtle)' }}
                onClick={() => { setSearchInput(''); setSearch('') }}
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
            label="Клиент"
            value={client}
            options={[{ value: '', label: 'Все клиенты' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
            onChange={(v) => setClient(v)}
            placeholder="Поиск клиента…"
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
          {(typeFilter || carrier || client || from || to || search || group !== 'all') && (
            <button className="btn ghost sm" onClick={() => setMany({ type: '', carrier: '', client: '', from: '', to: '', search: '', group: '' })}>
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
            <th style={{ width: 200 }}>Клиенты</th>
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
                        {t.vehicle_number && (
                          <div className="t-sub" style={{ fontSize: 11.5, fontWeight: 400, marginTop: 2 }}>{t.vehicle_number}</div>
                        )}
                      </Td>
                      <Td><TimeCell eta={t.eta} /></Td>
                      <Td>
                        <Badge tone={tripStatusTone(t.status) as BadgeTone} dot>{tripStatusLabel(t.status, direction)}</Badge>
                      </Td>
                      <Td>{t.origin_name ?? '—'}</Td>
                      <Td className="t-sub"><ClientsCell names={t.client_names} /></Td>
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
