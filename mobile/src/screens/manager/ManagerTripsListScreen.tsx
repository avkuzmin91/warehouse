import { useCallback, useEffect, useState } from 'react'
import { useNav } from '../../nav/NavContext'
import {
  getTrips,
  fmtEta,
  tripStatusLabel,
  tripStatusTone,
  type TripDirection,
  type TripListItem,
} from '../../api/tripsApi'
import { AppBar } from '../../components/AppBar'
import { Icon } from '../../components/Icon'
import { PullToRefresh } from '../../components/PullToRefresh'

type Filter = 'all' | TripDirection

export function ManagerTripsListScreen() {
  const { openManagerTrip, openTripNew } = useNav()
  const [filter, setFilter] = useState<Filter>('all')
  const [items, setItems] = useState<TripListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback((signal?: AbortSignal, silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    return getTrips({ limit: 100, direction: filter === 'all' ? undefined : filter }, signal)
      .then((r) => setItems(r.items))
      .catch((err) => {
        if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить рейсы')
      })
      .finally(() => {
        if (!signal?.aborted) setLoading(false)
      })
  }, [filter])

  useEffect(() => {
    const ac = new AbortController()
    load(ac.signal)
    return () => ac.abort()
  }, [load])

  return (
    <div className="screen">
      <AppBar title="Рейсы" sub="Приёмка и отгрузка" />
      <PullToRefresh className="scroll pad-nav" onRefresh={() => load(undefined, true)}>
        <button className="btn" style={{ width: '100%', marginBottom: 12 }} onClick={openTripNew}>
          <Icon name="plus" size={16} /> Новый рейс
        </button>

        <div className="seg" style={{ marginBottom: 12 }}>
          <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Все</button>
          <button type="button" className={filter === 'inbound' ? 'active' : ''} onClick={() => setFilter('inbound')}>Приёмка</button>
          <button type="button" className={filter === 'outbound' ? 'active' : ''} onClick={() => setFilter('outbound')}>Отгрузка</button>
        </div>

        {error && (
          <div className="alert">
            <Icon name="alert" size={15} />
            {error}
          </div>
        )}

        {loading ? (
          <div className="center">
            <div className="spin" />
            <div>Загрузка…</div>
          </div>
        ) : items.length === 0 ? (
          <div className="center">
            <div className="center-ico">
              <Icon name="truck" size={26} />
            </div>
            <div>Нет рейсов</div>
          </div>
        ) : (
          <>
            <div className="sec">
              Все рейсы
              <span className="sec-count">{items.length}</span>
            </div>
            {items.map((t) => {
              const outbound = t.direction === 'outbound'
              const eta = fmtEta(t.eta)
              const tone = tripStatusTone(t.status)
              return (
                <button key={t.id} className="tile" onClick={() => openManagerTrip(t.id)}>
                  <div className={`tile-ico${outbound ? ' green' : ''}`}>
                    <Icon name={outbound ? 'truckOut' : 'truckIn'} size={21} />
                  </div>
                  <div className="tile-body">
                    <div className="tile-title">
                      {t.trip_number} · {outbound ? 'Отгрузка' : 'Приёмка'}
                      {outbound && t.cargo_type === 'defect' ? ' · брак' : ''}
                    </div>
                    <div className="tile-meta">
                      {t.client_names.length ? t.client_names.join(', ') : 'Без клиентов'}
                      {t.items_qty ? ` · ${t.items_qty} шт` : ''}
                      {eta ? ` · ${eta}` : ''}
                    </div>
                  </div>
                  {tone && (
                    <span className={`badge ${tone}`}>
                      <span className="dot" />
                      {tripStatusLabel(t.status, t.direction)}
                    </span>
                  )}
                  <span className="tile-chev">
                    <Icon name="chev" size={18} />
                  </span>
                </button>
              )
            })}
          </>
        )}
      </PullToRefresh>
    </div>
  )
}
