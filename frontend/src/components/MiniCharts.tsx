/**
 * Лёгкие SVG-графики без сторонних зависимостей.
 * Назначение — визуальная подсветка трендов в analytics-дашборде.
 */

export type LineSeries = { name: string; color: string; values: number[] }

export type LineChartProps = {
  labels: string[]
  series: LineSeries[]
  width?: number
  height?: number
  yLabel?: string
}

function niceTicks(maxValue: number): number {
  if (maxValue <= 0) return 1
  const exp = Math.pow(10, Math.floor(Math.log10(maxValue)))
  const n = maxValue / exp
  let mult = 1
  if (n <= 1) mult = 1
  else if (n <= 2) mult = 2
  else if (n <= 5) mult = 5
  else mult = 10
  return mult * exp
}

export function LineChart({
  labels,
  series,
  width = 720,
  height = 240,
  yLabel,
}: LineChartProps) {
  const padL = 44
  const padR = 16
  const padT = 16
  const padB = 32
  const innerW = Math.max(1, width - padL - padR)
  const innerH = Math.max(1, height - padT - padB)
  const allValues = series.flatMap((s) => s.values)
  const maxVal = niceTicks(Math.max(0, ...allValues, 1))
  const n = labels.length

  const xAt = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const yAt = (v: number) => padT + innerH - (v / maxVal) * innerH

  const ticks = [0, maxVal / 4, maxVal / 2, (3 * maxVal) / 4, maxVal]

  // Подписи оси X — равномерно отбираем до 8 меток.
  const xLabelStep = n > 8 ? Math.ceil(n / 8) : 1

  return (
    <div className="mini-chart" role="img" aria-label="Линейный график">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        {ticks.map((t, idx) => {
          const y = yAt(t)
          return (
            <g key={idx}>
              <line x1={padL} x2={width - padR} y1={y} y2={y} className="mini-chart__grid" />
              <text x={padL - 6} y={y + 4} textAnchor="end" className="mini-chart__axis">
                {Math.round(t)}
              </text>
            </g>
          )
        })}
        {labels.map((lab, i) => {
          if (i % xLabelStep !== 0 && i !== n - 1) return null
          const x = xAt(i)
          return (
            <text
              key={`xl-${i}`}
              x={x}
              y={height - 10}
              textAnchor="middle"
              className="mini-chart__axis"
            >
              {lab}
            </text>
          )
        })}
        {series.map((s) => {
          if (s.values.length === 0) return null
          const d = s.values
            .map((v, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`)
            .join(' ')
          return (
            <g key={s.name}>
              <path d={d} fill="none" stroke={s.color} strokeWidth={2} />
              {s.values.map((v, i) => (
                <circle key={i} cx={xAt(i)} cy={yAt(v)} r={2.5} fill={s.color} />
              ))}
            </g>
          )
        })}
        {yLabel ? (
          <text x={4} y={padT - 4} className="mini-chart__axis">
            {yLabel}
          </text>
        ) : null}
      </svg>
      <div className="mini-chart__legend">
        {series.map((s) => (
          <span key={s.name} className="mini-chart__legend-item">
            <span className="mini-chart__legend-swatch" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  )
}

export type BarChartItem = { label: string; value: number }
export type BarChartProps = {
  data: BarChartItem[]
  color?: string
  width?: number
  height?: number
}

export function BarChart({ data, color = '#7f9bff', width = 720, height = 260 }: BarChartProps) {
  const n = data.length || 1
  const padL = 12
  const padR = 12
  const padT = 16
  // Динамический нижний отступ под наклонные подписи: чем длиннее самая длинная
  // подпись, тем больше места нужно под повёрнутый текст.
  const maxLabelLen = data.reduce((m, d) => Math.max(m, d.label.length), 0)
  const truncatedLen = Math.min(maxLabelLen, 18)
  // Угол поворота: при малом числе столбцов оставляем горизонтально.
  const rotate = n > 6
  const padB = rotate ? Math.min(110, 26 + truncatedLen * 5.2) : 30
  const innerW = Math.max(1, width - padL - padR)
  const innerH = Math.max(1, height - padT - padB)
  const maxVal = Math.max(0, ...data.map((d) => d.value), 1)
  const barW = (innerW / n) * 0.72
  const gap = (innerW / n) * 0.28

  const truncate = (s: string) => (s.length > 18 ? `${s.slice(0, 17)}…` : s)

  return (
    <div className="mini-chart" role="img" aria-label="Гистограмма">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        {data.map((d, i) => {
          const h = (d.value / maxVal) * innerH
          const x = padL + i * (barW + gap) + gap / 2
          const y = padT + innerH - h
          const cx = x + barW / 2
          const labelY = padT + innerH + 12
          return (
            <g key={`${d.label}-${i}`}>
              <rect x={x} y={y} width={barW} height={h} fill={color} rx={3}>
                <title>{`${d.label}: ${d.value}`}</title>
              </rect>
              <text
                x={cx}
                y={y - 4}
                textAnchor="middle"
                className="mini-chart__axis"
              >
                {d.value}
              </text>
              {rotate ? (
                <text
                  x={cx}
                  y={labelY}
                  textAnchor="end"
                  className="mini-chart__axis mini-chart__axis--bar-label"
                  transform={`rotate(-35 ${cx} ${labelY})`}
                >
                  {truncate(d.label)}
                  <title>{d.label}</title>
                </text>
              ) : (
                <text
                  x={cx}
                  y={labelY + 2}
                  textAnchor="middle"
                  className="mini-chart__axis mini-chart__axis--bar-label"
                >
                  {truncate(d.label)}
                  <title>{d.label}</title>
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
