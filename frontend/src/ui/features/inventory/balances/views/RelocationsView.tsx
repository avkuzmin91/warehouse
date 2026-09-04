import { useState, useEffect, useCallback } from 'react'
import { getZoneRelocations, undoWriteOff, INV_OP_LABELS, INV_QUALITY_LABELS, WRITEOFF_REASON_LABELS } from '../../../../../api/balancesApi'
import type { WriteOffReason } from '../../../../../api/balancesApi'
import type { ZoneRelocationItem } from '../../../../../api/balancesApi'
import { useLookups } from '../../../../../hooks/useLookups'
import { useFilterParam, usePageParam, useFilterParamsActions } from '../../../../../hooks/useFilterParams'
import { useCurrentUser } from '../../../../../hooks/useCurrentUser'
import { Table, Td } from '../../../../data/Table'
import { Pagination } from '../../../../data/Pagination'
import { FiltersBar, FilterCombobox } from '../../../../data/FiltersBar'
import { useConfirm } from '../../../../feedback/ConfirmDialog'
import { useToast } from '../../../../feedback/Toast'
import { Badge } from '../../../../primitives/Badge'
import type { BadgeTone } from '../../../../primitives/Badge'
import { Icon } from '../../../../primitives/Icon'
import { SkeletonRows } from '../../../../primitives/Skeleton'
import { EmptyState } from '../../../../primitives/EmptyState'
import { MOSCOW_TZ, parseMoscow } from '../../../../../utils/format'

// Роли, которым доступны ручные операции с остатками (совпадает с backend
// ensure_stock_write_access) — только они могут откатывать списание.
const STOCK_WRITE_ROLES = ['admin', 'manager', 'warehouse_manager', 'shift_supervisor', 'warehouse_head']

const PAGE_SIZE = 50

const QUALITY_TONE: Record<string, BadgeTone> = { good: 'success', defect: 'warning' }

/** Человекочитаемая операция движения по двум осям статуса. */
function moveLabel(item: ZoneRelocationItem): string {
  if (item.from_op === 'intake') return 'Приёмка'
  if (item.to_op === 'shipped') return 'Отгрузка'
  if (item.from_op === 'written_off') return 'Откат списания'
  if (item.to_op === 'written_off') {
    const reason = item.reason ? WRITEOFF_REASON_LABELS[item.reason as WriteOffReason] : undefined
    return reason ? `Списание · ${reason}` : 'Списание'
  }
  if (item.from_quality !== item.to_quality) {
    return `${INV_QUALITY_LABELS[item.from_quality]} → ${INV_QUALITY_LABELS[item.to_quality]}`
  }
  if (item.from_op !== item.to_op) {
    const from = INV_OP_LABELS[item.from_op as keyof typeof INV_OP_LABELS] ?? item.from_op
    const to = INV_OP_LABELS[item.to_op as keyof typeof INV_OP_LABELS] ?? item.to_op
    return `${from} → ${to}`
  }
  return 'Перемещение'
}

function fmtDateTime(iso: string): string {
  const d = parseMoscow(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: MOSCOW_TZ })
}

export function RelocationsView() {
  const [items, setItems] = useState<ZoneRelocationItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = usePageParam()
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useFilterParam('search', '')
  const [clientId, setClientId] = useFilterParam('client', '')
  // Развозка коробов — частый повод искать в журнале: отдельный фильтр вместо
  // перебора строк глазами.
  const [boxedOnly] = useFilterParam('boxed', '')
  const [undoing, setUndoing] = useState<string | null>(null)
  const { setMany } = useFilterParamsActions()
  const { clients } = useLookups()
  const { user } = useCurrentUser()
  const confirm = useConfirm()
  const toast = useToast()
  const canUndo = !!user && STOCK_WRITE_ROLES.includes(user.role)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getZoneRelocations({
        page,
        limit: PAGE_SIZE,
        search: search || undefined,
        client_id: clientId || undefined,
        boxed_only: boxedOnly === '1' || undefined,
      })
      setItems(res.items)
      setTotal(res.total)
    } finally {
      setLoading(false)
    }
  }, [page, search, clientId, boxedOnly])

  useEffect(() => { load() }, [load])

  async function handleUndo(item: ZoneRelocationItem) {
    const ok = await confirm({
      title: 'Откатить списание?',
      body: `${item.product_name ?? 'Товар'} — ${item.qty} шт вернётся на остатки${item.from_zone_name ? ` в «${item.from_zone_name}»` : ''}.`,
      confirmLabel: 'Откатить',
    })
    if (!ok) return
    setUndoing(item.id)
    try {
      await undoWriteOff(item.id)
      toast('Списание откачено', 'success')
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось откатить списание', 'error')
    } finally {
      setUndoing(null)
    }
  }

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <FiltersBar>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Icon name="search" size={13} style={{ position: 'absolute', left: 9, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
            <input
              className="input sm"
              style={{ paddingLeft: 28, width: 220, paddingRight: search ? 26 : undefined }}
              placeholder="Товар, SKU, короб…"
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
          <button
            className={`btn sm${boxedOnly === '1' ? ' primary' : ' ghost'}`}
            title="Только движения коробов: развозка и переносы тары"
            onClick={() => setMany({ boxed: boxedOnly === '1' ? '' : '1', page: '' })}
          >
            <Icon name="box" size={13} />Короба
          </button>
          {(search || clientId || boxedOnly) && (
            <button className="btn ghost sm" onClick={() => setMany({ search: '', client: '', boxed: '' })}>
              <Icon name="x" size={12} />Сбросить
            </button>
          )}
          <button className="btn ghost sm icon" title="Обновить" onClick={() => load()}>
            <Icon name="refresh" size={14} style={loading ? { animation: 'spin 0.7s linear infinite' } : undefined} />
          </button>
        </FiltersBar>
      </div>

      <Table>
        <thead>
          <tr>
            <th style={{ width: 130 }}>Дата</th>
            <th>Товар</th>
            <th>Клиент</th>
            <th style={{ width: 170 }}>Операция</th>
            <th style={{ width: 90 }}>Качество</th>
            <th>Откуда → Куда</th>
            <th style={{ width: 110 }}>Короб</th>
            <th style={{ textAlign: 'right', width: 90 }}>Кол-во</th>
            <th>Комментарий</th>
            <th style={{ width: 160 }}>Кто</th>
            <th style={{ width: 96 }} />
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <SkeletonRows rows={8} cols={11} />
          ) : items.length === 0 ? (
            <tr><td colSpan={11}><EmptyState title="Движений нет" sub="Здесь появятся движения товара между местоположениями и статусами" /></td></tr>
          ) : (
            items.map((item) => (
              <tr key={item.id}>
                <Td className="t-sub mono" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtDateTime(item.created_at)}</Td>
                <Td>
                  <div style={{ fontWeight: 500 }}>{item.product_name ?? '—'}</div>
                  <div className="t-sub mono">
                    {[item.product_sku, item.color_name, item.size_name].filter(Boolean).join(' · ')}
                  </div>
                </Td>
                <Td style={{ color: 'var(--c-text-muted)', fontSize: 13 }}>{item.client_name ?? '—'}</Td>
                <Td style={{ fontSize: 12.5 }}>{moveLabel(item)}</Td>
                <Td><Badge tone={QUALITY_TONE[item.to_quality] ?? ''}>{INV_QUALITY_LABELS[item.to_quality] ?? item.to_quality}</Badge></Td>
                <Td style={{ fontSize: 13 }}>
                  <span>{item.from_zone_name ?? 'Без места'}</span>
                  <Icon name="arrowRight" size={12} style={{ margin: '0 6px', color: 'var(--c-text-subtle)' }} />
                  <span style={{ fontWeight: 500 }}>{item.to_zone_name ?? 'Без места'}</span>
                </Td>
                <Td className="mono" style={{ fontSize: 12 }}>
                  {item.to_container ?? item.from_container ?? '—'}
                </Td>
                <Td className="num" style={{ fontWeight: 600 }}>{item.qty.toLocaleString('ru-RU')}</Td>
                <Td style={{ fontSize: 13, color: 'var(--c-text-muted)' }}>{item.comment ?? '—'}</Td>
                <Td className="t-sub" style={{ fontSize: 12 }}>{item.created_by_email ?? '—'}</Td>
                <Td style={{ textAlign: 'right' }}>
                  {item.to_op === 'written_off' && !item.reverses_id && (
                    item.is_reversed ? (
                      <span className="t-sub" style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>Откачено</span>
                    ) : canUndo ? (
                      <button
                        className="btn ghost sm"
                        title="Вернуть товар на остатки"
                        onClick={() => void handleUndo(item)}
                        disabled={undoing === item.id}
                      >
                        <Icon name="refresh" size={13} style={undoing === item.id ? { animation: 'spin 0.7s linear infinite' } : undefined} />
                        Откат
                      </button>
                    ) : null
                  )}
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
