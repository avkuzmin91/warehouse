import { useState } from 'react'
import { getStorageChargeDetail, getStorageClientDays, getStorageReport, storageRateLabel } from '../../../api/storagePricingApi'
import type { StorageChargeDetail, StorageDayItem, StorageReportItem } from '../../../api/storagePricingApi'
import { ListPage } from '../../layouts/ListPage'
import { Table, Td } from '../../data/Table'
import { FiltersBar, FilterCombobox } from '../../data/FiltersBar'
import { DateRange } from '../../data/DateRange'
import { Drawer } from '../../feedback/Drawer'
import { Badge } from '../../primitives/Badge'
import { Icon } from '../../primitives/Icon'
import { SkeletonRows } from '../../primitives/Skeleton'
import { EmptyState } from '../../primitives/EmptyState'
import { useApi } from '../../../hooks/useApi'
import { useLookups } from '../../../hooks/useLookups'
import { useFilterParam, useFilterParamsActions } from '../../../hooks/useFilterParams'
import { fmtDate, formatMoneyKopecks, moscowTodayYmd } from '../../../utils/format'

const DEFAULT_DAYS = 30

const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)

function shiftYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

export function StorageReportFeature() {
  const { clients } = useLookups()
  const [clientId, setClientId] = useFilterParam('client', '')
  const [fromRaw, setFromRaw] = useFilterParam('from', '')
  const [toRaw, setToRaw] = useFilterParam('to', '')
  const { setMany } = useFilterParamsActions()
  const [openClient, setOpenClient] = useState<StorageReportItem | null>(null)

  const today = moscowTodayYmd()
  const customFrom = isYmd(fromRaw) ? fromRaw : ''
  const customTo = isYmd(toRaw) ? toRaw : ''
  const hasCustom = Boolean(customFrom || customTo)
  let effFrom = hasCustom ? (customFrom || customTo) : shiftYmd(today, -(DEFAULT_DAYS - 1))
  let effTo = hasCustom ? (customTo || customFrom) : today
  if (effFrom > effTo) [effFrom, effTo] = [effTo, effFrom]

  const { data, loading, error } = useApi(
    (s) => getStorageReport({ date_from: effFrom, date_to: effTo, client_id: clientId || undefined }, s),
    [effFrom, effTo, clientId],
  )

  const items = data?.items ?? []
  const colCount = 6

  return (
    <ListPage
      title="Хранение"
      subtitle={`Начисления за хранение остатков · ${fmtDate(effFrom)} — ${fmtDate(effTo)}`}
      actions={
        <DateRange
          from={customFrom}
          to={customTo}
          onFromChange={setFromRaw}
          onToChange={setToRaw}
          onClear={() => setMany({ from: null, to: null })}
        />
      }
      filters={
        <FiltersBar>
          <FilterCombobox
            label="Клиент"
            value={clientId}
            options={[{ value: '', label: 'Все клиенты' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
            onChange={(v) => setClientId(v)}
            placeholder="Поиск клиента…"
          />
          {data && (
            <div className="row gap-8" style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--c-text-subtle)' }}>
              <span>Всего: <b style={{ color: 'var(--c-text)' }}>{formatMoneyKopecks(data.total_amount_kop)}</b></span>
              <span>Не в счетах: <b style={{ color: data.total_uninvoiced_kop > 0 ? 'var(--c-warning)' : 'var(--c-text)' }}>{formatMoneyKopecks(data.total_uninvoiced_kop)}</b></span>
            </div>
          )}
        </FiltersBar>
      }
    >
      <Table>
        <thead>
          <tr>
            <th>Клиент</th>
            <th style={{ width: 200 }}>Тариф сейчас</th>
            <th style={{ width: 110, textAlign: 'right' }}>Платных дней</th>
            <th style={{ width: 140, textAlign: 'right' }}>Начислено</th>
            <th style={{ width: 140, textAlign: 'right' }}>Не в счетах</th>
            <th style={{ width: 28 }} />
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <SkeletonRows rows={6} cols={colCount} />
          ) : error ? (
            <tr><td colSpan={colCount}><EmptyState title="Не удалось загрузить" sub={error.message} /></td></tr>
          ) : items.length === 0 ? (
            <tr><td colSpan={colCount}>
              <EmptyState title="Начислений нет" sub="Начисления появятся после заведения тарифа хранения (раздел «Стоимость хранения») — по одному за каждый прошедший день." />
            </td></tr>
          ) : (
            items.map((it) => (
              <tr key={it.client_id} onClick={() => setOpenClient(it)} style={{ cursor: 'pointer' }}>
                <Td>
                  {it.client_name ?? '—'}
                  {it.missing_capacity_qty > 0 && (
                    <span title="Часть штук не тарифицирована: у товаров не заведена вместимость короба/палеты">
                      <Badge tone="warning" dot style={{ marginLeft: 8 }}>нет вместимости</Badge>
                    </span>
                  )}
                </Td>
                <Td style={{ color: 'var(--c-text-subtle)' }}>{storageRateLabel(it)}</Td>
                <Td className="num">{it.billable_days}</Td>
                <Td className="num" style={{ fontWeight: 600 }}>{formatMoneyKopecks(it.amount_kop)}</Td>
                <Td className="num" style={{ color: it.uninvoiced_kop > 0 ? 'var(--c-warning)' : 'var(--c-text-subtle)' }}>
                  {formatMoneyKopecks(it.uninvoiced_kop)}
                </Td>
                <Td><Icon name="chev" size={14} style={{ color: 'var(--c-text-faint)' }} /></Td>
              </tr>
            ))
          )}
        </tbody>
      </Table>

      {openClient && (
        <StorageClientDaysDrawer
          item={openClient}
          dateFrom={effFrom}
          dateTo={effTo}
          onClose={() => setOpenClient(null)}
        />
      )}
    </ListPage>
  )
}

function StorageClientDaysDrawer({ item, dateFrom, dateTo, onClose }: {
  item: StorageReportItem
  dateFrom: string
  dateTo: string
  onClose: () => void
}) {
  const [openDayId, setOpenDayId] = useState<string | null>(null)

  const { data, loading, error } = useApi(
    (s) => getStorageClientDays(item.client_id, { date_from: dateFrom, date_to: dateTo }, s),
    [item.client_id, dateFrom, dateTo],
  )
  const days = (data?.items ?? []).filter((d) => d.amount_kop > 0 || d.missing_capacity_qty > 0)

  return (
    <Drawer
      open
      onClose={onClose}
      title={item.client_name ?? 'Хранение'}
      subtitle={`Начисления по дням · ${fmtDate(dateFrom)} — ${fmtDate(dateTo)}`}
      width={640}
    >
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}>
          <div style={{ width: 22, height: 22, border: '2px solid var(--c-border)', borderTopColor: 'var(--c-accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        </div>
      ) : error ? (
        <EmptyState title="Не удалось загрузить" sub={error.message} />
      ) : days.length === 0 ? (
        <EmptyState title="Платных дней нет" sub="За период не было начислений с суммой" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {days.map((d) => (
            <StorageDayRow
              key={d.id}
              day={d}
              open={openDayId === d.id}
              onToggle={() => setOpenDayId(openDayId === d.id ? null : d.id)}
            />
          ))}
        </div>
      )}
    </Drawer>
  )
}

function StorageDayRow({ day, open, onToggle }: { day: StorageDayItem; open: boolean; onToggle: () => void }) {
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <button
        onClick={onToggle}
        style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 12.5 }}
      >
        <span className="mono" style={{ minWidth: 78, fontWeight: 600 }}>{fmtDate(day.charge_date)}</span>
        <span style={{ color: 'var(--c-text-subtle)' }}>
          {day.units_qty} × {day.unit_label.toLowerCase()} · {day.qty_pieces} шт.
        </span>
        {day.missing_capacity_qty > 0 && (
          <span title="Штуки без заведённой вместимости товара — не тарифицированы">
            <Badge tone="warning" dot>{day.missing_capacity_qty} шт. без вместимости</Badge>
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontWeight: 700 }}>{formatMoneyKopecks(day.amount_kop)}</span>
        {day.invoice_number
          ? <Badge tone="success">{day.invoice_number}</Badge>
          : <Badge>не в счёте</Badge>}
        <Icon name="chev" size={13} style={{ color: 'var(--c-text-faint)', transform: open ? 'rotate(90deg)' : undefined }} />
      </button>
      {open && <StorageChargeLines chargeId={day.id} />}
    </div>
  )
}

function StorageChargeLines({ chargeId }: { chargeId: string }) {
  const { data, loading, error } = useApi<StorageChargeDetail>(
    (s) => getStorageChargeDetail(chargeId, s),
    [chargeId],
  )
  if (loading) return <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--c-text-subtle)' }}>Загрузка партий…</div>
  if (error) return <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--c-danger)' }}>{error.message}</div>
  const lines = data?.lines ?? []
  if (lines.length === 0) return <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--c-text-subtle)' }}>Партий нет</div>
  return (
    <div style={{ borderTop: '1px solid var(--c-border)', background: 'var(--c-bg-sunken)', padding: '6px 12px' }}>
      {lines.map((ln) => (
        <div key={ln.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, padding: '3px 0' }}>
          <span className="mono" style={{ color: 'var(--c-text-subtle)', minWidth: 78 }}>{ln.receipt_doc_number ?? '—'}</span>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {[ln.product_sku, ln.product_name].filter(Boolean).join(' ')}
            {(ln.color_name || ln.size_name) && (
              <span style={{ color: 'var(--c-text-subtle)' }}> · {[ln.color_name, ln.size_name].filter(Boolean).join(' / ')}</span>
            )}
          </span>
          <span style={{ color: 'var(--c-text-subtle)' }}>принято {ln.accepted_on ? fmtDate(ln.accepted_on) : '—'}</span>
          <span style={{ color: 'var(--c-text-subtle)' }}>{ln.age_days} дн.</span>
          <span className="num" style={{ fontWeight: 600, minWidth: 60, textAlign: 'right' }}>{ln.billable_qty} шт.</span>
        </div>
      ))}
    </div>
  )
}
