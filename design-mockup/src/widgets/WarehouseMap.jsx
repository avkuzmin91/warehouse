// === Warehouse mini-map visualization ===
// Renders a heat-map of cell occupancy
const WarehouseMap = ({ compact = false }) => {
  const cols = 16;
  const rows = 8;
  // generate deterministic occupancy
  const cells = React.useMemo(() => {
    const out = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // aisles
        if (r === 3) {
          out.push({ kind: 'aisle' });
          continue;
        }
        // Zone label by column
        const zone = c < 4 ? 'A' : c < 8 ? 'B' : c < 12 ? 'C' : 'D';
        const seed = Math.sin((r + 1) * 7 + (c + 1) * 11) * 10000;
        const v = (seed - Math.floor(seed));
        let fill = 'empty';
        if (v < 0.08) fill = 'empty';
        else if (v < 0.35) fill = 'low';
        else if (v < 0.7) fill = 'med';
        else if (v < 0.93) fill = 'high';
        else fill = 'overflow';
        const aisleR = r > 3 ? r - 1 : r;
        const code = `${zone}-${String(c + 1).padStart(2, '0')}-${String(aisleR + 1).padStart(2, '0')}`;
        out.push({ kind: 'cell', fill, code, qty: Math.round(v * 240) });
      }
    }
    return out;
  }, []);

  return (
    <div className="warehouse-grid" style={{gridTemplateColumns: `repeat(${cols}, 1fr)`}}>
      {cells.map((cell, i) => (
        cell.kind === 'aisle' ? (
          <div key={i} className="wh-cell fill-aisle"/>
        ) : (
          <div key={i} className={`wh-cell fill-${cell.fill}`} title={cell.code}>
            <span style={{fontSize: 8.5, fontFamily: 'var(--font-mono)'}}>
              {cell.code.split('-')[0]}{cell.code.split('-')[1]}
            </span>
            <div className="wh-tip">
              <div style={{fontFamily: 'var(--font-mono)', fontWeight: 500}}>{cell.code}</div>
              <div style={{opacity: 0.7}}>{cell.qty} шт · {cell.fill === 'overflow' ? 'переполнено' : cell.fill === 'high' ? '85–95%' : cell.fill === 'med' ? '40–70%' : cell.fill === 'low' ? '10–35%' : 'пусто'}</div>
            </div>
          </div>
        )
      ))}
    </div>
  );
};

window.WarehouseMap = WarehouseMap;
