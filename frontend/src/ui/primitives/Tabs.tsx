interface TabItem {
  id: string
  label: string
  count?: number
}

interface TabsProps {
  tabs: (TabItem | string)[]
  active: string
  onChange: (id: string) => void
}

export function Tabs({ tabs, active, onChange }: TabsProps) {
  return (
    <div className="tabs">
      {tabs.map((t) => {
        const id = typeof t === 'string' ? t : t.id
        const label = typeof t === 'string' ? t : t.label
        const count = typeof t === 'object' ? t.count : undefined
        return (
          <div
            key={id}
            className={`tab ${id === active ? 'active' : ''}`}
            onClick={() => onChange(id)}
          >
            {label}
            {count !== undefined && (
              <span style={{ marginLeft: 6, color: 'var(--c-text-subtle)', fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>
                {count}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
