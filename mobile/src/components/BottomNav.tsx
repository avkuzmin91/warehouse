import { useNav, type TabName } from '../nav/NavContext'
import { Icon, type IconName } from './Icon'

const TABS: { name: TabName; label: string; icon: IconName }[] = [
  { name: 'tasks', label: 'Задачи', icon: 'list' },
  { name: 'trips', label: 'Рейсы', icon: 'truckIn' },
  { name: 'shipments', label: 'Отгрузки', icon: 'box' },
  { name: 'stock', label: 'Остатки', icon: 'layers' },
]

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
  const { rootTab, goTab, openScan } = useNav()
  return (
    <nav className="bottomnav">
      {TABS.slice(0, 2).map((t) => (
        <NavButton key={t.name} tab={t} active={rootTab === t.name} onClick={() => goTab(t.name)} />
      ))}

      <button className="scanfab" onClick={openScan} aria-label="Сканировать ШК">
        <span className="fab">
          <ScanGlyph size={24} />
        </span>
        <span className="navlabel">Скан</span>
      </button>

      {TABS.slice(2).map((t) => (
        <NavButton key={t.name} tab={t} active={rootTab === t.name} onClick={() => goTab(t.name)} />
      ))}
    </nav>
  )
}

function NavButton({
  tab,
  active,
  onClick,
}: {
  tab: { name: TabName; label: string; icon: IconName }
  active: boolean
  onClick: () => void
}) {
  return (
    <button className={`navbtn${active ? ' active' : ''}`} onClick={onClick}>
      <Icon name={tab.icon} size={22} />
      <span className="navlabel">{tab.label}</span>
    </button>
  )
}
