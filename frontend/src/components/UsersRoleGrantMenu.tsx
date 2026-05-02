import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, RefObject } from 'react'
import type { AssignableUserRole, UserListItem } from '../api'

const ROLE_OPTIONS: { value: AssignableUserRole; label: string }[] = [
  { value: 'user', label: 'Пользователь' },
  { value: 'manager', label: 'Менеджер' },
  { value: 'client', label: 'Клиент' },
]

type Props = {
  target: UserListItem
  currentUserId: string | undefined
  onGrant: (userId: string, role: AssignableUserRole) => void
}

const MENU_GAP_PX = 4
const MENU_MIN_WIDTH_PX = 188
const VIEW_MARGIN_PX = 8
const MENU_Z = 10050

function getScrollableAncestors(start: HTMLElement | null): HTMLElement[] {
  const acc: HTMLElement[] = []
  let el: HTMLElement | null = start
  while (el) {
    const { overflowY, overflowX } = getComputedStyle(el)
    if (/(auto|scroll|overlay)/.test(overflowY) || /(auto|scroll|overlay)/.test(overflowX)) {
      acc.push(el)
    }
    el = el.parentElement
  }
  return acc
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max)
}

function useFixedRoleMenuPosition(
  open: boolean,
  blocked: boolean,
  triggerRef: RefObject<HTMLButtonElement | null>,
  menuRef: RefObject<HTMLUListElement | null>,
) {
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})

  const updatePosition = useCallback(() => {
    const btn = triggerRef.current
    const list = menuRef.current
    if (!open || blocked || !btn || !list) return

    const rect = btn.getBoundingClientRect()
    const vv = window.visualViewport
    const vw = vv?.width ?? window.innerWidth
    const vh = vv?.height ?? window.innerHeight

    const menuW = Math.max(MENU_MIN_WIDTH_PX, rect.width)
    let left = rect.right - menuW
    left = clamp(left, VIEW_MARGIN_PX, vw - menuW - VIEW_MARGIN_PX)

    const naturalH = list.offsetHeight || list.scrollHeight
    const maxH = Math.max(80, vh - VIEW_MARGIN_PX * 2)
    const useH = Math.min(naturalH, maxH)
    const needsScroll = naturalH > maxH

    let top = rect.bottom + MENU_GAP_PX
    const bottomEdge = top + useH
    const topIfAbove = rect.top - MENU_GAP_PX - useH
    const fitsAbove = topIfAbove >= VIEW_MARGIN_PX

    if (bottomEdge > vh - VIEW_MARGIN_PX && fitsAbove) {
      top = topIfAbove
    }

    top = clamp(top, VIEW_MARGIN_PX, vh - VIEW_MARGIN_PX - useH)

    const next: CSSProperties = {
      position: 'fixed',
      left,
      top,
      width: menuW,
      zIndex: MENU_Z,
      ...(needsScroll || top + useH > vh - VIEW_MARGIN_PX
        ? { maxHeight: maxH, overflowY: 'auto' as const }
        : {}),
    }
    setMenuStyle(next)
  }, [blocked, open, triggerRef, menuRef])

  useLayoutEffect(() => {
    if (!open || blocked) {
      setMenuStyle({})
      return
    }
    updatePosition()
    const raf = requestAnimationFrame(() => updatePosition())
    return () => cancelAnimationFrame(raf)
  }, [blocked, open, updatePosition])

  useEffect(() => {
    if (!open || blocked) return
    const btn = triggerRef.current
    const roots = getScrollableAncestors(btn)
    roots.forEach((el) => el.addEventListener('scroll', updatePosition, { passive: true }))
    window.addEventListener('resize', updatePosition)
    const vp = window.visualViewport
    vp?.addEventListener('resize', updatePosition)
    vp?.addEventListener('scroll', updatePosition)
    return () => {
      roots.forEach((el) => el.removeEventListener('scroll', updatePosition))
      window.removeEventListener('resize', updatePosition)
      vp?.removeEventListener('resize', updatePosition)
      vp?.removeEventListener('scroll', updatePosition)
    }
  }, [blocked, open, updatePosition])

  return menuStyle
}

export function UsersRoleGrantMenu({ target, currentUserId, onGrant }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuPortalRef = useRef<HTMLUListElement>(null)

  const blocked =
    currentUserId === target.id || target.role === 'admin'

  const menuStyle = useFixedRoleMenuPosition(open, blocked, triggerRef, menuPortalRef)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (wrapRef.current?.contains(t)) return
      if (menuPortalRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const menuContent =
    open && !blocked ? (
      <ul
        ref={menuPortalRef}
        className="users-role-menu__list"
        style={menuStyle}
        role="menu"
      >
        {ROLE_OPTIONS.map((r) => (
          <li key={r.value} role="presentation">
            <button
              type="button"
              className="users-role-menu__option"
              role="menuitem"
              onClick={() => {
                onGrant(target.id, r.value)
                setOpen(false)
              }}
            >
              {r.label}
            </button>
          </li>
        ))}
      </ul>
    ) : null

  return (
    <div ref={wrapRef} className="users-role-menu">
      <button
        ref={triggerRef}
        type="button"
        className="btn btn--secondary users-role-menu__trigger"
        disabled={blocked}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => {
          if (!blocked) setOpen((v) => !v)
        }}
      >
        Выдать роль
      </button>
      {typeof document !== 'undefined' && menuContent != null
        ? createPortal(menuContent, document.body)
        : null}
    </div>
  )
}
