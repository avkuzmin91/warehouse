import { useState, useEffect, useRef } from 'react'
import { Badge } from '../../../primitives/Badge'
import type { BadgeTone } from '../../../primitives/Badge'

const KANBAN_PAGE = 20

export type KanbanColumnDef<S extends string> = { status: S; label: string; tone: BadgeTone }

type KanbanBoardProps<T extends { id: string }, S extends string> = {
  columns: KanbanColumnDef<S>[]
  gridCols: number
  /** Сериализованные фильтры (+ reload-тик): смена ключа сбрасывает колонки на первую страницу. */
  fetchKey: string
  fetchPage: (status: S, page: number, limit: number, signal: AbortSignal) => Promise<{ items: T[]; total: number }>
  renderCard: (item: T) => React.ReactNode
  highlight?: (item: T) => boolean
  onNavigate: (id: string) => void
}

export function KanbanBoard<T extends { id: string }, S extends string>({
  columns, gridCols, fetchKey, fetchPage, renderCard, highlight, onNavigate,
}: KanbanBoardProps<T, S>) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${gridCols}, 1fr)`, gap: 12, alignItems: 'start' }}>
      {columns.map((col) => (
        <KanbanColumn
          key={col.status}
          col={col}
          fetchKey={fetchKey}
          fetchPage={fetchPage}
          renderCard={renderCard}
          highlight={highlight}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  )
}

function KanbanColumn<T extends { id: string }, S extends string>({
  col, fetchKey, fetchPage, renderCard, highlight, onNavigate,
}: {
  col: KanbanColumnDef<S>
} & Omit<KanbanBoardProps<T, S>, 'columns' | 'gridCols'>) {
  const [items, setItems] = useState<T[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const prevFetchKey = useRef(fetchKey)

  const fetchPageRef = useRef(fetchPage)
  useEffect(() => { fetchPageRef.current = fetchPage })

  useEffect(() => {
    const ctrl = new AbortController()
    const isReset = prevFetchKey.current !== fetchKey
    prevFetchKey.current = fetchKey
    const activePage = isReset ? 1 : page
    if (isReset) {
      setPage(1)
      setItems([])
    }
    if (activePage === 1) setLoading(true); else setLoadingMore(true)
    fetchPageRef.current(col.status, activePage, KANBAN_PAGE, ctrl.signal)
      .then((res) => {
        if (ctrl.signal.aborted) return
        setTotal(res.total)
        setItems((prev) => activePage === 1 ? res.items : [...prev, ...res.items])
      })
      .catch(() => {})
      .finally(() => {
        if (ctrl.signal.aborted) return
        setLoading(false)
        setLoadingMore(false)
      })
    return () => ctrl.abort()
  }, [page, fetchKey, col.status])

  const hasMore = items.length < total

  return (
    <div style={{ background: 'var(--c-bg-sunken)', borderRadius: 10, padding: 10, minHeight: 200 }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '4px 6px 10px', gap: 8 }}>
        <Badge tone={col.tone} dot>{col.label}</Badge>
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
          {loading ? '…' : total}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0' }}>
            <div style={{ width: 20, height: 20, border: '2px solid var(--c-border)', borderTopColor: 'var(--c-accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          </div>
        ) : items.length === 0 ? (
          <div style={{ padding: '16px 6px', fontSize: 12, color: 'var(--c-text-faint)', textAlign: 'center' }}>Нет документов</div>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="card"
              style={{
                padding: 10, cursor: 'pointer',
                ...(highlight?.(item) ? { borderLeft: '2px solid var(--c-danger)' } : {}),
              }}
              onClick={() => onNavigate(item.id)}
            >
              {renderCard(item)}
            </div>
          ))
        )}
        {hasMore && (
          <button
            className="btn ghost sm"
            style={{ width: '100%', justifyContent: 'center', color: 'var(--c-text-subtle)', fontSize: 12 }}
            disabled={loadingMore}
            onClick={() => setPage((p) => p + 1)}
          >
            {loadingMore ? '…' : `Ещё ${total - items.length}`}
          </button>
        )}
      </div>
    </div>
  )
}
