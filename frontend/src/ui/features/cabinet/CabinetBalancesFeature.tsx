import { useEffect, useState } from 'react'
import { exportCabinetBalancesXlsx, getCabinetBalancesGrouped, getCabinetBalancesSummary, getCabinetWriteOffs } from '../../../api/cabinetApi'
import {
  balanceGroupKey, balanceVariantLabel, isFlatBalanceGroup,
  INV_OP_LABELS, INV_QUALITY_LABELS, WRITEOFF_REASON_LABELS,
} from '../../../api/balancesApi'
import type { InvQuality, WriteOffReason } from '../../../api/balancesApi'
import { foldCiSearch } from '../../../utils/foldCiSearch'
import { useApi } from '../../../hooks/useApi'
import { useFilterParam, usePageParam } from '../../../hooks/useFilterParams'
import { FiltersBar, FilterChip } from '../../data/FiltersBar'
import { Pagination } from '../../data/Pagination'
import { Table, Td } from '../../data/Table'
import { ListPage } from '../../layouts/ListPage'
import { Card, CardHead } from '../../primitives/Card'
import { Badge } from '../../primitives/Badge'
import { EmptyState } from '../../primitives/EmptyState'
import { MOSCOW_TZ, parseMoscow } from '../../../utils/format'
import { Icon } from '../../primitives/Icon'
import { KPI } from '../../primitives/KPI'
import { SkeletonRows } from '../../primitives/Skeleton'
import { BucketCell } from '../shared/BucketCell'
import { ProductLink } from '../shared/ProductLink'
import { SizeMatrix } from '../shared/SizeMatrix'
import { useToast } from '../../feedback/Toast'

const PAGE_SIZE = 25
const WRITEOFFS_LIMIT = 20

export function CabinetBalancesFeature() {
  const [search, setSearch] = useFilterParam('search', '')
  const [stockMode, setStockMode] = useFilterParam('stock', 'positive')
  const [defectMode, setDefectMode] = useFilterParam('defect', '')
  const [page, setPage] = usePageParam()
  const onlyPositive = stockMode !== 'all'
  const hasDefect = defectMode === '1'

  // Debounce поиска: инпут меняется мгновенно, URL и запрос — после паузы.
  // Sync-эффект подхватывает внешнюю смену URL («Сбросить», «Назад»).
  const [searchInput, setSearchInput] = useState(search)
  useEffect(() => { setSearchInput(search) }, [search])
  useEffect(() => {
    if (searchInput === search) return
    const timer = setTimeout(() => setSearch(searchInput), 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, search])

  const { data, loading, error } = useApi(
    (signal) => getCabinetBalancesGrouped({
      page,
      limit: PAGE_SIZE,
      search: search.trim() || undefined,
      only_positive: onlyPositive ? undefined : false,
      has_defect: hasDefect || undefined,
    }, signal),
    [page, search, onlyPositive, hasDefect],
  )

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // Матрица цвет×размер — режим разворота по умолчанию; здесь ключи групп,
  // переключённых пользователем обратно на список.
  const [listKeys, setListKeys] = useState<Set<string>>(new Set())
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

  // Поиск, совпавший по цвету/размеру (а не по товару), раскрывает группу сам —
  // иначе найденный вариант остаётся спрятан под свёрнутым артикулом.
  useEffect(() => {
    const q = foldCiSearch(search.trim())
    if (!q || !data) return
    const autoKeys = data.items
      .filter((g) =>
        !isFlatBalanceGroup(g)
        && !foldCiSearch(`${g.product_name} ${g.product_sku}`).includes(q)
        && g.items.some((i) => foldCiSearch(`${i.color_name ?? ''} ${i.size_name ?? ''}`).includes(q)))
      .map(balanceGroupKey)
    if (autoKeys.length) setExpanded((prev) => new Set([...prev, ...autoKeys]))
  }, [data, search])
  const summaryRes = useApi(
    (signal) => getCabinetBalancesSummary({
      search: search.trim() || undefined,
      has_defect: hasDefect || undefined,
    }, signal),
    [search, hasDefect],
  )

  const writeOffsRes = useApi((signal) => getCabinetWriteOffs({ limit: WRITEOFFS_LIMIT }, signal), [])
  const writeOffs = writeOffsRes.data?.items ?? []

  const items = data?.items ?? []

  const toast = useToast()
  const [exporting, setExporting] = useState(false)
  const handleExport = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const blob = await exportCabinetBalancesXlsx({
        search: search.trim() || undefined,
        only_positive: onlyPositive ? undefined : false,
        has_defect: hasDefect || undefined,
      })
      const clientName = items[0]?.client_name?.trim() ?? ''
      const dateStr = new Date().toLocaleDateString('ru-RU', { timeZone: MOSCOW_TZ })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${clientName ? `${clientName} ` : ''}Остатки на ${dateStr}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось выгрузить файл', 'error')
    } finally {
      setExporting(false)
    }
  }
  const summary = summaryRes.data
  const kpiVal = (n: number | undefined) => (summary ? (n ?? 0).toLocaleString('ru-RU') : '—')
  const defectQty = summary
    ? summary.storage_defect + summary.packing_defect + summary.packed_defect + summary.ready_defect
    : undefined

  return (
    <ListPage
      title="Остатки"
      subtitle={loading ? 'Загрузка…' : `${data?.total ?? 0} артикулов`}
      actions={
        <button className="btn ghost sm" onClick={handleExport} disabled={exporting || loading || items.length === 0}>
          <Icon name="download" size={14} />
          {exporting ? 'Выгрузка…' : 'Выгрузить в Excel'}
        </button>
      }
      filters={
        <FiltersBar>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Icon name="search" size={13} style={{ position: 'absolute', left: 9, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
            <input
              className="input sm"
              style={{ paddingLeft: 28, width: 240, paddingRight: searchInput ? 26 : undefined }}
              placeholder="Товар или SKU…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            {searchInput && (
              <button
                style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'var(--c-text-subtle)' }}
                onClick={() => { setSearchInput(''); setSearch('') }}
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </div>
          <FilterChip
            label="Только с остатком"
            active={onlyPositive}
            onClick={() => setStockMode(onlyPositive ? 'all' : 'positive')}
            onClear={() => setStockMode('all')}
          />
          <FilterChip
            label="Есть брак"
            active={hasDefect}
            onClick={() => setDefectMode(hasDefect ? '' : '1')}
            onClear={() => setDefectMode('')}
          />
        </FiltersBar>
      }
    >
      {error ? (
        <EmptyState title="Не удалось загрузить остатки" sub={error.message} />
      ) : (
        <>
          <div className="zone-strip" style={{ marginBottom: 18 }}>
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
              onClick={() => setDefectMode(hasDefect ? '' : '1')}
            />
          </div>
          <Table>
            <thead>
              <tr>
                <th>Товар</th>
                <th style={{ width: 150 }}>Распределение</th>
                <th style={{ textAlign: 'right', width: 120 }}>{INV_OP_LABELS.storage}</th>
                <th style={{ textAlign: 'right', width: 120 }}>{INV_OP_LABELS.packing}</th>
                <th style={{ textAlign: 'right', width: 120 }}>{INV_OP_LABELS.packed}</th>
                <th style={{ textAlign: 'right', width: 130 }}>{INV_OP_LABELS.ready}</th>
                <th className="total-col" style={{ textAlign: 'right', width: 95 }}>Всего</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={8} cols={7} />
              ) : items.length === 0 ? (
                <tr><Td colSpan={7}><EmptyState title="Остатков нет" sub="Данные появятся после завершения поступлений" /></Td></tr>
              ) : (
                items.map((g) => {
                  const key = balanceGroupKey(g)
                  const flat = isFlatBalanceGroup(g)
                  const isOpen = !flat && expanded.has(key)
                  const showMatrix = isOpen && g.sizes_count > 0 && !listKeys.has(key)
                  const distbar = (row: { storage_good: number; storage_defect: number; packing_good: number; packing_defect: number; packed_good: number; packed_defect: number; ready_good: number; ready_defect: number }) => {
                    const stor = row.storage_good + row.storage_defect
                    const pack = row.packing_good + row.packing_defect
                    const packd = row.packed_good + row.packed_defect
                    const ready = row.ready_good + row.ready_defect
                    const sum = Math.max(1, stor + pack + packd + ready)
                    return (
                      <div
                        className="distbar"
                        title={`хранение ${stor.toLocaleString('ru-RU')} · упаковка ${pack.toLocaleString('ru-RU')} · упаковано ${packd.toLocaleString('ru-RU')} · готово ${ready.toLocaleString('ru-RU')}`}
                      >
                        <i style={{ width: `${(stor / sum) * 100}%`, background: 'var(--c-accent)', opacity: 0.75 }} />
                        <i style={{ width: `${(pack / sum) * 100}%`, background: 'var(--c-info)', opacity: 0.75 }} />
                        <i style={{ width: `${(packd / sum) * 100}%`, background: 'var(--c-info)', opacity: 0.45 }} />
                        <i style={{ width: `${(ready / sum) * 100}%`, background: 'var(--c-success)', opacity: 0.8 }} />
                      </div>
                    )
                  }
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
                      <Td>{distbar(g)}</Td>
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
                      <Td className="num total-col">
                        <div className="row gap-8" style={{ justifyContent: 'flex-end', alignItems: 'center' }}>
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
                              <SizeMatrix group={g} />
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
                            <Td>{distbar(item)}</Td>
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
                            <Td className="num total-col" style={{ color: 'var(--c-text-muted)' }}>
                              {item.total.toLocaleString('ru-RU')}
                            </Td>
                          </tr>
                        ))
                      : []),
                  ]
                })
              )}
            </tbody>
          </Table>
          <div className="row mt-12" style={{ gap: 12, color: 'var(--c-text-subtle)', fontSize: 12 }}>
            <span className="row gap-4"><i style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--c-accent)', opacity: 0.75 }} />хранение</span>
            <span className="row gap-4"><i style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--c-info)', opacity: 0.75 }} />упаковка</span>
            <span className="row gap-4"><i style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--c-info)', opacity: 0.45 }} />упаковано</span>
            <span className="row gap-4"><i style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--c-success)', opacity: 0.8 }} />готово к отгрузке</span>
            <span style={{ color: 'var(--c-warning)' }}>+n брак — брак в зоне</span>
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />

          {writeOffs.length > 0 && (
            <Card style={{ marginTop: 20 }}>
              <CardHead>
                <Icon name="alert" size={15} style={{ color: 'var(--c-warning)' }} />
                <span className="card-head-title">Списания</span>
                <Badge tone="warning" style={{ marginLeft: 6 }}>{writeOffsRes.data?.total ?? writeOffs.length}</Badge>
              </CardHead>
              <Table>
                <thead>
                  <tr>
                    <th style={{ width: 130 }}>Дата</th>
                    <th>Товар</th>
                    <th style={{ width: 100 }}>Качество</th>
                    <th style={{ textAlign: 'right', width: 90 }}>Кол-во</th>
                    <th style={{ width: 160 }}>Причина</th>
                    <th>Комментарий</th>
                  </tr>
                </thead>
                <tbody>
                  {writeOffs.map((w) => (
                    <tr key={w.id}>
                      <Td className="t-sub mono" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                        {parseMoscow(w.created_at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: MOSCOW_TZ })}
                      </Td>
                      <Td>
                        <div style={{ fontWeight: 500 }}>{w.product_name ?? '—'}</div>
                        <div className="t-sub mono">
                          {[w.product_sku, w.color_name, w.size_name].filter(Boolean).join(' · ')}
                        </div>
                      </Td>
                      <Td>
                        <Badge tone={w.quality === 'defect' ? 'warning' : 'success'}>
                          {INV_QUALITY_LABELS[w.quality as InvQuality] ?? w.quality}
                        </Badge>
                      </Td>
                      <Td className="num" style={{ fontWeight: 600 }}>{w.qty.toLocaleString('ru-RU')}</Td>
                      <Td style={{ fontSize: 13 }}>
                        {w.reason ? WRITEOFF_REASON_LABELS[w.reason as WriteOffReason] ?? w.reason : '—'}
                      </Td>
                      <Td style={{ fontSize: 13, color: 'var(--c-text-muted)' }}>{w.comment ?? '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </>
      )}
    </ListPage>
  )
}
