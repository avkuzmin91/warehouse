import { Icon } from './Icon'
import { Sparkline } from './Sparkline'

interface KPIProps {
  label: string
  value: string | number
  valueColor?: string
  delta?: string
  deltaDir?: 'up' | 'down'
  spark?: number[]
  unit?: string
  onClick?: () => void
  active?: boolean
}

export function KPI({ label, value, valueColor, delta, deltaDir = 'up', spark, unit, onClick, active }: KPIProps) {
  const className = `kpi${onClick ? ' clickable' : ''}${active ? ' active' : ''}`
  const body = (
    <>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={valueColor ? { color: valueColor } : undefined}>
        {value}
        {unit && (
          <span style={{ fontSize: 13, color: 'var(--c-text-subtle)', fontWeight: 500, marginLeft: 4 }}>
            {unit}
          </span>
        )}
      </div>
      {delta && (
        <div className={`kpi-delta ${deltaDir}`}>
          <Icon name={deltaDir === 'up' ? 'arrowUp' : 'arrowDown'} size={12} />
          {delta}
        </div>
      )}
      {spark && (
        <div className="kpi-spark">
          <Sparkline data={spark} />
        </div>
      )}
    </>
  )
  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick}>
        {body}
      </button>
    )
  }
  return <div className={className}>{body}</div>
}
