import type { DispatchLine } from '../../../../../api/dispatchApi'

/** Read-only состав отгрузки: вариант, магазин, ссылка на сайт, план/отгружено/остаток. */
export function LinesTable({ lines }: { lines: DispatchLine[] }) {
  if (lines.length === 0) {
    return <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>Нет позиций</div>
  }
  const planTotal = lines.reduce((s, l) => s + l.qty, 0)
  const shippedTotal = lines.reduce((s, l) => s + l.shipped_qty, 0)
  const palletsTotal = lines.reduce((s, l) => s + (l.pallets_qty ?? 0), 0)
  return (
    <table className="t">
      <thead>
        <tr>
          <th>Товар · вариант</th>
          <th style={{ width: 150 }}>Магазин</th>
          <th style={{ width: 80 }}>Ссылка</th>
          <th style={{ textAlign: 'right', width: 70 }}>План</th>
          <th style={{ textAlign: 'right', width: 70 }}>Палеты</th>
          <th style={{ textAlign: 'right', width: 90 }}>Отгружено</th>
          <th style={{ textAlign: 'right', width: 80 }}>Остаток</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => {
          const remaining = Math.max(0, l.qty - l.shipped_qty)
          return (
            <tr key={l.id}>
              <td>
                <div style={{ fontWeight: 500, fontSize: 13 }}>{l.product_name}</div>
                <div className="t-sub mono">{[l.product_sku, l.color_name, l.size_name].filter(Boolean).join(' · ')}</div>
                {l.sku_pending && <span className="badge warning" style={{ marginTop: 4 }}>Без SKU</span>}
              </td>
              <td>{l.store_name ?? <span style={{ color: 'var(--c-text-faint)' }}>—</span>}</td>
              <td>
                {l.site_url ? (
                  <a href={l.site_url} target="_blank" rel="noreferrer" title={l.site_url} style={{ color: 'var(--c-accent)', fontSize: 12.5, fontWeight: 500 }}>
                    Открыть
                  </a>
                ) : (
                  <span style={{ color: 'var(--c-text-faint)' }}>—</span>
                )}
              </td>
              <td className="num">{l.qty}</td>
              <td className="num">{l.pallets_qty ?? <span style={{ color: 'var(--c-text-faint)' }}>—</span>}</td>
              <td className="num"><span style={{ color: l.shipped_qty > 0 ? 'var(--c-success)' : 'var(--c-text-subtle)' }}>{l.shipped_qty}</span></td>
              <td className="num">{remaining}</td>
            </tr>
          )
        })}
      </tbody>
      <tfoot>
        <tr style={{ background: 'var(--c-bg-sunken)' }}>
          <td colSpan={3} style={{ padding: '10px 12px', fontWeight: 500, fontSize: 12.5 }}>Итого</td>
          <td className="num" style={{ padding: '10px 12px', fontWeight: 600 }}>{planTotal}</td>
          <td className="num" style={{ padding: '10px 12px', fontWeight: 600 }}>{palletsTotal}</td>
          <td className="num" style={{ padding: '10px 12px', fontWeight: 600 }}>{shippedTotal}</td>
          <td className="num" style={{ padding: '10px 12px', fontWeight: 600 }}>{Math.max(0, planTotal - shippedTotal)}</td>
        </tr>
      </tfoot>
    </table>
  )
}
