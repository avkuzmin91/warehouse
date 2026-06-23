import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getMyTasks, taskLink } from '../../../api/tasksApi'
import type { TaskItem, TaskKind } from '../../../api/tasksApi'
import { isOutbound } from '../../../api/tripsApi'
import { fmtDateTime } from '../logistics/tripDetail/format'
import { shipmentPriorityLabel, shipmentPriorityTone } from '../../../api/shipmentsApi'
import { Badge } from '../../primitives/Badge'
import { Icon } from '../../primitives/Icon'
import type { IconName } from '../../primitives/Icon'
import { useApi } from '../../../hooks/useApi'
import { useCurrentUser } from '../../../hooks/useCurrentUser'

const KIND_ICON: Record<TaskKind, IconName> = {
  trip_arrival: 'truckIn',
  trip_unload: 'forklift',
  trip_cost: 'ruble',
  receipt_intake: 'inbox',
  receipt_review: 'check',
  receipt_close_short: 'alert',
  shipment_accept: 'inbox',
  shipment_move_in: 'forklift',
  shipment_pack: 'boxOut',
  shipment_relocate: 'forklift',
  shipment_defect_prepare: 'forklift',
  dispatch_prepare: 'forklift',
}

const KIND_LABEL: Record<TaskKind, string> = {
  trip_arrival: 'Встретить рейс',
  trip_unload: 'Завершить разгрузку',
  trip_cost: 'Уточнить стоимость',
  receipt_intake: 'Принять товары',
  receipt_review: 'Проверить поступление',
  receipt_close_short: 'Закрыть с недопоставкой',
  shipment_accept: 'Принять в работу',
  shipment_move_in: 'Передать на упаковку',
  shipment_pack: 'Упаковать',
  shipment_relocate: 'Разложить по местам',
  shipment_defect_prepare: 'Подготовить к отгрузке',
  dispatch_prepare: 'Подготовить отгрузку',
}

const STATUS_SUB: Record<string, string> = {
  awaiting_arrival: 'Ожидает прибытия',
  unloading: 'Идёт разгрузка',
  costing: 'Уточнение стоимости',
  on_intake: 'Принят',
  on_review: 'На проверке',
  assigned: 'Ожидает принятия',
  packing: 'В плане',
  on_packing: 'На упаковке',
  relocating: 'Перемещение',
  awaiting_trip: 'Ожидает рейс',
  preparing: 'Подготовка отгрузки',
  partially_received: 'Недопоставка по рейсам',
}

function taskTitle(t: TaskItem): string {
  if (t.kind === 'trip_unload' && isOutbound(t.direction)) return 'Завершить погрузку'
  return KIND_LABEL[t.kind] ?? t.title
}

const DOC_TYPE_SUB: Record<TaskItem['doc_type'], string> = {
  trip: 'Рейс',
  receipt: 'Поступление',
  shipment: 'Задача упаковки',
  dispatch: 'Отгрузка',
}

function taskSub(t: TaskItem): string {
  if (t.status === 'unloading' && isOutbound(t.direction)) return 'Идёт погрузка'
  return STATUS_SUB[t.status] ?? DOC_TYPE_SUB[t.doc_type]
}

const ROLE_LABEL: Record<string, string> = {
  warehouse_manager: 'кладовщик',
  shift_supervisor: 'начальник смены',
  warehouse_head: 'начальник склада',
  manager: 'менеджер',
  admin: 'администратор',
  client: 'клиент',
  user: '—',
}

const TASK_PAGE_SIZE = 7

// Возраст задачи из `since`. Без срока в /tasks «просрочкой» считаем ожидание дольше суток.
function ageInfo(since: string | null): { label: string; overdue: boolean } {
  if (!since) return { label: '', overdue: false }
  const ms = Date.now() - new Date(since).getTime()
  if (Number.isNaN(ms) || ms < 0) return { label: '', overdue: false }
  const mins = Math.floor(ms / 60000)
  if (mins < 5) return { label: 'только что', overdue: false }
  if (mins < 60) return { label: `${mins} мин`, overdue: false }
  const hours = Math.floor(ms / 3_600_000)
  if (hours < 24) return { label: `${hours} ч`, overdue: false }
  return { label: 'просрочено', overdue: true }
}

function isTaskVisibleForRole(task: TaskItem, role: string | undefined): boolean {
  if (role === 'shift_supervisor') {
    return task.doc_type === 'shipment'
  }
  if (role === 'manager') {
    return task.kind === 'trip_cost' || task.kind === 'receipt_close_short'
  }
  if (role === 'warehouse_manager' && task.doc_type === 'receipt' && task.status === 'on_review') {
    return false
  }
  return true
}

export function MyTasksFeature() {
  const navigate = useNavigate()
  const { user } = useCurrentUser()
  const [limit, setLimit] = useState(TASK_PAGE_SIZE)
  const { data, loading } = useApi((signal) => getMyTasks({ limit }, signal), [limit])

  const tasks: TaskItem[] = [...(data?.items ?? [])]
    .filter((task) => isTaskVisibleForRole(task, user?.role))
    .sort((a, b) =>
      (a.priority_rank ?? Infinity) - (b.priority_rank ?? Infinity)
      || (b.since ?? '').localeCompare(a.since ?? ''))
  const roleLabel = ROLE_LABEL[user?.role ?? ''] ?? (user?.role ?? '—')
  const loadedCount = data?.items.length ?? tasks.length
  const totalCount = data?.total ?? loadedCount
  const canLoadMore = loadedCount < totalCount

  return (
    <div>
      <div className="card" style={{ overflow: 'hidden' }}>
        {/* Шапка */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', borderBottom: '1px solid var(--c-border)' }}>
          <Icon name="user" size={16} style={{ color: 'var(--c-accent)' }} />
          <span style={{ fontSize: 15, fontWeight: 600 }}>Сейчас ждёт вас</span>
          {!loading && (
            <span style={{
              minWidth: 22, height: 20, padding: '0 7px', borderRadius: 99, display: 'inline-flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 12, fontWeight: 600, background: 'var(--c-accent-bg)', color: 'var(--c-accent-text)',
            }}>{data?.total ?? tasks.length}</span>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--c-text-subtle)' }}>роль: {roleLabel}</span>
        </div>

        {/* Тело */}
        {loading ? (
          <div className="t-sub" style={{ padding: 18 }}>Загрузка…</div>
        ) : tasks.length === 0 ? (
          <div style={{ padding: '28px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 500 }}>Задач нет</div>
            <div className="t-sub" style={{ marginTop: 4 }}>Здесь появятся рейсы и поступления, ожидающие вашего действия</div>
          </div>
        ) : (
          <>
            {tasks.map((t, i) => {
              const age = ageInfo(t.since)
              return (
                <div
                  key={`${t.doc_type}-${t.doc_id}-${t.kind}`}
                  onClick={() => navigate(taskLink(t))}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', cursor: 'pointer',
                    borderTop: i === 0 ? 'none' : '1px solid var(--c-border)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--c-bg-hover)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
                >
                  <div style={{
                    width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: age.overdue ? 'var(--c-danger-bg)' : 'var(--c-accent-bg)',
                    color: age.overdue ? 'var(--c-danger)' : 'var(--c-accent)',
                  }}>
                    <Icon name={KIND_ICON[t.kind] ?? 'check'} size={19} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ fontSize: 14.5, fontWeight: 600 }}>{taskTitle(t)}</span>
                      <span className="mono" style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>{t.doc_number}</span>
                      {t.priority_rank && (
                        <Badge tone={shipmentPriorityTone(t.priority_rank)}>{shipmentPriorityLabel(t.priority_rank)}</Badge>
                      )}
                    </div>
                    <div className="t-sub" style={{ fontSize: 12.5, marginTop: 1, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span>{taskSub(t)}</span>
                      {t.doc_type === 'trip' && t.eta && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: t.kind === 'trip_cost' ? 'var(--c-text-subtle)' : 'var(--c-accent)', fontWeight: t.kind === 'trip_cost' ? 400 : 500 }}>
                          <Icon name="clock" size={12} />
                          Прибытие {fmtDateTime(t.eta)}
                        </span>
                      )}
                      {t.doc_type === 'trip' && t.vehicle_number && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Icon name="truckIn" size={12} style={{ color: 'var(--c-text-faint)' }} />
                          <span className="mono">{t.vehicle_number}</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: age.overdue ? 600 : 500,
                    color: age.overdue ? 'var(--c-danger)' : 'var(--c-text-subtle)',
                  }}>
                    {age.overdue && <Icon name="alert" size={13} />}{age.label}
                  </span>
                  <Icon name="chev" size={15} style={{ color: 'var(--c-text-faint)', flexShrink: 0 }} />
                </div>
              )
            })}
            {canLoadMore && (
              <div style={{ padding: '10px 16px', borderTop: '1px solid var(--c-border)' }}>
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => setLimit((value) => value + TASK_PAGE_SIZE)}
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  <Icon name="chevDown" size={14} />
                  Показать ещё {Math.min(TASK_PAGE_SIZE, totalCount - loadedCount)}
                </button>
              </div>
            )}
            {limit > TASK_PAGE_SIZE && (
              <div style={{ padding: '0 16px 10px' }}>
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => setLimit(TASK_PAGE_SIZE)}
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  Свернуть до 7
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10, fontSize: 12, color: 'var(--c-text-subtle)' }}>
        <Icon name="layers" size={13} style={{ color: 'var(--c-text-faint)' }} />
        Очередь собрана из рейсов и поступлений по статусу и роли · показано {loadedCount} из {totalCount}.
      </div>
    </div>
  )
}
