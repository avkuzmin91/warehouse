import { Icon } from '../../primitives/Icon'
import { DICTIONARY_TYPES, type DictionaryTypeId } from './types'

interface DictionariesSidebarProps {
  active: DictionaryTypeId
  onSelect: (id: DictionaryTypeId) => void
  isAdmin: boolean
  hasFinanceAccess: boolean
}

function NavItem({ d, active, onSelect }: {
  d: typeof DICTIONARY_TYPES[0]
  active: DictionaryTypeId
  onSelect: (id: DictionaryTypeId) => void
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
    </div>
  )
}

export function DictionariesSidebar({ active, onSelect, isAdmin, hasFinanceAccess }: DictionariesSidebarProps) {
  const visible = DICTIONARY_TYPES.filter((d) => (!d.adminOnly || isAdmin) && (!d.financeOnly || hasFinanceAccess))
  const mainItems = visible.filter((d) => d.group === 'main')
  const pricingItems = visible.filter((d) => d.group === 'pricing')
  const systemItems = visible.filter((d) => d.group === 'system')
  return (
    <div className="card" style={{ position: 'sticky', top: 0 }}>
      <div style={{ padding: 8 }}>
        {mainItems.map((d) => (
          <NavItem key={d.id} d={d} active={active} onSelect={onSelect} />
        ))}
      </div>
      {pricingItems.length > 0 && (
        <div style={{ borderTop: '1px solid var(--c-border)', padding: 8 }}>
          <div className="text-xs subtle" style={{ padding: '4px 8px 6px' }}>Стоимости услуг</div>
          {pricingItems.map((d) => (
            <NavItem key={d.id} d={d} active={active} onSelect={onSelect} />
          ))}
        </div>
      )}
      <div style={{ borderTop: '1px solid var(--c-border)', padding: 8 }}>
        <div className="text-xs subtle" style={{ padding: '4px 8px 6px' }}>Системные</div>
        {systemItems.map((d) => (
          <NavItem key={d.id} d={d} active={active} onSelect={onSelect} />
        ))}
      </div>
    </div>
  )
}
