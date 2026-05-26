// TODO: заменить на реальные данные через GET /api/warehouse/map

export type Fill = 'empty' | 'low' | 'med' | 'high' | 'overflow'

export type CellKind = 'aisle' | 'cell'

export interface AisleCell {
  kind: 'aisle'
}

export interface StorageCell {
  kind: 'cell'
  fill: Fill
  code: string
  qty: number
  zone: 'A' | 'B' | 'C' | 'D'
}

export type MapCell = AisleCell | StorageCell

export function genCells(cols: number, rows: number): MapCell[] {
  const out: MapCell[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r === 3) {
        out.push({ kind: 'aisle' })
        continue
      }
      const zone = c < 4 ? 'A' : c < 8 ? 'B' : c < 12 ? 'C' : 'D'
      const seed = Math.sin((r + 1) * 7 + (c + 1) * 11) * 10000
      const v = seed - Math.floor(seed)
      let fill: Fill
      if (v < 0.08) fill = 'empty'
      else if (v < 0.35) fill = 'low'
      else if (v < 0.7) fill = 'med'
      else if (v < 0.93) fill = 'high'
      else fill = 'overflow'
      const aisleR = r > 3 ? r - 1 : r
      const code = `${zone}-${String(c + 1).padStart(2, '0')}-${String(aisleR + 1).padStart(2, '0')}`
      out.push({ kind: 'cell', fill, code, qty: Math.round(v * 240), zone })
    }
  }
  return out
}
