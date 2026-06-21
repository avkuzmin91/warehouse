import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'

const TRIGGER = 64 // px вытягивания (после сопротивления), при котором срабатывает обновление
const MAX = 96 // потолок вытягивания
const RESIST = 0.5 // коэффициент сопротивления пальцу

// Pull-to-refresh для списочных экранов. Оборачивает скролл-контейнер:
// тянем вниз от самого верха → по отпусканию вызывается onRefresh.
// Нативного жеста в WKWebView без Ionic нет, поэтому реализовано на touch-событиях.
// Слушатели вешаются вручную (passive:false) — иначе нельзя погасить bounce браузера.
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
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [animate, setAnimate] = useState(false)
  const st = useRef({ startY: 0, active: false, pull: 0, refreshing: false })

  useEffect(() => {
    const el = elRef.current
    if (!el) return

    const onStart = (e: TouchEvent) => {
      if (st.current.refreshing || el.scrollTop > 0) {
        st.current.active = false
        return
      }
      st.current.startY = e.touches[0].clientY
      st.current.active = true
      setAnimate(false)
    }

    const onMove = (e: TouchEvent) => {
      if (!st.current.active || st.current.refreshing) return
      if (el.scrollTop > 0) {
        st.current.active = false
        st.current.pull = 0
        setPull(0)
        return
      }
      const dy = e.touches[0].clientY - st.current.startY
      if (dy <= 0) {
        st.current.pull = 0
        setPull(0)
        return
      }
      e.preventDefault()
      const d = Math.min(MAX, dy * RESIST)
      st.current.pull = d
      setPull(d)
    }

    const onEnd = () => {
      if (!st.current.active) return
      st.current.active = false
      setAnimate(true)
      if (st.current.pull >= TRIGGER) {
        st.current.refreshing = true
        st.current.pull = TRIGGER
        setRefreshing(true)
        setPull(TRIGGER)
        Promise.resolve(onRefresh()).finally(() => {
          st.current.refreshing = false
          st.current.pull = 0
          setRefreshing(false)
          setPull(0)
        })
      } else {
        st.current.pull = 0
        setPull(0)
      }
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    el.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [onRefresh])

  const progress = Math.min(1, pull / TRIGGER)

  return (
    <div ref={elRef} className={className} style={{ overscrollBehaviorY: 'contain' }}>
      <div
        className="ptr-track"
        style={{ height: pull, transition: animate ? 'height .25s ease' : 'none' }}
      >
        <div className="ptr-ind" style={{ opacity: Math.min(1, pull / 24) }}>
          {refreshing ? (
            <div className="spin spin-sm" />
          ) : (
            <span
              className="ptr-arrow"
              style={{
                transform: `rotate(${progress * 180}deg)`,
                transition: animate ? 'transform .2s ease' : 'none',
              }}
            >
              <Icon name="refresh" size={20} />
            </span>
          )}
        </div>
      </div>
      {children}
    </div>
  )
}
