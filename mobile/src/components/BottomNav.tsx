import { useEffect, useState } from 'react'
import { getTasks } from '../api/tasksApi'
import { useNav } from '../nav/NavContext'
import type { TabDef } from '../nav/tabs'
import { Icon } from './Icon'

// Размер личной очереди /tasks для бейджа на вкладке «Задачи». Опрос — пока виден
// таб-бар (на детальных экранах он размонтирован, возврат на вкладку освежает счётчик).
function useTaskCount(): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    let live = true
    const tick = () =>
      getTasks({ limit: 1 })
        .then((r) => { if (live) setCount(r.total) })
        .catch(() => {})
    tick()
    const id = setInterval(tick, 60_000)
    const onVisible = () => { if (document.visibilityState === 'visible') void tick() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      live = false
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return count
}

function ScanGlyph({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M4 7V5.5A1.5 1.5 0 0 1 5.5 4H7M17 4h1.5A1.5 1.5 0 0 1 20 5.5V7M20 17v1.5a1.5 1.5 0 0 1-1.5 1.5H17M7 20H5.5A1.5 1.5 0 0 1 4 18.5V17" />
        <path d="M8 8v8M11 8v8M14 8v8M16.5 8v8" strokeWidth="1.5" />
      </g>
    </svg>
  )
}

export function BottomNav() {
  const { rootTab, goTab, openScan, tabs, showScan } = useNav()
  const taskCount = useTaskCount()

  if (!showScan) {
    // Менеджер: ровный ряд вкладок без скан-FAB.
    return (
      <nav className="bottomnav">
        {tabs.map((t) => (
          <NavButton key={t.name} tab={t} active={rootTab === t.name} taskCount={taskCount} onClick={() => goTab(t.name)} />
        ))}
      </nav>
    )
  }

  // Складские роли: вкладки делятся пополам, скан-FAB по центру.
  const half = Math.floor(tabs.length / 2)
  return (
    <nav className="bottomnav">
      {tabs.slice(0, half).map((t) => (
        <NavButton key={t.name} tab={t} active={rootTab === t.name} taskCount={taskCount} onClick={() => goTab(t.name)} />
      ))}

      <button className="scanfab" onClick={openScan} aria-label="Сканировать ШК">
        <span className="fab">
          <ScanGlyph size={24} />
        </span>
        <span className="navlabel">Скан</span>
      </button>

      {tabs.slice(half).map((t) => (
        <NavButton key={t.name} tab={t} active={rootTab === t.name} taskCount={taskCount} onClick={() => goTab(t.name)} />
      ))}
    </nav>
  )
}

function NavButton({
  tab,
  active,
  taskCount,
  onClick,
}: {
  tab: TabDef
  active: boolean
  taskCount: number
  onClick: () => void
}) {
  const badge = tab.name === 'tasks' && taskCount > 0
  return (
    <button className={`navbtn${active ? ' active' : ''}`} onClick={onClick}>
      <Icon name={tab.icon} size={22} />
      {badge && <span className="navbadge">{taskCount > 99 ? '99+' : taskCount}</span>}
      <span className="navlabel">{tab.label}</span>
    </button>
  )
}
