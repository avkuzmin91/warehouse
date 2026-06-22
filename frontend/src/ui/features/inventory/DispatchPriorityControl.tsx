import { useEffect, useRef, useState, type MouseEvent } from 'react'
import {
  DISPATCH_PRIORITY_HIGH,
  DISPATCH_PRIORITY_URGENT,
  dispatchPriorityLabel,
  updateDispatchPriority,
  type DispatchListItem,
} from '../../../api/dispatchApi'
import { useToast } from '../../feedback/Toast'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { canEditShipmentPriority } from '../../../utils/access'
import { Icon } from '../../primitives/Icon'

type DispatchPriorityControlProps = {
  dispatch: Pick<DispatchListItem, 'id' | 'status' | 'priority_rank'>
  canEdit: boolean
  onSaved: (priorityRank: number | null) => void
}

const LEVELS: (number | null)[] = [DISPATCH_PRIORITY_URGENT, DISPATCH_PRIORITY_HIGH, null]

const MENU_HEIGHT = 4 + 3 * 32 + 4

function stop(e: MouseEvent<HTMLElement>) {
  e.stopPropagation()
}

function priorityDotColor(rank: number | null): string {
  if (rank === DISPATCH_PRIORITY_URGENT) return 'var(--c-danger)'
  if (rank === DISPATCH_PRIORITY_HIGH) return 'var(--c-warning)'
  return 'var(--c-border-strong)'
}

function PriorityDot({ rank }: { rank: number | null }) {
  return (
    <span style={{
      width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
      background: priorityDotColor(rank),
    }} />
  )
}

export function DispatchPriorityControl({ dispatch, canEdit, onSaved }: DispatchPriorityControlProps) {
  const toast = useToast()
  const { user } = useCurrentUser()
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [saving, setSaving] = useState(false)

  const rank = dispatch.priority_rank ?? null

  useEffect(() => {
    if (!open) return
    const onDown = (e: globalThis.MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return
      if (btnRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onScroll = () => setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  const editable =
    canEdit &&
    canEditShipmentPriority(user) &&
    dispatch.status !== 'shipped' &&
    dispatch.status !== 'cancelled'

  function toggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      const top = r.bottom + 4 + MENU_HEIGHT > window.innerHeight
        ? r.top - MENU_HEIGHT - 4
        : r.bottom + 4
      setPos({ top, left: r.left })
    }
    setOpen((s) => !s)
  }

  async function save(next: number | null) {
    if (next === rank) return
    setSaving(true)
    try {
      await updateDispatchPriority(dispatch.id, next)
      toast(`Приоритет: ${dispatchPriorityLabel(next)}`, 'success')
      onSaved(next)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка сохранения приоритета', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (!editable) {
    return rank ? (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 500 }}>
        <PriorityDot rank={rank} />
        {dispatchPriorityLabel(rank)}
      </span>
    ) : (
      <span style={{ color: 'var(--c-text-faint)', fontSize: 12 }}>—</span>
    )
  }

  return (
    <span style={{ display: 'inline-flex' }} onClick={stop}>
      <button
        ref={btnRef}
        type="button"
        className="btn ghost sm"
        title="Приоритет в очереди отгрузок"
        onClick={toggle}
        style={{
          height: 26,
          padding: '0 8px',
          gap: 6,
          fontWeight: rank ? 500 : 400,
          color: rank ? 'var(--c-text)' : 'var(--c-text-subtle)',
        }}
      >
        <PriorityDot rank={rank} />
        {dispatchPriorityLabel(rank)}
        <Icon
          name={saving ? 'refresh' : 'chevDown'}
          size={11}
          style={saving
            ? { animation: 'spin 0.7s linear infinite' }
            : { color: 'var(--c-text-faint)' }}
        />
      </button>
      {open && pos && (
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            zIndex: 50,
            background: 'var(--c-bg-elev)',
            border: '1px solid var(--c-border)',
            borderRadius: 'var(--r-lg)',
            boxShadow: 'var(--sh-2)',
            minWidth: 150,
            padding: 4,
          }}
        >
          {LEVELS.map((lvl) => (
            <div
              key={String(lvl)}
              onClick={() => { setOpen(false); void save(lvl) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                height: 32, padding: '0 10px',
                borderRadius: 'var(--r-md)',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: lvl === rank ? 600 : 400,
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--c-bg-hover)' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = '' }}
            >
              <span style={{ width: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                {lvl === rank
                  ? <Icon name="check" size={13} style={{ color: 'var(--c-accent)' }} />
                  : <PriorityDot rank={lvl} />}
              </span>
              {dispatchPriorityLabel(lvl)}
            </div>
          ))}
        </div>
      )}
    </span>
  )
}
