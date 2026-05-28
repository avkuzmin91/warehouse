function buildCells(cols: number, rows: number) {
  const cells: Array<
    | { kind: 'aisle' }
    | { kind: 'cell'; fill: 'empty' | 'low' | 'med' | 'high' | 'overflow'; code: string; qty: number }
  > = []

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (r === 3) {
        cells.push({ kind: 'aisle' })
        continue
      }

      const zone = c < 4 ? 'A' : c < 8 ? 'B' : c < 12 ? 'C' : 'D'
      const seed = Math.sin((r + 1) * 7 + (c + 1) * 11) * 10000
      const value = seed - Math.floor(seed)

      let fill: 'empty' | 'low' | 'med' | 'high' | 'overflow' = 'empty'
      if (value < 0.08) fill = 'empty'
      else if (value < 0.35) fill = 'low'
      else if (value < 0.7) fill = 'med'
      else if (value < 0.93) fill = 'high'
      else fill = 'overflow'

      const shelfRow = r > 3 ? r - 1 : r
      const code = `${zone}-${String(c + 1).padStart(2, '0')}-${String(shelfRow + 1).padStart(2, '0')}`
      cells.push({ kind: 'cell', fill, code, qty: Math.round(value * 240) })
    }
  }

  return cells
}

const COLS = 16
const ROWS = 8
const CELLS = buildCells(COLS, ROWS)

const FILL_LABELS: Record<'empty' | 'low' | 'med' | 'high' | 'overflow', string> = {
  empty: 'пусто',
  low: '10-35%',
  med: '40-70%',
  high: '85-95%',
  overflow: 'переполнено',
}

export function WarehouseMap() {
  return (
    <div className="warehouse-grid" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
      {CELLS.map((cell, index) => {
        if (cell.kind === 'aisle') {
          return <div key={index} className="wh-cell fill-aisle" />
        }

        const zoneLabel = `${cell.code.split('-')[0]}${cell.code.split('-')[1]}`

        return (
          <div key={cell.code} className={`wh-cell fill-${cell.fill}`} title={cell.code}>
            <span style={{ fontSize: 8.5, fontFamily: 'var(--font-mono)' }}>{zoneLabel}</span>
            <div className="wh-tip">
              <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{cell.code}</div>
              <div style={{ opacity: 0.7 }}>
                {cell.qty} шт · {FILL_LABELS[cell.fill]}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
