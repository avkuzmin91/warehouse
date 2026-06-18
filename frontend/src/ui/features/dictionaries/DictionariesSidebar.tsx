import { Icon } from '../../primitives/Icon'
import { DICTIONARY_TYPES, type DictionaryTypeId } from './types'

interface DictionariesSidebarProps {
  active: DictionaryTypeId
  onSelect: (id: DictionaryTypeId) => void
  counts: Partial<Record<DictionaryTypeId, number>>
  isAdmin: boolean
}

function NavItem({ d, active, onSelect, counts }: {
  d: typeof DICTIONARY_TYPES[0]
  active: DictionaryTypeId
  onSelect: (id: DictionaryTypeId) => void
  counts: Partial<Record<DictionaryTypeId, number>>
}) {
  return (
    <div
      key={d.id}
      className={`nav-item ${active === d.id ? 'active' : ''}`}
      style={{ height: 32 }}
      onClick={() => onSelect(d.id)}
    >
      <Icon name={d.icon} size={14} className="nav-icon" />
      <span>{d.name}</span>
      {counts[d.id] !== undefined && (
        <span className="nav-count">{counts[d.id]}</span>
      )}
    </div>
  )
}

export function DictionariesSidebar({ active, onSelect, counts, isAdmin }: DictionariesSidebarProps) {
  const visible = DICTIONARY_TYPES.filter((d) => !d.adminOnly || isAdmin)
  const mainItems = visible.filter((d) => d.group === 'main')
  const systemItems = visible.filter((d) => d.group === 'system')
  return (
    <div className="card" style={{ position: 'sticky', top: 0 }}>
      <div style={{ padding: 8 }}>
        {mainItems.map((d) => (
          <NavItem key={d.id} d={d} active={active} onSelect={onSelect} counts={counts} />
        ))}
      </div>
      <div style={{ borderTop: '1px solid var(--c-border)', padding: 8 }}>
        <div className="text-xs subtle" style={{ padding: '4px 8px 6px' }}>Системные</div>
        {systemItems.map((d) => (
          <NavItem key={d.id} d={d} active={active} onSelect={onSelect} counts={counts} />
        ))}
      </div>
    </div>
  )
}
