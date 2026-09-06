import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getMpAccounts,
  getMpSupplyBoard,
  MARKETPLACE_LABELS,
  marketplaceTone,
  MP_SUPPLY_STATUS_LABELS,
  mpSupplyStatusTone,
} from '../../../../api/marketplacesApi'
import type { MpFreePoolItem, MpSupplyBoardItem } from '../../../../api/marketplacesApi'
import { ListPage } from '../../../layouts/ListPage'
import { FiltersBar, FilterSelect, FilterCombobox } from '../../../data/FiltersBar'
import { Badge } from '../../../primitives/Badge'
import { Icon } from '../../../primitives/Icon'
import { EmptyState } from '../../../primitives/EmptyState'
import { SkeletonRows } from '../../../primitives/Skeleton'
import { useApi } from '../../../../hooks/useApi'
import { useLookups } from '../../../../hooks/useLookups'
import { useFilterParam, useFilterParamsActions } from '../../../../hooks/useFilterParams'
import { cutoffCountdown, cutoffTime, groupIntoWaves } from './waves'

const MARKETPLACE_OPTIONS = [
  { value: '', label: 'Все маркетплейсы' },
  { value: 'ozon', label: MARKETPLACE_LABELS.ozon },
  { value: 'wb', label: MARKETPLACE_LABELS.wb },
]

/** Доска отгрузок FBS — главный экран менеджера.
 *  Карточка = кабинет × отсечка: площадка не примет поставку с заказами двух
 *  продавцов, поэтому кабинет здесь объект, а не значение фильтра. */
export function MpSupplyBoardFeature() {
  const navigate = useNavigate()
  const { clients } = useLookups()
  const [clientId, setClientId] = useFilterParam('client', '')
  const [marketplace, setMarketplace] = useFilterParam('mp', '')
  const [accountId, setAccountId] = useFilterParam('account', '')
  const { setMany } = useFilterParamsActions()
  const [tick, setTick] = useState(0)

  const { data: accountsData } = useApi((s) => getMpAccounts(s), [])
  const accounts = accountsData?.items ?? []

  const { data, loading, error } = useApi(
    (signal) => getMpSupplyBoard({
      client_id: clientId || undefined,
      marketplace: marketplace || undefined,
      account_id: accountId || undefined,
    }, signal),
    [clientId, marketplace, accountId, tick],
  )

  const items = data?.items ?? []
  const waves = groupIntoWaves(items)
  const freePool = data?.free_pool ?? []
  const counters = data?.counters

  return (
    <ListPage
      title="Отгрузки FBS"
      subtitle="Поставка = отгрузка маркетплейсу: поток заказов кабинета делится на столько поставок, на сколько удобно складу"
      actions={
        <button className="btn ghost sm" onClick={() => setTick((n) => n + 1)}>
          <Icon name="refresh" size={13} />Обновить
        </button>
      }
      filters={
        <FiltersBar>
          <FilterCombobox
            label="Клиент"
            value={clientId}
            options={[{ value: '', label: 'Все клиенты' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
            onChange={setClientId}
            placeholder="Поиск клиента…"
          />
          <FilterSelect label="Маркетплейс" value={marketplace} options={MARKETPLACE_OPTIONS} onChange={setMarketplace} />
          <FilterSelect
            label="Кабинет"
            value={accountId}
            options={[{ value: '', label: 'Все кабинеты' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
            onChange={setAccountId}
          />
          {(clientId || marketplace || accountId) && (
            <button className="btn ghost sm" onClick={() => setMany({ client: '', mp: '', account: '' })}>
              <Icon name="x" size={12} />Сбросить
            </button>
          )}
          {counters && (
            <div className="row gap-8" style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--c-text-subtle)' }}>
              <span>Поставок: <b style={{ color: 'var(--c-text)' }}>{counters.supplies}</b></span>
              <span>Заказов: <b style={{ color: 'var(--c-text)' }}>{counters.orders}</b></span>
              <span>Просрочено: <b style={{ color: counters.overdue > 0 ? 'var(--c-danger)' : 'var(--c-text)' }}>{counters.overdue}</b></span>
              <span>Свободных: <b style={{ color: 'var(--c-text)' }}>{counters.free_orders}</b></span>
            </div>
          )}
        </FiltersBar>
      }
    >
      {loading ? (
        <table className="table"><tbody><SkeletonRows rows={6} cols={1} /></tbody></table>
      ) : error ? (
        <EmptyState title="Не удалось загрузить" sub={error.message} />
      ) : waves.length === 0 && freePool.length === 0 ? (
        <EmptyState
          title="Поставок нет"
          sub="Заказы кабинетов приходят в свободный пул — поставку из них заводит менеджер кнопкой «Новая поставка»."
        />
      ) : (
        <>
        {freePool.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '6px 2px 8px',
              borderBottom: '1px solid var(--c-border)', marginBottom: 8,
            }}>
              <span style={{
                fontSize: 13, fontWeight: 600,
                color: alarmed(freePool) ? 'var(--c-danger)' : 'var(--c-text)',
              }}>Свободные заказы</span>
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
                {freePool.reduce((n, p) => n + p.orders_count, 0)} заказов ждут поставки
              </span>
            </div>
            {freePool.map((account) => (
              <FreePoolCard
                key={account.account_id}
                pool={account}
                onCreate={() => navigate(`/marketplaces/supplies/new?account=${account.account_id}`)}
              />
            ))}
          </div>
        )}
        {waves.map((wave) => (
          <div key={wave.key} style={{ marginBottom: 18 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '6px 2px 8px',
              borderBottom: '1px solid var(--c-border)', marginBottom: 8,
            }}>
              <span style={{
                fontSize: 13, fontWeight: 600,
                color: wave.late ? 'var(--c-danger)' : 'var(--c-text)',
              }}>{wave.title}</span>
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
                {wave.items.length} поставок · {wave.items.reduce((n, i) => n + i.orders_total, 0)} заказов
              </span>
            </div>
            {wave.items.map((item) => (
              <SupplyCard
                key={item.id}
                item={item}
                onOpen={() => navigate(`/marketplaces/supplies/${item.id}`)}
              />
            ))}
          </div>
        ))}
        </>
      )}
    </ListPage>
  )
}

function alarmed(pool: MpFreePoolItem[]): boolean {
  return pool.some((p) => p.overdue_count > 0 || p.urgent_count > 0)
}

/** Пул кабинета: заказы, не занятые ни одной поставкой. Поставки заводит
 *  менеджер, поэтому пул — не аномалия, а рабочая очередь; система за него
 *  ничего не собирает и вместо этого показывает, что горит. */
function FreePoolCard({ pool, onCreate }: { pool: MpFreePoolItem; onCreate: () => void }) {
  const rail = pool.marketplace === 'ozon' ? 'var(--c-info)' : 'var(--c-accent)'
  const hot = pool.overdue_count > 0 || pool.urgent_count > 0
  return (
    <div style={{
      position: 'relative', overflow: 'hidden',
      display: 'grid', gridTemplateColumns: '4px minmax(220px, 1fr) 150px 160px auto',
      alignItems: 'center', gap: '0 14px', marginBottom: 6, padding: '11px 14px 11px 0',
      background: 'var(--c-bg-elev)', borderRadius: 'var(--r-lg)',
      border: `1px ${hot ? 'solid var(--c-danger-bg)' : 'dashed var(--c-border)'}`,
    }}>
      <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: rail }} />
      <span />
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.006em' }}>{pool.account_name}</span>
          <Badge tone={marketplaceTone(pool.marketplace)}>{MARKETPLACE_LABELS[pool.marketplace]}</Badge>
          {pool.overdue_count > 0 && <Badge tone="danger">просрочено: {pool.overdue_count}</Badge>}
          {pool.urgent_count > 0 && <Badge tone="warning">горит: {pool.urgent_count}</Badge>}
        </div>
        <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginTop: 1 }}>{pool.client_name ?? '—'}</div>
      </div>
      <div className="num" style={{ fontSize: 12.5, color: 'var(--c-text-muted)' }}>
        <b style={{ display: 'block', fontSize: 15, color: 'var(--c-text)', fontWeight: 600 }}>{pool.orders_count}</b>
        заказов · {pool.total_qty} шт.
      </div>
      <div className="num">
        <div style={{
          fontSize: 14, fontWeight: 600,
          color: hot ? 'var(--c-danger)' : 'var(--c-text-muted)',
        }}>{cutoffTime(pool.earliest_deadline_at)}</div>
        <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
          ближайший дедлайн {cutoffCountdown(pool.earliest_deadline_at)}
        </div>
      </div>
      <div style={{ justifySelf: 'end', paddingLeft: 6 }}>
        <button className="btn primary sm" onClick={onCreate}>Новая поставка</button>
      </div>
    </div>
  )
}

/** Прогресс на карточке — по фазе: до сборки покрытие остатком, на сборке штуки с полок,
 *  на упаковке и передаче — заказы с этикеткой. */
function progress(item: MpSupplyBoardItem): { label: string; ratio: number } {
  if (item.orders_total === 0) return { label: 'Состав пуст', ratio: 0 }
  if (item.status === 'picking') {
    return { label: `Собрано ${item.picked_qty} из ${item.total_qty} шт.`, ratio: item.total_qty > 0 ? item.picked_qty / item.total_qty : 0 }
  }
  if (item.status === 'packing' || item.status === 'handover') {
    return { label: `Упаковано ${item.orders_packed} из ${item.orders_total}`, ratio: item.orders_packed / item.orders_total }
  }
  if (item.orders_ready === item.orders_total) return { label: 'Покрытие 100%', ratio: 1 }
  return { label: `Соберётся ${item.orders_ready} из ${item.orders_total}`, ratio: item.orders_ready / item.orders_total }
}

function SupplyCard({ item, onOpen }: { item: MpSupplyBoardItem; onOpen: () => void }) {
  const { label: progressLabel, ratio } = progress(item)
  const rail = item.marketplace === 'ozon' ? 'var(--c-info)' : 'var(--c-accent)'
  return (
    <div
      onClick={onOpen}
      style={{
        position: 'relative', overflow: 'hidden', cursor: 'pointer',
        display: 'grid', gridTemplateColumns: '4px minmax(220px, 1fr) 150px 140px 170px auto',
        alignItems: 'center', gap: '0 14px', marginBottom: 6, padding: '11px 14px 11px 0',
        background: 'var(--c-bg-elev)', borderRadius: 'var(--r-lg)',
        border: `1px solid ${item.overdue ? 'var(--c-danger-bg)' : 'var(--c-border)'}`,
      }}
    >
      <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: rail }} />
      <span />
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.006em' }}>{item.account_name}</span>
          <Badge tone={marketplaceTone(item.marketplace)}>{MARKETPLACE_LABELS[item.marketplace]}</Badge>
          <span className="mono" style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>{item.doc_number}</span>
          <Badge tone={mpSupplyStatusTone(item.status)}>{MP_SUPPLY_STATUS_LABELS[item.status]}</Badge>
          {item.overdue && <Badge tone="danger">просрочено</Badge>}
          {item.orders_pending > 0 && <Badge tone="success">+{item.orders_pending} новых</Badge>}
          {item.unlinked_positions > 0 && <Badge tone="warning">{item.unlinked_positions} не связано</Badge>}
          {item.shortage_positions > 0 && <Badge tone="danger">нет остатка: {item.shortage_positions} поз.</Badge>}
          {item.orders_cancelled > 0 && <Badge tone="danger">отменено: {item.orders_cancelled}</Badge>}
          {item.orders_cancelled_held > 0 && (
            <Badge tone="danger">отменено после передачи: {item.orders_cancelled_held}</Badge>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginTop: 1 }}>{item.client_name ?? '—'}</div>
        {item.orders_total === 0 && item.orders_cancelled > 0 && (
          <div style={{ fontSize: 12, color: 'var(--c-danger)', marginTop: 2 }}>
            Состав опустел из-за отмен — аннулируйте поставку
          </div>
        )}
      </div>
      <div className="num" style={{ fontSize: 12.5, color: 'var(--c-text-muted)' }}>
        <b style={{ display: 'block', fontSize: 15, color: 'var(--c-text)', fontWeight: 600 }}>{item.orders_total}</b>
        заказов · {item.positions} поз. · {item.total_qty} шт.
      </div>
      <div className="num">
        <div style={{
          fontSize: 14, fontWeight: 600,
          color: item.overdue ? 'var(--c-danger)' : 'var(--c-warning)',
        }}>{cutoffTime(item.cutoff_at)}</div>
        <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>{cutoffCountdown(item.cutoff_at)}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <span className="num" style={{ fontSize: 11.5, color: 'var(--c-text-muted)' }}>{progressLabel}</span>
        <span style={{ display: 'flex', height: 5, borderRadius: 3, background: 'var(--c-bg-sunken)', overflow: 'hidden' }}>
          <i style={{ width: `${Math.round(ratio * 100)}%`, background: 'var(--c-success)' }} />
          {ratio < 1 && <i style={{ flex: 1, background: 'var(--c-danger)' }} />}
        </span>
      </div>
      <div style={{ justifySelf: 'end', paddingLeft: 6 }}>
        <button className="btn primary sm" onClick={(e) => { e.stopPropagation(); onOpen() }}>
          {item.status === 'draft' || item.status === 'checking' || item.status === 'correcting' ? 'Проверить состав'
            : item.orders_pending > 0 ? 'Добавить в сборку'
            : 'Открыть'}
        </button>
      </div>
    </div>
  )
}
