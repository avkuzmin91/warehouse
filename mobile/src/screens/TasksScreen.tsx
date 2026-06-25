import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useNav } from '../nav/NavContext'
import { ROLE_LABELS } from '../api/authApi'
import { getTasks, type TaskItem } from '../api/tasksApi'
import { fmtEta, tripEtaLabel, type TripDirection } from '../api/tripsApi'
import { AppBar } from '../components/AppBar'
import { Icon, type IconName } from '../components/Icon'
import { PullToRefresh } from '../components/PullToRefresh'
import { fmtDateTime } from '../utils/format'

function sinceLabel(since?: string | null): string {
  return fmtDateTime(since, '')
}

// Иконка + тон плитки по типу задачи (визуальный язык редизайна).
function taskVisual(kind: string, direction?: string | null): { icon: IconName; tone: string } {
  if (kind === 'shipment_move_in') return { icon: 'box', tone: 'amber' }
  if (kind === 'shipment_relocate') return { icon: 'layers', tone: 'blue' }
  if (kind === 'shipment_defect_prepare') return { icon: 'box', tone: 'gray' }
  if (kind.startsWith('shipment')) return { icon: 'box', tone: 'gray' }
  if (kind.startsWith('trip')) return direction === 'outbound' ? { icon: 'truckOut', tone: 'green' } : { icon: 'truckIn', tone: '' }
  if (kind.startsWith('receipt')) return { icon: 'truckIn', tone: '' }
  return { icon: 'list', tone: 'gray' }
}

export function TasksScreen() {
  const { user } = useAuth()
  const { openTrip, openShipment } = useNav()
  const [items, setItems] = useState<TaskItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback((signal?: AbortSignal, silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    return getTasks(100, signal)
      .then((r) => {
        if (signal?.aborted) return
        setItems(r.items)
        setTotal(r.total)
      })
      .catch((err) => {
        if (signal?.aborted) return
        setError(err instanceof Error ? err.message : 'Не удалось загрузить задачи')
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

  const role = user ? ROLE_LABELS[user.role] ?? user.role : ''

  return (
    <div className="screen">
      <AppBar title="Мои задачи" sub={role} />

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
            <div>Загрузка задач…</div>
          </div>
        ) : items.length === 0 && !error ? (
          <div className="center">
            <div className="center-ico green">
              <Icon name="check" size={26} />
            </div>
            <div>Активных задач нет</div>
          </div>
        ) : (
          <>
            <div className="sec">
              Активные
              <span className="sec-count">{items.length} задач</span>
            </div>
            {items.map((t) => {
              const actionable = t.doc_type === 'trip' || t.doc_type === 'shipment'
              const { icon, tone } = taskVisual(t.kind, t.direction)
              const urgent = t.priority_rank != null && t.priority_rank > 0
              const open = () => {
                if (t.doc_type === 'trip') openTrip(t.doc_id)
                else if (t.doc_type === 'shipment') openShipment(t.doc_id)
              }
              return (
                <button
                  key={`${t.doc_type}:${t.doc_id}:${t.kind}`}
                  className="tile"
                  onClick={open}
                  disabled={!actionable}
                >
                  <div className={`tile-ico${tone ? ' ' + tone : ''}`}>
                    <Icon name={icon} size={21} />
                  </div>
                  <div className="tile-body">
                    <div className="tile-title">{t.title}</div>
                    <div className="tile-meta">
                      {t.doc_number}
                      {t.since ? ` · ${sinceLabel(t.since)}` : ''}
                    </div>
                    {t.doc_type === 'trip' && (fmtEta(t.eta) || t.vehicle_number) && (
                      <div className={`tile-meta tile-eta${t.kind === 'trip_cost' ? ' muted' : ''}`}>
                        {fmtEta(t.eta) && (
                          <>
                            <Icon name="clock" size={13} />
                            {tripEtaLabel((t.direction as TripDirection) ?? 'inbound')} {fmtEta(t.eta)}
                          </>
                        )}
                        {fmtEta(t.eta) && t.vehicle_number && <span className="tile-eta-sep">·</span>}
                        {t.vehicle_number && (
                          <span className="tile-plate">
                            <Icon name="truckIn" size={13} />
                            {t.vehicle_number}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {urgent ? (
                    <span className="badge danger">
                      <span className="dot" />
                      Срочно
                    </span>
                  ) : !actionable ? (
                    <span className="badge">
                      <span className="dot" />
                      Скоро
                    </span>
                  ) : null}
                  {actionable && (
                    <span className="tile-chev">
                      <Icon name="chev" size={18} />
                    </span>
                  )}
                </button>
              )
            })}
            {items.length < total && (
              <div className="line-sub" style={{ textAlign: 'center', padding: '12px 0' }}>
                Показаны первые {items.length} из {total}
              </div>
            )}
          </>
        )}
      </PullToRefresh>
    </div>
  )
}
