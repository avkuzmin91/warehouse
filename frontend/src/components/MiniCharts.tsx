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
              <path d={d} fill="none" stroke={s.color} strokeWidth={2}>
                <title>
                  {s.values.map((v, i) => `${labels[i] ?? i}: ${v}`).join('; ')}
                </title>
              </path>
              {s.values.map((v, i) => (
                <circle key={i} cx={xAt(i)} cy={yAt(v)} r={2.5} fill={s.color}>
                  <title>{`${labels[i] ?? String(i)} · ${s.name}: ${v}`}</title>
                </circle>
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

export type HorizontalBarChartItem = { label: string; value: number }

export type HorizontalBarChartProps = {
  items: HorizontalBarChartItem[]
  barColor?: string
  /** Ширина области подписи слева */
  labelWidth?: number
  width?: number
  rowHeight?: number
}

/** Горизонтальные столбцы: подпись слева, значение справа; tooltip через &lt;title&gt;. */
export function HorizontalBarChart({
  items,
  barColor = '#64748b',
  labelWidth = 168,
  width = 720,
  rowHeight = 36,
}: HorizontalBarChartProps) {
  const n = Math.max(1, items.length)
  const padR = 56
  const padT = 12
  const padB = 12
  const gap = 8
  const height = padT + padB + n * rowHeight + (n - 1) * gap
  const barAreaW = Math.max(80, width - labelWidth - padR - 16)
  const maxVal = Math.max(1, ...items.map((i) => i.value))

  return (
    <div className="mini-chart mini-chart--horizontal" role="img" aria-label="Горизонтальная диаграмма">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        {items.map((it, idx) => {
          const y = padT + idx * (rowHeight + gap)
          const bw = (it.value / maxVal) * barAreaW
          const ty = y + rowHeight / 2 + 5
          const truncate = (s: string) => (s.length > 22 ? `${s.slice(0, 21)}…` : s)
          return (
            <g key={`${it.label}-${idx}`}>
              <text
                x={4}
                y={ty}
                className="mini-chart__axis mini-chart__axis--bar-label"
                style={{ fontSize: 12 }}
              >
                {truncate(it.label)}
                <title>{it.label}</title>
              </text>
              <rect
                x={labelWidth}
                y={y + 6}
                width={Math.max(bw, it.value > 0 ? 3 : 0)}
                height={rowHeight - 12}
                fill={barColor}
                rx={6}
              >
                <title>{`${it.label}: ${it.value}`}</title>
              </rect>
              <text
                x={labelWidth + barAreaW + 8}
                y={ty}
                className="mini-chart__axis"
                style={{ fontSize: 13 }}
              >
                {it.value}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export type StackedHorizontalRow = {
  label: string
  inflow: number
  outflow: number
}

export type StackedHorizontalBarChartProps = {
  items: StackedHorizontalRow[]
  inflowColor?: string
  outflowColor?: string
  labelWidth?: number
  width?: number
  rowHeight?: number
}

/** Составная полоса по клиенту: поступления + отгрузки (stacked). */
export function StackedHorizontalBarChart({
  items,
  inflowColor = '#38bdf8',
  outflowColor = '#fb923c',
  labelWidth = 168,
  width = 720,
  rowHeight = 38,
}: StackedHorizontalBarChartProps) {
  const fmt = (n: number) => new Intl.NumberFormat('ru-RU').format(Math.max(0, n))
  const n = Math.max(1, items.length)
  const padR = 24
  const padT = 12
  const padB = 12
  const gap = 10
  const legendH = 28
  const height = padT + padB + legendH + n * rowHeight + (n - 1) * gap
  const barAreaW = Math.max(120, width - labelWidth - padR - 16)
  const maxSum = Math.max(
    1,
    ...items.map((r) => Math.max(0, r.inflow) + Math.max(0, r.outflow)),
  )

  const truncate = (s: string) => (s.length > 22 ? `${s.slice(0, 21)}…` : s)
  /** Минимальная ширина сегмента (px), при которой рисуем цифру на столбике */
  const minSegWForLabel = 36
  const barLabelFill = 'rgba(255, 255, 255, 0.92)'
  const barLabelStroke = 'rgba(12, 8, 28, 0.35)'

  return (
    <div className="mini-chart mini-chart--stacked-h" role="img" aria-label="Составная диаграмма по клиентам">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        <g transform={`translate(0, ${padT})`}>
          <rect x={labelWidth} y={0} width={12} height={12} fill={inflowColor} rx={2} />
          <text x={labelWidth + 18} y={11} className="mini-chart__axis" style={{ fontSize: 11 }}>
            Поступления
          </text>
          <rect x={labelWidth + 110} y={0} width={12} height={12} fill={outflowColor} rx={2} />
          <text x={labelWidth + 126} y={11} className="mini-chart__axis" style={{ fontSize: 11 }}>
            Отгрузки
          </text>
        </g>
        {items.map((row, idx) => {
          const y = padT + legendH + idx * (rowHeight + gap)
          const total = Math.max(0, row.inflow) + Math.max(0, row.outflow)
          const rowW = total <= 0 ? 0 : (total / maxSum) * barAreaW
          const wIn = total <= 0 ? 0 : (row.inflow / total) * rowW
          const wOut = total <= 0 ? 0 : (row.outflow / total) * rowW
          const ty = y + rowHeight / 2 + 5
          const barY = y + 7
          const barH = rowHeight - 14
          const barLabelY = barH / 2 + 4
          return (
            <g key={`${row.label}-${idx}`}>
              <text x={4} y={ty} className="mini-chart__axis mini-chart__axis--bar-label" style={{ fontSize: 12 }}>
                {truncate(row.label)}
                <title>{row.label}</title>
              </text>
              <g transform={`translate(${labelWidth}, ${barY})`}>
                {row.inflow > 0 ? (
                  <>
                    <rect width={wIn} height={barH} fill={inflowColor} rx={4}>
                      <title>{`Поступления: ${fmt(row.inflow)}`}</title>
                    </rect>
                    {wIn >= minSegWForLabel ? (
                      <text
                        x={wIn / 2}
                        y={barLabelY}
                        textAnchor="middle"
                        className="mini-chart__stacked-bar-label"
                        fill={barLabelFill}
                        stroke={barLabelStroke}
                        strokeWidth={0.35}
                        paintOrder="stroke fill"
                        style={{ fontSize: 11, fontWeight: 700 }}
                      >
                        {fmt(row.inflow)}
                      </text>
                    ) : null}
                  </>
                ) : null}
                {row.outflow > 0 ? (
                  <>
                    <rect x={wIn} width={wOut} height={barH} fill={outflowColor} rx={4}>
                      <title>{`Отгрузки: ${fmt(row.outflow)}`}</title>
                    </rect>
                    {wOut >= minSegWForLabel ? (
                      <text
                        x={wIn + wOut / 2}
                        y={barLabelY}
                        textAnchor="middle"
                        className="mini-chart__stacked-bar-label"
                        fill={barLabelFill}
                        stroke={barLabelStroke}
                        strokeWidth={0.35}
                        paintOrder="stroke fill"
                        style={{ fontSize: 11, fontWeight: 700 }}
                      >
                        {fmt(row.outflow)}
                      </text>
                    ) : null}
                  </>
                ) : null}
                {total === 0 ? (
                  <text x={4} y={barLabelY} className="mini-chart__axis" style={{ fontSize: 11 }}>
                    0 · 0
                  </text>
                ) : null}
              </g>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
