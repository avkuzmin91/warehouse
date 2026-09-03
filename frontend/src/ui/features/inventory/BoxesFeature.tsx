import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CONTAINER_STATUS_LABELS,
  containerStatusTone,
  createContainers,
  getContainerLabels,
  getContainers,
} from '../../../api/containersApi'
import type { ContainerItem, ContainerLabel, ContainerStatus } from '../../../api/containersApi'
import { useApi } from '../../../hooks/useApi'
import { useFilterParam, useFilterParamsActions, usePageParam } from '../../../hooks/useFilterParams'
import { ListPage } from '../../layouts/ListPage'
import { FiltersBar, FilterSelect } from '../../data/FiltersBar'
import { Pagination } from '../../data/Pagination'
import { Table, Td } from '../../data/Table'
import { SkeletonRows } from '../../primitives/Skeleton'
import { EmptyState } from '../../primitives/EmptyState'
import { Badge } from '../../primitives/Badge'
import { Checkbox } from '../../primitives/Checkbox'
import type { BadgeTone } from '../../primitives/Badge'
import { Icon } from '../../primitives/Icon'
import { useToast } from '../../feedback/Toast'
import { fmtDate } from '../../../utils/format'

const PAGE_SIZE = 25

const STATUS_OPTIONS = [
  { value: '', label: 'Все статусы' },
  ...(Object.keys(CONTAINER_STATUS_LABELS) as ContainerStatus[]).map((s) => ({
    value: s,
    label: CONTAINER_STATUS_LABELS[s],
  })),
]

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c))
}

/** Лист этикеток коробов: QR «wms:box:<id>» + человекочитаемый номер, лента 58×40 мм. */
function printBoxLabels(labels: ContainerLabel[]) {
  const win = window.open('', '_blank', 'width=900,height=700')
  if (!win) return
  const cells = labels
    .map((l) => `
      <div class="label">
        <div class="qr">${l.qr_svg}</div>
        <div class="code">${escapeHtml(l.doc_number)}</div>
      </div>`)
    .join('')
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title></title>
    <style>
      @page { size: 58mm 40mm; margin: 0mm; }
      * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      html, body { margin: 0; padding: 0; font-family: ui-monospace, monospace; background: #fff; color: #000; }
      .toolbar { padding: 12px 16px; border-bottom: 1px solid #ddd; font-family: system-ui, sans-serif; }
      .toolbar button { font-size: 14px; padding: 6px 14px; cursor: pointer; }
      .label {
        width: 58mm; height: 40mm; padding: 2mm;
        display: flex; align-items: center; gap: 2mm;
        break-inside: avoid; page-break-inside: avoid;
      }
      .label .qr { width: 32mm; height: 32mm; flex: none; }
      .label .qr svg { width: 100%; height: 100%; }
      .label .code { font-size: 15px; font-weight: 600; letter-spacing: 0.04em; }
      @media screen { body { background: #f4f4f4; } .label { margin: 8px auto; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.2); } }
      @media print { .toolbar { display: none !important; } .label { margin: 0 !important; box-shadow: none !important; } }
    </style></head><body>
    <div class="toolbar"><button onclick="window.print()">Печать</button> &nbsp; Этикеток: ${labels.length} • лента 58×40 мм • масштаб 100% / «Реальный размер».</div>
    ${cells}
    <script>window.addEventListener('load', () => setTimeout(() => window.print(), 150))</script>
    </body></html>`)
  win.document.close()
}

/** «Короба»: этикетки печатаются заранее пачкой, ТСД потом сканирует готовый код. */
export function BoxesFeature() {
  const navigate = useNavigate()
  const toast = useToast()
  const [search] = useFilterParam('search', '')
  const [status] = useFilterParam('status', '')
  const [page, setPage] = usePageParam()
  const { setMany } = useFilterParamsActions()
  const [batch, setBatch] = useState('20')
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Список перечитывается после заведения пачки — useApi перезапускается по ключу.
  const [reloadKey, setReloadKey] = useState(0)

  // Debounce поиска: инпут меняется мгновенно, URL и запрос — после паузы.
  // Sync-эффект подхватывает внешнюю смену URL («Сбросить», «Назад»).
  const [searchInput, setSearchInput] = useState(search)
  useEffect(() => { setSearchInput(search) }, [search])
  useEffect(() => {
    if (searchInput === search) return
    const timer = setTimeout(() => setMany({ search: searchInput, page: '' }), 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, search])

  const { data, loading, error } = useApi(
    (signal) => getContainers({
      page,
      limit: PAGE_SIZE,
      search: search.trim() || undefined,
      status: status || undefined,
    }, signal),
    [page, search, status, reloadKey],
  )

  const items = useMemo(() => data?.items ?? [], [data])

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const allSelected = items.length > 0 && items.every((c) => selected.has(c.id))
  const toggleAll = useCallback(() => {
    setSelected((prev) => (items.every((c) => prev.has(c.id)) ? new Set() : new Set(items.map((c) => c.id))))
  }, [items])

  // Выбор живёт в пределах показанной страницы: смена страницы или фильтра его сбрасывает.
  useEffect(() => { setSelected(new Set()) }, [page, search, status, reloadKey])

  async function handleCreate() {
    const count = Number(batch)
    if (!Number.isFinite(count) || count < 1) {
      toast('Укажите количество коробов', 'error')
      return
    }
    setBusy(true)
    try {
      const res = await createContainers(count)
      const labels = await getContainerLabels(res.items.map((c) => c.id))
      printBoxLabels(labels.items)
      toast(`Заведено коробов: ${res.items.length}`, 'success')
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось завести короба', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function handlePrint() {
    const ids = [...selected]
    if (ids.length === 0) {
      toast('Выберите короба для печати', 'error')
      return
    }
    setBusy(true)
    try {
      const labels = await getContainerLabels(ids)
      printBoxLabels(labels.items)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось получить этикетки', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ListPage
      title="Короба"
      subtitle="тара задачи «Размещение по ячейкам»: этикетки печатаются заранее, ТСД сканирует готовый код"
      actions={
        <>
          <input
            className="input sm"
            style={{ width: 80 }}
            value={batch}
            onChange={(e) => setBatch(e.target.value)}
            inputMode="numeric"
            aria-label="Сколько коробов завести"
          />
          <button className="btn primary" disabled={busy} onClick={() => { void handleCreate() }}>
            <Icon name="plus" size={14} />Завести и напечатать
          </button>
          <button className="btn" disabled={busy || selected.size === 0} onClick={() => { void handlePrint() }}>
            <Icon name="print" size={14} />
            {selected.size > 0 ? `Печать (${selected.size})` : 'Печать'}
          </button>
        </>
      }
      filters={
        <FiltersBar>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Icon name="search" size={13} style={{ position: 'absolute', left: 9, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
            <input
              className="input sm"
              style={{ paddingLeft: 28, width: 220, paddingRight: searchInput ? 26 : undefined }}
              placeholder="Номер, ячейка, клиент…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            {searchInput && (
              <button
                style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'var(--c-text-subtle)' }}
                onClick={() => { setSearchInput(''); setMany({ search: '', page: '' }) }}
              ><Icon name="x" size={12} /></button>
            )}
          </div>
          <FilterSelect
            label="Статус"
            value={status}
            options={STATUS_OPTIONS}
            onChange={(v) => setMany({ status: v, page: '' })}
          />
          {/* Закрытые короба ждут развозки по местам — операционная очередь кладовщика. */}
          <button
            className={`btn sm${status === 'closed' ? ' primary' : ''}`}
            onClick={() => setMany({ status: status === 'closed' ? '' : 'closed', page: '' })}
          >
            Ждут размещения
          </button>
          {(search || status) && (
            <button className="btn ghost sm" onClick={() => { setSearchInput(''); setMany({ search: '', status: '', page: '' }) }}>
              <Icon name="x" size={12} />Сбросить
            </button>
          )}
        </FiltersBar>
      }
    >
      <Table>
        <thead>
          <tr>
            <th style={{ width: 34 }}>
              <Checkbox checked={allSelected} onChange={toggleAll} />
            </th>
            <th>Короб</th>
            <th>Статус</th>
            <th className="num">Шт.</th>
            <th>Ячейка</th>
            <th>Клиент</th>
            <th>Задача</th>
            <th>Заведён</th>
          </tr>
        </thead>
        <tbody>
          {loading && <SkeletonRows rows={6} cols={8} />}
          {!loading && error && (
            <tr><Td colSpan={8}><EmptyState title="Ошибка загрузки" sub={error.message} /></Td></tr>
          )}
          {!loading && !error && items.length === 0 && (
            <tr><Td colSpan={8}><EmptyState title="Коробов нет" sub="Заведите пачку и напечатайте этикетки" /></Td></tr>
          )}
          {!loading && !error && items.map((c: ContainerItem) => (
            <tr key={c.id}>
              <Td>
                <Checkbox checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
              </Td>
              <Td><span className="mono">{c.doc_number}</span></Td>
              <Td>
                <Badge tone={containerStatusTone(c.status) as BadgeTone} dot>
                  {CONTAINER_STATUS_LABELS[c.status]}
                </Badge>
              </Td>
              <Td className="num">{c.items_qty}</Td>
              <Td>{c.zone_name ?? '—'}</Td>
              <Td>{c.client_name ?? '—'}</Td>
              <Td>
                {c.doc_id ? (
                  <button className="btn ghost sm" onClick={() => navigate(`/inventory/shipments/${c.doc_id}`)}>
                    {c.doc_number_task ?? 'Задача'}
                  </button>
                ) : '—'}
              </Td>
              <Td>{fmtDate(c.created_at)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>

      <Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />
    </ListPage>
  )
}
