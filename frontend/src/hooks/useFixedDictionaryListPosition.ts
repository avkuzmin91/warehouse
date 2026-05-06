import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'

const LIST_PORTAL_GAP_PX = 6
const LIST_PORTAL_VIEW_MARGIN_PX = 8
const LIST_PORTAL_Z = 10050

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

/** Позиция выпадающего списка в `position: fixed` относительно поля (портал в `document.body`). */
export function useFixedDictionaryListPosition(
  enabled: boolean,
  open: boolean,
  disabled: boolean,
  wrapRef: RefObject<HTMLDivElement | null>,
  listRef: RefObject<HTMLElement | null>,
  /** Пробросьте число, меняющееся при смене содержимого списка (например items.length), чтобы пересчитать позицию после загрузки данных. */
  layoutRevision = 0,
) {
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})

  const updatePosition = useCallback(() => {
    const wrap = wrapRef.current
    const list = listRef.current
    if (!enabled || !open || disabled || !wrap || !list) return

    const rect = wrap.getBoundingClientRect()
    const vv = window.visualViewport
    const vw = vv?.width ?? window.innerWidth
    const vh = vv?.height ?? window.innerHeight

    const menuW = rect.width
    let left = rect.left
    left = clamp(left, LIST_PORTAL_VIEW_MARGIN_PX, vw - menuW - LIST_PORTAL_VIEW_MARGIN_PX)

    const naturalH = list.offsetHeight || list.scrollHeight
    const maxH = Math.max(80, vh - LIST_PORTAL_VIEW_MARGIN_PX * 2)
    const useH = Math.min(naturalH, maxH)
    const needsScroll = naturalH > maxH

    let top = rect.bottom + LIST_PORTAL_GAP_PX
    const bottomEdge = top + useH
    const topIfAbove = rect.top - LIST_PORTAL_GAP_PX - useH
    const fitsAbove = topIfAbove >= LIST_PORTAL_VIEW_MARGIN_PX

    if (bottomEdge > vh - LIST_PORTAL_VIEW_MARGIN_PX && fitsAbove) {
      top = topIfAbove
    }

    top = clamp(top, LIST_PORTAL_VIEW_MARGIN_PX, vh - LIST_PORTAL_VIEW_MARGIN_PX - useH)

    const next: CSSProperties = {
      position: 'fixed',
      left,
      top,
      width: menuW,
      zIndex: LIST_PORTAL_Z,
      ...(needsScroll || top + useH > vh - LIST_PORTAL_VIEW_MARGIN_PX
        ? { maxHeight: maxH, overflowY: 'auto' as const }
        : {}),
    }
    setMenuStyle(next)
  }, [disabled, enabled, open, wrapRef, listRef])

  useLayoutEffect(() => {
    if (!enabled || !open || disabled) {
      setMenuStyle({})
      return
    }
    updatePosition()
    const raf = requestAnimationFrame(() => updatePosition())
    return () => cancelAnimationFrame(raf)
  }, [disabled, enabled, open, updatePosition, layoutRevision])

  useEffect(() => {
    if (!enabled || !open || disabled) return
    const wrap = wrapRef.current
    const roots = getScrollableAncestors(wrap)
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
  }, [disabled, enabled, open, updatePosition, wrapRef, layoutRevision])

  return menuStyle
}
