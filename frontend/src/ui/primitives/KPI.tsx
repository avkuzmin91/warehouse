import { Icon } from './Icon'
import { Sparkline } from './Sparkline'

interface KPIProps {
  label: string
  value: string | number
  delta?: string
  deltaDir?: 'up' | 'down'
  spark?: number[]
  unit?: string
}

export function KPI({ label, value, delta, deltaDir = 'up', spark, unit }: KPIProps) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">
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
    </div>
  )
}
