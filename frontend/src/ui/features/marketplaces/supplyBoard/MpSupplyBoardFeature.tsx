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
import type { MpSupplyBoardItem } from '../../../../api/marketplacesApi'
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
  const counters = data?.counters

  return (
    <ListPage
      title="Отгрузки FBS"
      subtitle="Поставки маркетплейсов по кабинетам и отсечкам — состав набирается автоматически, утверждает менеджер"
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
            </div>
          )}
        </FiltersBar>
      }
    >
      {loading ? (
        <table className="table"><tbody><SkeletonRows rows={6} cols={1} /></tbody></table>
      ) : error ? (
        <EmptyState title="Не удалось загрузить" sub={error.message} />
      ) : waves.length === 0 ? (
        <EmptyState
          title="Поставок нет"
          sub="Поставки заводятся сами из FBS-заказов подключённых кабинетов — синхронизация идёт каждые 2 минуты."
        />
      ) : (
        waves.map((wave) => (
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
        ))
      )}
    </ListPage>
  )
}

function coverageLabel(item: MpSupplyBoardItem): string {
  if (item.orders_total === 0) return 'Состав пуст'
  if (item.orders_ready === item.orders_total) return 'Покрытие 100%'
  return `Соберётся ${item.orders_ready} из ${item.orders_total}`
}

function SupplyCard({ item, onOpen }: { item: MpSupplyBoardItem; onOpen: () => void }) {
  const ratio = item.orders_total > 0 ? item.orders_ready / item.orders_total : 0
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
        </div>
        <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginTop: 1 }}>{item.client_name ?? '—'}</div>
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
        <span className="num" style={{ fontSize: 11.5, color: 'var(--c-text-muted)' }}>{coverageLabel(item)}</span>
        <span style={{ display: 'flex', height: 5, borderRadius: 3, background: 'var(--c-bg-sunken)', overflow: 'hidden' }}>
          <i style={{ width: `${Math.round(ratio * 100)}%`, background: 'var(--c-success)' }} />
          {ratio < 1 && <i style={{ flex: 1, background: 'var(--c-danger)' }} />}
        </span>
      </div>
      <div style={{ justifySelf: 'end', paddingLeft: 6 }}>
        <button className="btn primary sm" onClick={(e) => { e.stopPropagation(); onOpen() }}>
          {item.status === 'draft' ? 'Собрать поставку'
            : item.orders_pending > 0 ? 'Добавить в сборку'
            : 'Открыть'}
        </button>
      </div>
    </div>
  )
}
