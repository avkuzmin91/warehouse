import { useState, useEffect, useCallback } from 'react'
import {
  balanceGroupKey, balanceVariantLabel, getBalancesGrouped, getBalancesSummary,
  isFlatBalanceGroup, INV_OP_LABELS,
} from '../../../../../api/balancesApi'
import type { BalanceGroupItem, BalanceSummary } from '../../../../../api/balancesApi'
import { useLookups } from '../../../../../hooks/useLookups'
import { useFilterParam, usePageParam, useFilterParamsActions } from '../../../../../hooks/useFilterParams'
import { foldCiSearch } from '../../../../../utils/foldCiSearch'
import { Table, Td } from '../../../../data/Table'
import { Pagination } from '../../../../data/Pagination'
import { FiltersBar, FilterChip, FilterCombobox } from '../../../../data/FiltersBar'
import { KPI } from '../../../../primitives/KPI'
import { Icon } from '../../../../primitives/Icon'
import { SkeletonRows } from '../../../../primitives/Skeleton'
import { EmptyState } from '../../../../primitives/EmptyState'
import { WhereStoredDrawer } from '../WhereStoredDrawer'
import type { WhereStoredTarget } from '../WhereStoredDrawer'
import { BucketCell } from '../../../shared/BucketCell'
import { ProductLink } from '../../../shared/ProductLink'
import { SizeMatrix, balanceGroupCells } from '../../../shared/SizeMatrix'

const PAGE_SIZE = 25

export function ByProductView() {
  const [groups, setGroups] = useState<BalanceGroupItem[]>([])
  const [summary, setSummary] = useState<BalanceSummary | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = usePageParam()
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useFilterParam('search', '')
  const [clientId, setClientId] = useFilterParam('client', '')
  const [onlyPositive, setOnlyPositive] = useState(true)
  const [hasDefect, setHasDefect] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // «Где лежит»: обратный разрез — места и короба одного варианта.
  const [where, setWhere] = useState<WhereStoredTarget | null>(null)
  // Матрица цвет×размер — режим разворота по умолчанию; здесь ключи групп,
  // переключённых пользователем обратно на список.
  const [listKeys, setListKeys] = useState<Set<string>>(new Set())
  const { setMany } = useFilterParamsActions()
  const { clients } = useLookups()

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    try {
      const [res, sum] = await Promise.all([
        getBalancesGrouped({
          page,
          limit: PAGE_SIZE,
          search: search || undefined,
          client_id: clientId || undefined,
          only_positive: onlyPositive ? undefined : false,
          has_defect: hasDefect || undefined,
        }, signal),
        getBalancesSummary({
          search: search || undefined,
          client_id: clientId || undefined,
          has_defect: hasDefect || undefined,
        }, signal),
      ])
      if (signal?.aborted) return
      setGroups(res.items)
      setTotal(res.total)
      setSummary(sum)
      // Поиск, совпавший по цвету/размеру (а не по товару), раскрывает группу сам —
      // иначе найденный вариант остаётся спрятан под свёрнутым артикулом.
      const q = foldCiSearch(search.trim())
      if (q) {
        const autoKeys = res.items
          .filter((g) =>
            !isFlatBalanceGroup(g)
            && !foldCiSearch(`${g.product_name} ${g.product_sku}`).includes(q)
            && g.items.some((i) => foldCiSearch(`${i.color_name ?? ''} ${i.size_name ?? ''}`).includes(q)))
          .map(balanceGroupKey)
        if (autoKeys.length) setExpanded((prev) => new Set([...prev, ...autoKeys]))
      }
    } catch (e) {
      if (signal?.aborted) return
      throw e
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [page, search, clientId, onlyPositive, hasDefect])

  // Debounce поиска: отмена предыдущего запроса + пауза перед новым при вводе текста
  useEffect(() => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => void load(ctrl.signal), search ? 250 : 0)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [load, search])

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleMatrix = (key: string) => {
    setListKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const expandableKeys = groups.filter((g) => !isFlatBalanceGroup(g)).map(balanceGroupKey)
  const allExpanded = expandableKeys.length > 0 && expandableKeys.every((k) => expanded.has(k))
  const toggleAll = () => {
    setExpanded((prev) => {
      if (allExpanded) {
        const next = new Set(prev)
        for (const k of expandableKeys) next.delete(k)
        return next
      }
      return new Set([...prev, ...expandableKeys])
    })
  }

  const hasFilters = !!search || !!clientId || !onlyPositive || hasDefect
  const resetFilters = () => {
    setOnlyPositive(true)
    setHasDefect(false)
    setMany({ search: null, client: null })
  }

  const kpiVal = (n: number | undefined) => (summary ? (n ?? 0).toLocaleString('ru-RU') : '—')
  const defectQty = summary
    ? summary.storage_defect + summary.packing_defect + summary.packed_defect + summary.ready_defect
    : undefined

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <FiltersBar>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Icon name="search" size={13} style={{ position: 'absolute', left: 9, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
            <input
              className="input sm"
              style={{ paddingLeft: 28, width: 220, paddingRight: search ? 26 : undefined }}
              placeholder="Товар, SKU, цвет, размер или ШК…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'var(--c-text-subtle)' }}
                onClick={() => setSearch('')}
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </div>
          <FilterCombobox
            label="Клиент"
            value={clientId}
            options={[{ value: '', label: 'Все клиенты' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
            onChange={(v) => setClientId(v)}
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
          {hasFilters && (
            <button className="btn ghost sm" onClick={resetFilters}>
              <Icon name="x" size={12} />Сбросить
            </button>
          )}
          {expandableKeys.length > 0 && (
            <button className="btn ghost sm" onClick={toggleAll}>
              <Icon name={allExpanded ? 'minus' : 'plus'} size={12} />
              {allExpanded ? 'Свернуть все' : 'Развернуть все'}
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

      <div className="kpi-grid" style={{ marginBottom: 20, gridTemplateColumns: 'repeat(6, 1fr)' }}>
        <KPI label="Всего единиц" value={kpiVal(summary?.total)} unit="шт" />
        <KPI
          label={INV_OP_LABELS.storage}
          value={kpiVal(summary ? summary.storage_good + summary.storage_defect : undefined)}
          valueColor="var(--c-accent)"
          unit="шт"
        />
        <KPI
          label={INV_OP_LABELS.packing}
          value={kpiVal(summary ? summary.packing_good + summary.packing_defect : undefined)}
          valueColor="var(--c-info)"
          unit="шт"
        />
        <KPI
          label={INV_OP_LABELS.packed}
          value={kpiVal(summary ? summary.packed_good + summary.packed_defect : undefined)}
          valueColor="var(--c-info)"
          unit="шт"
        />
        <KPI
          label={INV_OP_LABELS.ready}
          value={kpiVal(summary ? summary.ready_good + summary.ready_defect : undefined)}
          valueColor="var(--c-success)"
          unit="шт"
        />
        <KPI
          label="Брак (из них)"
          value={kpiVal(defectQty)}
          valueColor="var(--c-warning)"
          unit="шт"
          active={hasDefect}
          onClick={() => { setHasDefect(!hasDefect); setPage(1) }}
        />
      </div>

      <Table>
        <thead>
          <tr>
            <th>Товар</th>
            <th>Клиент</th>
            <th style={{ textAlign: 'right', width: 130 }}>{INV_OP_LABELS.storage}</th>
            <th style={{ textAlign: 'right', width: 130 }}>{INV_OP_LABELS.packing}</th>
            <th style={{ textAlign: 'right', width: 130 }}>{INV_OP_LABELS.packed}</th>
            <th style={{ textAlign: 'right', width: 140 }}>{INV_OP_LABELS.ready}</th>
            <th style={{ textAlign: 'right', width: 90, borderLeft: '2px solid var(--c-border)' }}>Всего</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <SkeletonRows rows={8} cols={7} />
          ) : groups.length === 0 ? (
            <tr><td colSpan={7}><EmptyState title="Остатков нет" sub="Данные появятся после завершения поступлений" /></td></tr>
          ) : (
            groups.map((g) => {
              const key = balanceGroupKey(g)
              const flat = isFlatBalanceGroup(g)
              const isOpen = !flat && expanded.has(key)
              const showMatrix = isOpen && g.sizes_count > 0 && !listKeys.has(key)
              return [
                <tr
                  key={key}
                  onClick={flat ? undefined : () => toggle(key)}
                  style={flat ? undefined : { cursor: 'pointer' }}
                >
                  <Td>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                      {!flat && (
                        <Icon
                          name="chev"
                          size={14}
                          style={{
                            color: 'var(--c-text-subtle)', flexShrink: 0, marginTop: 3,
                            transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 120ms',
                          }}
                        />
                      )}
                      <div style={flat ? { paddingLeft: 20 } : undefined}>
                        <div style={{ fontWeight: 500 }}>
                          <ProductLink productId={g.product_id}>{g.product_name}</ProductLink>
                        </div>
                        <div className="t-sub mono">
                          {flat
                            ? [g.product_sku, g.items[0].color_name, g.items[0].size_name].filter(Boolean).join(' · ')
                            : `${g.product_sku ? `${g.product_sku} · ` : ''}${g.colors_count > 0 ? `${g.colors_count} цв. · ` : ''}${g.sizes_count > 0 ? `${g.sizes_count} разм. · ` : ''}${g.variants_count} поз.`}
                        </div>
                      </div>
                    </div>
                  </Td>
                  <Td style={{ color: 'var(--c-text-muted)', fontSize: 13 }}>
                    {g.client_name ?? '—'}
                  </Td>
                  <Td className="num">
                    <BucketCell good={g.storage_good} defect={g.storage_defect} accent="var(--c-accent)" />
                  </Td>
                  <Td className="num">
                    <BucketCell good={g.packing_good} defect={g.packing_defect} accent="var(--c-info)" />
                  </Td>
                  <Td className="num">
                    <BucketCell good={g.packed_good} defect={g.packed_defect} accent="var(--c-info)" />
                  </Td>
                  <Td className="num">
                    <BucketCell good={g.ready_good} defect={g.ready_defect} accent="var(--c-success)" />
                  </Td>
                  <Td className="num" style={{ borderLeft: '2px solid var(--c-border)', fontWeight: 600, background: 'var(--c-bg-sunken)', color: 'var(--c-text)' }}>
                    <div className="row gap-8" style={{ justifyContent: 'flex-end', alignItems: 'center' }}>
                      {flat && g.items[0] && (
                        <button
                          className="btn ghost sm icon"
                          title="Где лежит: места и короба"
                          onClick={(e) => {
                            e.stopPropagation()
                            setWhere({
                              product_id: g.product_id,
                              product_name: g.product_name,
                              product_sku: g.product_sku,
                              color_id: g.items[0].color_id,
                              color_name: g.items[0].color_name,
                              size_id: g.items[0].size_id,
                              size_name: g.items[0].size_name,
                            })
                          }}
                        >
                          <Icon name="box" size={13} />
                        </button>
                      )}
                      {isOpen && g.sizes_count > 0 && (
                        <button
                          className="btn ghost sm icon"
                          title={showMatrix ? 'Показать списком' : 'Матрица цвет × размер'}
                          onClick={(e) => { e.stopPropagation(); toggleMatrix(key) }}
                        >
                          <Icon name={showMatrix ? 'list' : 'grid'} size={13} />
                        </button>
                      )}
                      {g.total.toLocaleString('ru-RU')}
                    </div>
                  </Td>
                </tr>,
                ...(isOpen && showMatrix
                  ? [
                      <tr key={`${key}-matrix`}>
                        <td colSpan={7} style={{ background: 'var(--c-bg-sunken)', padding: '10px 16px 12px 40px' }}>
                          <SizeMatrix cells={balanceGroupCells(g)} />
                        </td>
                      </tr>,
                    ]
                  : []),
                ...(isOpen && !showMatrix
                  ? g.items.map((item, i) => (
                      <tr key={`${key}-v-${item.color_id ?? ''}-${item.size_id ?? ''}-${i}`} style={{ background: 'var(--c-bg-sunken)' }}>
                        <Td style={{ paddingLeft: 40 }}>
                          <span style={{ color: 'var(--c-text-muted)', fontSize: 13 }}>{balanceVariantLabel(item)}</span>
                        </Td>
                        <Td />
                        <Td className="num">
                          <BucketCell good={item.storage_good} defect={item.storage_defect} accent="var(--c-accent)" />
                        </Td>
                        <Td className="num">
                          <BucketCell good={item.packing_good} defect={item.packing_defect} accent="var(--c-info)" />
                        </Td>
                        <Td className="num">
                          <BucketCell good={item.packed_good} defect={item.packed_defect} accent="var(--c-info)" />
                        </Td>
                        <Td className="num">
                          <BucketCell good={item.ready_good} defect={item.ready_defect} accent="var(--c-success)" />
                        </Td>
                        <Td className="num" style={{ borderLeft: '2px solid var(--c-border)', color: 'var(--c-text-muted)' }}>
                          <div className="row gap-8" style={{ justifyContent: 'flex-end', alignItems: 'center' }}>
                            <button
                              className="btn ghost sm icon"
                              title="Где лежит: места и короба"
                              onClick={(e) => {
                                e.stopPropagation()
                                setWhere({
                                  product_id: g.product_id,
                                  product_name: g.product_name,
                                  product_sku: g.product_sku,
                                  color_id: item.color_id,
                                  color_name: item.color_name,
                                  size_id: item.size_id,
                                  size_name: item.size_name,
                                })
                              }}
                            >
                              <Icon name="box" size={13} />
                            </button>
                            {item.total.toLocaleString('ru-RU')}
                          </div>
                        </Td>
                      </tr>
                    ))
                  : []),
              ]
            })
          )}
        </tbody>
      </Table>
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />

      <WhereStoredDrawer target={where} onClose={() => setWhere(null)} />
    </>
  )
}
