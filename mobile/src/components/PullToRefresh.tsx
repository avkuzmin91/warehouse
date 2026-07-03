import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'

const TRIGGER = 64 // px вытягивания (после сопротивления), при котором срабатывает обновление
const MAX = 96 // потолок вытягивания
const RESIST = 0.5 // коэффициент сопротивления пальцу
const IND_H = 44 // высота слоя индикатора; спрятан за верхней кромкой на -IND_H

// Pull-to-refresh для списочных экранов. Оборачивает скролл-контейнер:
// тянем вниз от самого верха → по отпусканию вызывается onRefresh.
// Нативного жеста в WKWebView без Ionic нет, поэтому реализовано на touch-событиях.
//
// Производительность: постоянно висит только passive touchstart. Non-passive
// touchmove (нужен, чтобы гасить bounce браузера) навешивается лишь когда жест
// реально может начаться (scrollTop === 0) и снимается по touchend/touchcancel —
// обычный скролл списка не ждёт JS. Индикатор — абсолютный слой поверх контента,
// двигается через transform напрямую в DOM (без setState/relayout на каждый пиксель).
export function PullToRefresh({
  onRefresh,
  className = '',
  children,
}: {
  onRefresh: () => Promise<unknown> | unknown
  className?: string
  children: ReactNode
}) {
  const elRef = useRef<HTMLDivElement>(null)
  const indRef = useRef<HTMLDivElement>(null)
  const arrowRef = useRef<HTMLSpanElement>(null)
  const [refreshing, setRefreshing] = useState(false)
  const st = useRef({ startY: 0, pull: 0, refreshing: false })
  // Слушатели вешаются один раз; актуальный onRefresh читаем через ref.
  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh

  useEffect(() => {
    const el = elRef.current
    if (!el) return

    const setInd = (pull: number, animate: boolean) => {
      const ind = indRef.current
      if (ind) {
        ind.style.transition = animate ? 'transform .25s ease, opacity .25s ease' : 'none'
        ind.style.transform = `translateY(${pull - IND_H}px)`
        ind.style.opacity = String(Math.min(1, pull / 24))
      }
      const arrow = arrowRef.current
      if (arrow) {
        arrow.style.transition = animate ? 'transform .2s ease' : 'none'
        arrow.style.transform = `rotate(${Math.min(1, pull / TRIGGER) * 180}deg)`
      }
    }

    const detach = () => {
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }

    const onMove = (e: TouchEvent) => {
      if (st.current.refreshing) return
      if (el.scrollTop > 0) {
        st.current.pull = 0
        setInd(0, false)
        detach()
        return
      }
      const dy = e.touches[0].clientY - st.current.startY
      if (dy <= 0) {
        st.current.pull = 0
        setInd(0, false)
        return
      }
      e.preventDefault()
      const d = Math.min(MAX, dy * RESIST)
      st.current.pull = d
      setInd(d, false)
    }

    const onEnd = () => {
      detach()
      const pull = st.current.pull
      st.current.pull = 0
      if (pull >= TRIGGER && !st.current.refreshing) {
        st.current.refreshing = true
        setRefreshing(true)
        setInd(TRIGGER, true)
        Promise.resolve(onRefreshRef.current()).finally(() => {
          st.current.refreshing = false
          setRefreshing(false)
          setInd(0, true)
        })
      } else {
        setInd(0, true)
      }
    }

    const onStart = (e: TouchEvent) => {
      if (st.current.refreshing || el.scrollTop > 0) return
      st.current.startY = e.touches[0].clientY
      st.current.pull = 0
      detach()
      el.addEventListener('touchmove', onMove, { passive: false })
      el.addEventListener('touchend', onEnd, { passive: true })
      el.addEventListener('touchcancel', onEnd, { passive: true })
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      detach()
    }
  }, [])

  return (
    <div ref={elRef} className={className} style={{ overscrollBehaviorY: 'contain', position: 'relative' }}>
      <div ref={indRef} className="ptr-ind" style={{ transform: `translateY(${-IND_H}px)`, opacity: 0 }}>
        <div className="ptr-chip">
          {refreshing ? (
            <div className="spin spin-sm" />
          ) : (
            <span ref={arrowRef} className="ptr-arrow" style={{ display: 'inline-flex' }}>
              <Icon name="refresh" size={20} />
            </span>
          )}
        </div>
      </div>
      {children}
    </div>
  )
}
