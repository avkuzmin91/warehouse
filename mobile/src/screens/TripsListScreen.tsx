import { useCallback, useEffect, useState } from 'react'
import { useNav } from '../nav/NavContext'
import { getTrips, fmtEta, tripEtaLabel, TRIP_STATUS_LABELS, type TripListItem } from '../api/tripsApi'
import { AppBar } from '../components/AppBar'
import { Icon } from '../components/Icon'
import { PullToRefresh } from '../components/PullToRefresh'

export function TripsListScreen() {
  const { openTrip } = useNav()
  const [items, setItems] = useState<TripListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback((signal?: AbortSignal, silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    return getTrips({ statuses: ['awaiting_arrival', 'unloading'], limit: 50 }, signal)
      .then((r) => setItems(r.items))
      .catch((err) => {
        if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить рейсы')
      })
      .finally(() => {
        if (!signal?.aborted) setLoading(false)
      })
  }, [])

  useEffect(() => {
    const ac = new AbortController()
    load(ac.signal)
    return () => ac.abort()
  }, [load])

  return (
    <div className="screen">
      <AppBar title="Рейсы" sub="Приёмка и отгрузка" />
      <PullToRefresh className="scroll pad-nav" onRefresh={() => load(undefined, true)}>
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
            <div>Нет рейсов в работе</div>
          </div>
        ) : (
          <>
            <div className="sec">
              В работе
              <span className="sec-count">{items.length}</span>
            </div>
            {items.map((t) => {
              const outbound = t.direction === 'outbound'
              const eta = fmtEta(t.eta)
              return (
                <button key={t.id} className="tile" onClick={() => openTrip(t.id)}>
                  <div className={`tile-ico${outbound ? ' green' : ''}`}>
                    <Icon name="truck" size={21} />
                  </div>
                  <div className="tile-body">
                    <div className="tile-title">
                      {t.trip_number} · {outbound ? 'Отгрузка' : 'Приёмка'}
                    </div>
                    <div className="tile-meta">
                      {TRIP_STATUS_LABELS[t.status]}
                      {t.client_names.length ? ` · ${t.client_names.join(', ')}` : ''}
                      {t.items_qty ? ` · ${t.items_qty} шт` : ''}
                    </div>
                    {(eta || t.vehicle_number) && (
                      <div className="tile-meta tile-eta">
                        {eta && (
                          <>
                            <Icon name="clock" size={13} />
                            {tripEtaLabel(t.direction)} {eta}
                          </>
                        )}
                        {eta && t.vehicle_number && <span className="tile-eta-sep">·</span>}
                        {t.vehicle_number && (
                          <span className="tile-plate">
                            <Icon name="truck" size={13} />
                            {t.vehicle_number}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
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
