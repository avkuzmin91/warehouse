import { useState, useEffect, useCallback, useMemo } from 'react'
import { getBalances } from '../../../../../api/balancesApi'
import type { BalanceItem } from '../../../../../api/balancesApi'
import { useLookups } from '../../../../../hooks/useLookups'
import { Table, Td } from '../../../../data/Table'
import { Pagination } from '../../../../data/Pagination'
import { FiltersBar, FilterChip, FilterCombobox } from '../../../../data/FiltersBar'
import { KPI } from '../../../../primitives/KPI'
import { Icon } from '../../../../primitives/Icon'
import { SkeletonRows } from '../../../../primitives/Skeleton'
import { EmptyState } from '../../../../primitives/EmptyState'

const PAGE_SIZE = 50

export function ByProductView() {
  const [items, setItems] = useState<BalanceItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [clientId, setClientId] = useState('')
  const [onlyPositive, setOnlyPositive] = useState(true)
  const [hasDefect, setHasDefect] = useState(false)
  const { clients } = useLookups()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getBalances({
        page,
        limit: PAGE_SIZE,
        search: search || undefined,
        client_id: clientId || undefined,
        only_positive: onlyPositive ? undefined : false,
        has_defect: hasDefect || undefined,
      })
      setItems(res.items)
      setTotal(res.total)
    } finally {
      setLoading(false)
    }
  }, [page, search, clientId, onlyPositive, hasDefect])

  useEffect(() => { load() }, [load])

  const kpi = useMemo(() => {
    const totalQty = items.reduce((s, i) => s + i.total, 0)
    const goodQty = items.reduce((s, i) => s + i.good, 0)
    const defectQty = items.reduce((s, i) => s + i.defect, 0)
    const onReviewQty = items.reduce((s, i) => s + i.on_review, 0)
    return { totalQty, goodQty, defectQty, onReviewQty }
  }, [items])

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <FiltersBar>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Icon name="search" size={13} style={{ position: 'absolute', left: 9, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
            <input
              className="input sm"
              style={{ paddingLeft: 28, width: 220, paddingRight: search ? 26 : undefined }}
              placeholder="Товар, SKU, клиент…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            />
            {search && (
              <button
                style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'var(--c-text-subtle)' }}
                onClick={() => { setSearch(''); setPage(1) }}
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </div>
          <FilterCombobox
            label="Клиент"
            value={clientId}
            options={[{ value: '', label: 'Все клиенты' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
            onChange={(v) => { setClientId(v); setPage(1) }}
            placeholder="Поиск клиента…"
          />
          <FilterChip
            label="Только с остатком"
            active={onlyPositive}
            onClick={() => { setOnlyPositive(!onlyPositive); setPage(1) }}
            onClear={() => { setOnlyPositive(false); setPage(1) }}
          />
          <FilterChip
            label="Есть брак"
            active={hasDefect}
            onClick={() => { setHasDefect(!hasDefect); setPage(1) }}
            onClear={() => { setHasDefect(false); setPage(1) }}
          />
          {(clientId) && (
            <button className="btn ghost sm" onClick={() => { setClientId(''); setPage(1) }}>
              <Icon name="x" size={12} />Сбросить
            </button>
          )}
          <button
            className="btn ghost sm icon"
            title="Обновить"
            onClick={() => load()}
          >
            <Icon name="refresh" size={14} style={loading ? { animation: 'spin 0.7s linear infinite' } : undefined} />
          </button>
        </FiltersBar>
      </div>

      <div className="kpi-grid" style={{ marginBottom: 20 }}>
        <KPI label="Всего единиц" value={kpi.totalQty.toLocaleString('ru-RU')} unit="шт" />
        <KPI label="Годный" value={kpi.goodQty.toLocaleString('ru-RU')} valueColor="var(--c-success)" unit="шт" />
        <KPI label="Брак" value={kpi.defectQty.toLocaleString('ru-RU')} valueColor="var(--c-warning)" unit="шт" />
        <KPI label="На проверке" value={kpi.onReviewQty.toLocaleString('ru-RU')} valueColor="var(--c-accent)" unit="шт" />
      </div>

      <Table>
        <thead>
          <tr>
            <th>Товар</th>
            <th>Клиент</th>
            <th style={{ textAlign: 'right', width: 90 }}>Годный</th>
            <th style={{ textAlign: 'right', width: 80 }}>Брак</th>
            <th style={{ textAlign: 'right', width: 100 }}>На проверке</th>
            <th style={{ textAlign: 'right', width: 90, borderLeft: '2px solid var(--c-border)' }}>Всего</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <SkeletonRows rows={8} cols={6} />
          ) : items.length === 0 ? (
            <tr><td colSpan={6}><EmptyState title="Остатков нет" sub="Данные появятся после завершения поступлений" /></td></tr>
          ) : (
            items.map((item, i) => (
              <tr key={`${item.product_id}-${item.color_id}-${item.size_id}-${i}`}>
                <Td>
                  <div style={{ fontWeight: 500 }}>{item.product_name}</div>
                  <div className="t-sub mono">
                    {[item.product_sku, item.color_name, item.size_name].filter(Boolean).join(' · ')}
                  </div>
                </Td>
                <Td style={{ color: 'var(--c-text-muted)', fontSize: 13 }}>
                  {item.client_name ?? '—'}
                </Td>
                <Td className="num" style={{ color: item.good > 0 ? 'var(--c-success)' : undefined, fontWeight: item.good > 0 ? 500 : undefined }}>
                  {item.good > 0 ? item.good.toLocaleString('ru-RU') : <span style={{ color: 'var(--c-text-faint)' }}>0</span>}
                </Td>
                <Td className="num">
                  {item.defect > 0
                    ? <span style={{ color: 'var(--c-warning)', fontWeight: 500 }}>{item.defect.toLocaleString('ru-RU')}</span>
                    : <span style={{ color: 'var(--c-text-faint)' }}>0</span>
                  }
                </Td>
                <Td className="num">
                  {item.on_review > 0
                    ? <span style={{ color: 'var(--c-accent)', fontWeight: 500 }}>{item.on_review.toLocaleString('ru-RU')}</span>
                    : <span style={{ color: 'var(--c-text-faint)' }}>0</span>
                  }
                </Td>
                <Td className="num" style={{ borderLeft: '2px solid var(--c-border)', fontWeight: 600, background: 'var(--c-bg-sunken)', color: 'var(--c-text)' }}>
                  {item.total.toLocaleString('ru-RU')}
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
    </>
  )
}
