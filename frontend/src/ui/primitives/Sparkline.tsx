interface SparklineProps {
  data: number[]
  color?: string
  height?: number
  fill?: boolean
}

export function Sparkline({ data, color, height = 32, fill = true }: SparklineProps) {
  const w = 120
  const h = height
  if (!data || data.length < 2) return <div style={{ height: h }} />

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const pts = data.map((v, i) => [
    (i / (data.length - 1)) * w,
    h - ((v - min) / range) * h * 0.85 - h * 0.075,
  ])
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const fillPath = `${path} L${w},${h} L0,${h} Z`

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: h, display: 'block' }}
    >
      {fill && (
        <path d={fillPath} className="spark-fill" style={color ? { fill: color, opacity: 0.1 } : undefined} />
      )}
      <path d={path} className="spark-line" style={color ? { stroke: color } : undefined} />
    </svg>
  )
}
