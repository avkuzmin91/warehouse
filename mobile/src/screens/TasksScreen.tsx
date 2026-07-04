import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useNav } from '../nav/NavContext'
import { ROLE_LABELS } from '../api/authApi'
import { getTasks, markAllTasksRead, markTaskRead, type TaskItem } from '../api/tasksApi'
import { fmtEta, tripEtaLabel, type TripDirection } from '../api/tripsApi'
import { getDashboardToday, type DashboardTodayStats } from '../api/dashboardApi'
import { AppBar } from '../components/AppBar'
import { Icon, type IconName } from '../components/Icon'
import { LoadMore } from '../components/LoadMore'
import { PullToRefresh } from '../components/PullToRefresh'
import { useToast } from '../components/Toast'
import { usePagedList } from '../hooks/usePagedList'
import { canCreateDocuments } from '../utils/access'
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
  if (kind.startsWith('dispatch')) return { icon: 'forklift', tone: 'green' }
  if (kind.startsWith('trip')) return direction === 'outbound' ? { icon: 'truckOut', tone: 'green' } : { icon: 'truckIn', tone: '' }
  if (kind.startsWith('receipt')) return { icon: 'truckIn', tone: '' }
  return { icon: 'list', tone: 'gray' }
}

export function TasksScreen() {
  const { user } = useAuth()
  const { openTrip, openShipment, openDispatchPrepare, openPackDoc, openReceiptDoc } = useNav()
  const toast = useToast()
  // Сводка дня — только менеджерский состав (контроль склада со смартфона).
  const isManager = canCreateDocuments(user?.role)
  const [today, setToday] = useState<DashboardTodayStats | null>(null)

  const loadToday = useCallback((signal?: AbortSignal) => {
    if (!isManager) return
    getDashboardToday(signal)
      .then((r) => { if (!signal?.aborted) setToday(r.today) })
      .catch(() => {})
  }, [isManager])

  useEffect(() => {
    const ac = new AbortController()
    loadToday(ac.signal)
    return () => ac.abort()
  }, [loadToday])

  const [unread, setUnread] = useState(0)
  const fetchPage = useCallback(
    (page: number, limit: number, signal?: AbortSignal) =>
      getTasks({ page, limit }, signal).then((r) => {
        if (!signal?.aborted) setUnread(r.unread ?? 0)
        return { ...r, page, limit }
      }),
    [],
  )
  const { items, total, loading, loadingMore, error, refresh, loadMore, hasMore } = usePagedList(fetchPage)

  // Локально прочитанные до перезагрузки списка: тап по задаче / «Прочитать все».
  const [readKeys, setReadKeys] = useState<Set<string>>(new Set())
  const [allRead, setAllRead] = useState(false)
  useEffect(() => { setAllRead(false) }, [items])

  const taskKey = (t: TaskItem) => `${t.kind}:${t.doc_id}`
  const isRead = (t: TaskItem) => allRead || !!t.is_read || readKeys.has(taskKey(t))
  const locallyRead = items.filter((t) => !t.is_read && readKeys.has(taskKey(t))).length
  const unreadCount = allRead ? 0 : Math.max(0, unread - locallyRead)

  const readAll = () => {
    markAllTasksRead().catch(() => {})
    setAllRead(true)
  }

  const role = user ? ROLE_LABELS[user.role] ?? user.role : ''

  return (
    <div className="screen">
      <AppBar title="Мои задачи" sub={role} />

      <PullToRefresh className="scroll pad-nav" onRefresh={() => { loadToday(); return refresh() }}>
        {today && (
          <div className="summary" style={{ marginBottom: 12 }}>
            <div className="kv"><span className="k">Приёмка сегодня</span><span className="v mono">{today.arrivals.fact} / {today.arrivals.plan}</span></div>
            <div className="kv"><span className="k">Упаковано</span><span className="v mono">{today.packed.fact} / {today.packed.plan}</span></div>
            <div className="kv"><span className="k">Отгружено</span><span className="v mono">{today.shipped.fact} / {today.shipped.plan}</span></div>
            {today.defects > 0 && (
              <div className="kv"><span className="k">Брак</span>
                <span className="v"><span className="badge danger"><span className="dot" />{today.defects} шт</span></span>
              </div>
            )}
          </div>
        )}
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
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                <span className="sec-count">
                  {items.length} задач{unreadCount > 0 ? ` · ${unreadCount} новых` : ''}
                </span>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={readAll}
                    style={{
                      background: 'none', border: 0, padding: 0, font: 'inherit', cursor: 'pointer',
                      color: 'var(--c-accent)', fontWeight: 600, letterSpacing: 0, textTransform: 'none',
                    }}
                  >
                    Прочитать все
                  </button>
                )}
              </span>
            </div>
            {items.map((t) => {
              // Задачи по поступлениям (закрыть недопоставку) выполняются на менеджерской
              // деталке поступления — остальным ролям она открывается в режиме просмотра.
              const actionable = t.doc_type === 'trip' || t.doc_type === 'shipment' || t.doc_type === 'dispatch' || t.doc_type === 'receipt'
              const { icon, tone } = taskVisual(t.kind, t.direction)
              const urgent = t.priority_rank != null && t.priority_rank > 0
              const read = isRead(t)
              const open = () => {
                // Тап = прочитано, даже если действие пока заблокировано: задачу увидели.
                if (!read) {
                  markTaskRead(t).catch(() => {})
                  setReadKeys((prev) => new Set(prev).add(taskKey(t)))
                }
                if (!actionable) {
                  // Кнопка живая, но действие ещё заблокировано — объясняем почему.
                  toast('Задача станет доступна после завершения предыдущего этапа', 'error')
                  return
                }
                if (t.doc_type === 'trip') openTrip(t.doc_id)
                // «Упаковать» — внесение годного/брака: экран упаковки, не деталка кладовщика.
                else if (t.kind === 'shipment_pack') openPackDoc(t.doc_id)
                else if (t.doc_type === 'shipment') openShipment(t.doc_id)
                else if (t.doc_type === 'dispatch') openDispatchPrepare(t.doc_id)
                else if (t.doc_type === 'receipt') openReceiptDoc(t.doc_id)
              }
              return (
                <button
                  key={`${t.doc_type}:${t.doc_id}:${t.kind}`}
                  className="tile"
                  onClick={open}
                >
                  <div className={`tile-ico${tone ? ' ' + tone : ''}`}>
                    <Icon name={icon} size={21} />
                  </div>
                  <div className="tile-body">
                    <div className="tile-title" style={read ? { fontWeight: 500 } : undefined}>
                      {!read && (
                        <span style={{
                          display: 'inline-block', width: 7, height: 7, borderRadius: 99,
                          background: 'var(--c-accent)', marginRight: 6, verticalAlign: 'middle',
                        }} />
                      )}
                      {t.title}
                    </div>
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
            <LoadMore
              shown={items.length}
              total={total}
              hasMore={hasMore}
              loadingMore={loadingMore}
              onMore={loadMore}
            />
          </>
        )}
      </PullToRefresh>
    </div>
  )
}
