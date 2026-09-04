import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import {
  CONTAINER_STATUS_LABELS,
  containerStatusTone,
  createContainers,
  deleteContainers,
  getContainerLabels,
  getContainers,
} from '../../../api/containersApi'
import type { ContainerItem, ContainerStatus } from '../../../api/containersApi'
import { printBoxLabels, POPUP_BLOCKED_HINT } from './boxLabels'
import { useLookups } from '../../../hooks/useLookups'
import { Combobox } from '../../data/Combobox'
import { Pagination } from '../../data/Pagination'
import { Icon } from '../../primitives/Icon'
import { Badge } from '../../primitives/Badge'
import type { BadgeTone } from '../../primitives/Badge'
import { Checkbox } from '../../primitives/Checkbox'
import { EmptyState } from '../../primitives/EmptyState'
import { Modal } from '../../feedback/Modal'
import { useToast } from '../../feedback/Toast'
import { useConfirm } from '../../feedback/ConfirmDialog'
import { fmtDate } from '../../../utils/format'

const PAGE_SIZE = 25
const BATCH_MAX = 200

// Место и клиент бывают длинными: в узкой колонке справочника они должны обрезаться,
// а не раздвигать таблицу.
const ELLIPSIS: CSSProperties = {
  display: 'block', maxWidth: 150,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}

const STATUS_OPTIONS = [
  { value: '', label: 'Все статусы' },
  ...(Object.keys(CONTAINER_STATUS_LABELS) as ContainerStatus[]).map((s) => ({
    value: s,
    label: CONTAINER_STATUS_LABELS[s],
  })),
]

/** Реестр коробов: единственное место, где короб заводят, ищут и списывают.
 *
 * Живёт в справочниках, потому что это учёт тары, а не работа: заведение пачки —
 * редкий ритуал у принтера, поиск «в каком коробе лежит SKU» — справка. Работа
 * (развозка по местам) живёт своим экраном и статусов коробов не показывает.
 *
 * Фильтры держим в локальном состоянии, а не в URL: панель — вкладка справочников,
 * её адрес занят `?type=`, и делить его с фильтрами незачем.
 */
export function BoxRegistryFeature() {
  const toast = useToast()
  const confirm = useConfirm()
  const { unloadingZones } = useLookups()

  const [items, setItems] = useState<ContainerItem[]>([])
  const [total, setTotal] = useState(0)
  const [freeTotal, setFreeTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  // Выбор держим объектами, а не id: он переживает пагинацию, а «Удалить» должно знать
  // статус короба и на той странице, которую сейчас не видно.
  const [selected, setSelected] = useState<Map<string, ContainerItem>>(new Map())
  const [createOpen, setCreateOpen] = useState(false)
  // Последняя заведённая пачка: по ней перепечатывают этикетки и откатывают опечатку.
  const [lastBatch, setLastBatch] = useState<ContainerItem[]>([])
  const [reloadKey, setReloadKey] = useState(0)

  // Debounce поиска: инпут меняется мгновенно, запрос — после паузы.
  useEffect(() => {
    if (searchInput === search) return
    const timer = setTimeout(() => { setSearch(searchInput); setPage(1) }, 250)
    return () => clearTimeout(timer)
  }, [searchInput, search])

  const load = useCallback((signal?: AbortSignal) => {
    setLoading(true)
    return getContainers({
      page,
      limit: PAGE_SIZE,
      status: status || undefined,
      zone_id: zoneId || undefined,
      search: search.trim() || undefined,
    }, signal)
      .then((r) => {
        if (signal?.aborted) return
        setItems(r.items)
        setTotal(r.total)
      })
      .catch((e) => { if (!signal?.aborted) toast(e instanceof Error ? e.message : 'Не удалось загрузить короба', 'error') })
      .finally(() => { if (!signal?.aborted) setLoading(false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status, zoneId, search])

  useEffect(() => {
    const ac = new AbortController()
    void load(ac.signal)
    return () => ac.abort()
  }, [load, reloadKey])

  // Запас чистых этикеток — отдельный счётчик: он не зависит от текущего фильтра.
  useEffect(() => {
    const ac = new AbortController()
    getContainers({ status: 'new', limit: 1 }, ac.signal)
      .then((r) => { if (!ac.signal.aborted) setFreeTotal(r.total) })
      .catch(() => {})
    return () => ac.abort()
  }, [reloadKey])

  const zoneOptions = useMemo(() => ([
    { value: '', label: 'Все места' },
    ...unloadingZones.filter((z) => z.is_active && !z.is_deleted).map((z) => ({ value: z.id, label: z.name })),
  ]), [unloadingZones])

  const allSelected = items.length > 0 && items.every((c) => selected.has(c.id))
  const toggleAll = () => setSelected((prev) => {
    const next = new Map(prev)
    if (items.every((c) => next.has(c.id))) items.forEach((c) => next.delete(c.id))
    else items.forEach((c) => next.set(c.id, c))
    return next
  })
  const toggleOne = (box: ContainerItem) => setSelected((prev) => {
    const next = new Map(prev)
    if (next.has(box.id)) next.delete(box.id)
    else next.set(box.id, box)
    return next
  })

  // Удалять можно только свободные: в выборке под печать может быть что угодно.
  const freeSelected = [...selected.values()].filter((c) => c.status === 'new').map((c) => c.id)

  const resetFilters = () => {
    setSearchInput(''); setSearch(''); setStatus(''); setZoneId(''); setPage(1)
  }

  async function print(ids: string[]) {
    setBusy(true)
    try {
      const res = await getContainerLabels(ids)
      if (!printBoxLabels(res.items)) toast(POPUP_BLOCKED_HINT, 'error')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось получить этикетки', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function handleCreated(created: ContainerItem[], withPrint: boolean) {
    setCreateOpen(false)
    setLastBatch(created)
    const from = created[0]?.doc_number
    const to = created[created.length - 1]?.doc_number
    toast(`Заведено коробов: ${created.length} (${from} … ${to})`, 'success')
    // Свободные короба лежат в конце общего списка — после заведения показываем именно их,
    // иначе только что напечатанная пачка оказывается на последней странице.
    setStatus('new')
    setPage(1)
    setReloadKey((k) => k + 1)
    if (withPrint) await print(created.map((c) => c.id))
  }

  async function handleDelete(ids: string[], what: string) {
    const ok = await confirm({
      title: 'Удалить короба?',
      body: `${what} будет убрано из реестра. Удаляются только свободные короба — те, что уже взяли в работу, останутся.`,
      danger: true,
      confirmLabel: 'Удалить',
    })
    if (!ok) return
    setBusy(true)
    try {
      const res = await deleteContainers(ids)
      const tail = res.skipped
        ? `, пропущено (уже в работе): ${res.skipped}${res.skipped_numbers.length ? ` — ${res.skipped_numbers.slice(0, 5).join(', ')}` : ''}`
        : ''
      toast(`Удалено коробов: ${res.deleted}${tail}`, res.deleted ? 'success' : 'info')
      setSelected(new Map())
      setLastBatch((prev) => prev.filter((c) => !ids.includes(c.id)))
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось удалить короба', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="t-wrap">
      <div className="card-head">
        <div className="card-head-title">
          Короба
          <span className="text-xs subtle" style={{ marginLeft: 10, fontWeight: 400 }}>
            свободных этикеток: <b className="num">{freeTotal}</b>
          </span>
        </div>
        <div className="right row gap-8">
          {loading && <span className="text-xs subtle">Обновление…</span>}
          {selected.size > 0 && (
            <button className="btn" disabled={busy} onClick={() => void print([...selected.keys()])}>
              <Icon name="print" size={14} />Печать ({selected.size})
            </button>
          )}
          {freeSelected.length > 0 && (
            <button
              className="btn danger"
              disabled={busy}
              onClick={() => void handleDelete(freeSelected, `Свободных коробов: ${freeSelected.length}`)}
            >
              <Icon name="trash" size={14} />Удалить ({freeSelected.length})
            </button>
          )}
          <button className="btn primary" disabled={busy} onClick={() => setCreateOpen(true)}>
            <Icon name="plus" size={14} />Завести короба
          </button>
        </div>
      </div>

      <div className="row gap-8" style={{ padding: '10px 14px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Icon name="search" size={13} style={{ position: 'absolute', left: 9, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
          <input
            className="input sm"
            style={{ paddingLeft: 28, width: 240, paddingRight: searchInput ? 26 : undefined }}
            placeholder="Номер, место, клиент, товар…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          {searchInput && (
            <button
              style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'var(--c-text-subtle)' }}
              onClick={() => { setSearchInput(''); setSearch(''); setPage(1) }}
            ><Icon name="x" size={12} /></button>
          )}
        </div>
        <select
          className="input sm"
          style={{ width: 150 }}
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1) }}
          aria-label="Статус короба"
        >
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <div style={{ minWidth: 200 }}>
          <Combobox
            options={zoneOptions}
            value={zoneId}
            onChange={(v) => { setZoneId(String(v ?? '')); setPage(1) }}
            placeholder="Место"
          />
        </div>
        <button
          className={`btn sm${status === 'new' ? ' primary' : ''}`}
          onClick={() => { setStatus(status === 'new' ? '' : 'new'); setPage(1) }}
        >
          Свободные
        </button>
        <button
          className={`btn sm${status === 'closed' ? ' primary' : ''}`}
          onClick={() => { setStatus(status === 'closed' ? '' : 'closed'); setPage(1) }}
        >
          Ждут размещения
        </button>
        {(search || status || zoneId) && (
          <button className="btn ghost sm" onClick={resetFilters}>
            <Icon name="x" size={12} />Сбросить
          </button>
        )}
      </div>

      <div className="text-xs subtle" style={{ padding: '0 14px 10px' }}>
        Тара задачи «Размещение по ячейкам»: этикетки печатаются заранее пачкой, дальше ТСД сканирует
        готовый код. Развозка закрытых коробов по местам — на экране{' '}
        <Link to="/inventory/boxes">Развозка по местам</Link>.
      </div>

      {lastBatch.length > 0 && (
        <div
          className="row gap-8"
          style={{
            alignItems: 'center', flexWrap: 'wrap', margin: '0 14px 12px', padding: '8px 12px',
            background: 'var(--c-bg-sunken)', borderRadius: 8,
          }}
        >
          <Icon name="archive" size={14} style={{ color: 'var(--c-accent)' }} />
          <span className="text-sm">
            Заведено {lastBatch.length}:{' '}
            <span className="mono">{lastBatch[0].doc_number} … {lastBatch[lastBatch.length - 1].doc_number}</span>
          </span>
          <span style={{ flex: 1 }} />
          <button className="btn sm" disabled={busy} onClick={() => void print(lastBatch.map((c) => c.id))}>
            <Icon name="print" size={13} />Напечатать ещё раз
          </button>
          <button
            className="btn sm danger"
            disabled={busy}
            onClick={() => void handleDelete(lastBatch.map((c) => c.id), 'Только что заведённая пачка')}
          >
            <Icon name="trash" size={13} />Удалить пачку
          </button>
          <button className="btn ghost sm icon" onClick={() => setLastBatch([])} title="Скрыть">
            <Icon name="x" size={13} />
          </button>
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
      <table className="t">
        <thead>
          <tr>
            <th style={{ width: 30 }}>
              <Checkbox checked={allSelected} onChange={toggleAll} />
            </th>
            <th>Короб</th>
            <th style={{ width: 130 }}>Статус</th>
            <th className="num" style={{ width: 70 }}>Шт.</th>
            <th style={{ width: 150 }}>Место</th>
            <th style={{ width: 150 }}>Клиент</th>
            <th style={{ width: 130 }}>Задача</th>
            <th style={{ width: 120 }}>Заведён</th>
            <th style={{ width: 40 }}></th>
          </tr>
        </thead>
        <tbody>
          {loading && items.length === 0 ? (
            <tr><td colSpan={9} style={{ textAlign: 'center', padding: 24 }}>
              <span className="text-sm muted">Загрузка…</span>
            </td></tr>
          ) : items.length === 0 ? (
            <tr><td colSpan={9} style={{ padding: 32 }}>
              <EmptyState
                title="Коробов нет"
                sub={search || status || zoneId ? 'Под этот фильтр ничего не подходит' : 'Заведите пачку и напечатайте этикетки'}
              />
            </td></tr>
          ) : (
            items.map((c) => (
              <tr key={c.id}>
                <td><Checkbox checked={selected.has(c.id)} onChange={() => toggleOne(c)} /></td>
                <td>
                  <Link to={`/inventory/boxes/${c.id}`} className="mono" style={{ fontWeight: 600 }}>
                    {c.doc_number}
                  </Link>
                </td>
                <td>
                  <Badge tone={containerStatusTone(c.status) as BadgeTone} dot>
                    {CONTAINER_STATUS_LABELS[c.status]}
                  </Badge>
                </td>
                <td className="num">{c.items_qty}</td>
                <td className="text-sm">
                  <span style={ELLIPSIS} title={c.zone_name ?? undefined}>{c.zone_name ?? '—'}</span>
                </td>
                <td className="text-sm">
                  <span style={ELLIPSIS} title={c.client_name ?? undefined}>{c.client_name ?? '—'}</span>
                </td>
                <td className="text-sm">
                  {c.doc_id ? (
                    <Link to={`/inventory/shipments/${c.doc_id}`} className="mono">
                      {c.doc_number_task ?? 'Задача'}
                    </Link>
                  ) : '—'}
                </td>
                <td className="text-sm">{fmtDate(c.created_at)}</td>
                <td>
                  {c.status === 'new' && (
                    <button
                      className="btn ghost icon sm"
                      disabled={busy}
                      title="Удалить свободный короб"
                      onClick={() => void handleDelete([c.id], `Короб ${c.doc_number}`)}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      </div>

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />

      <CreateBoxesModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={handleCreated} />
    </div>
  )
}

/** Заведение пачки: количество видно до подтверждения, печать — отдельным флажком. */
function CreateBoxesModal({ open, onClose, onCreated }: {
  open: boolean
  onClose: () => void
  onCreated: (created: ContainerItem[], withPrint: boolean) => void | Promise<void>
}) {
  const toast = useToast()
  const [count, setCount] = useState('20')
  const [withPrint, setWithPrint] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) { setCount('20'); setWithPrint(true) }
  }, [open])

  const n = Number(count)
  const valid = Number.isInteger(n) && n >= 1 && n <= BATCH_MAX

  const submit = async () => {
    if (!valid || busy) return
    setBusy(true)
    try {
      const res = await createContainers(n)
      await onCreated(res.items, withPrint)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось завести короба', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Завести короба"
      subtitle="Каждый короб получает свой номер и QR-этикетку"
      width={440}
      footer={
        <div className="row gap-8" style={{ justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={!valid || busy} onClick={() => void submit()}>
            {busy ? 'Заведение…' : `Завести${valid ? ` ${n} шт.` : ''}`}
          </button>
        </div>
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <label style={{ display: 'grid', gap: 4 }}>
          <span className="text-sm">Сколько коробов завести</span>
          <input
            className="input"
            style={{ width: 120 }}
            value={count}
            inputMode="numeric"
            autoFocus
            onChange={(e) => setCount(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
          />
        </label>
        {!valid && count.trim() !== '' && (
          <div className="text-xs" style={{ color: 'var(--c-danger)' }}>
            Введите целое число от 1 до {BATCH_MAX}
          </div>
        )}
        <label className="row gap-8" style={{ alignItems: 'center' }}>
          <Checkbox checked={withPrint} onChange={() => setWithPrint((v) => !v)} />
          <span className="text-sm">Сразу напечатать этикетки</span>
        </label>
        <div className="text-xs subtle">
          Номера идут подряд от последнего заведённого. Ошиблись с количеством — свободные короба
          можно удалить здесь же, пока их не взяли в работу.
        </div>
      </div>
    </Modal>
  )
}
