import { useMemo } from 'react'
import { genCells } from './__mocks__/warehouseMap'

const COLS = 16
const ROWS = 8

const FILL_LABEL: Record<string, string> = {
  overflow: 'переполнено',
  high:     '85–95%',
  med:      '40–70%',
  low:      '10–35%',
  empty:    'пусто',
}

export function WarehouseMap() {
  const cells = useMemo(() => genCells(COLS, ROWS), [])

  return (
    <div
      className="warehouse-grid"
      style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}
    >
      {cells.map((cell, i) =>
        cell.kind === 'aisle' ? (
          <div key={i} className="wh-cell fill-aisle" />
        ) : (
          <div key={i} className={`wh-cell fill-${cell.fill}`} title={cell.code}>
            <span style={{ fontSize: 8.5, fontFamily: 'var(--font-mono)' }}>
              {cell.code.split('-')[0]}{cell.code.split('-')[1]}
            </span>
            <div className="wh-tip">
              <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{cell.code}</div>
              <div style={{ opacity: 0.7 }}>{cell.qty} шт · {FILL_LABEL[cell.fill]}</div>
            </div>
          </div>
        )
      )}
    </div>
  )
}
