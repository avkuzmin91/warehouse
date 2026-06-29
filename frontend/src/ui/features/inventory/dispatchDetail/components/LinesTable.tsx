import { useState } from 'react'
import type { DispatchLine } from '../../../../../api/dispatchApi'
import { Icon } from '../../../../primitives/Icon'

type Props = {
  lines: DispatchLine[]
  /** Когда задан — колонка «Палеты» становится редактируемой (менеджер, до выставления счёта). */
  onSavePallets?: (lineId: string, pallets: number | null) => Promise<boolean>
}

/** Read-only состав отгрузки: вариант, магазин, ссылка на сайт, план/отгружено/остаток.
 *  Если передан `onSavePallets` — колонка палет редактируется инлайн. */
export function LinesTable({ lines, onSavePallets }: Props) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [savingLine, setSavingLine] = useState<string | null>(null)

  if (lines.length === 0) {
    return <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>Нет позиций</div>
  }
  const planTotal = lines.reduce((s, l) => s + l.qty, 0)
  const shippedTotal = lines.reduce((s, l) => s + l.shipped_qty, 0)
  const palletsTotal = lines.reduce((s, l) => s + (l.pallets_qty ?? 0), 0)

  const editable = !!onSavePallets

  function draftFor(l: DispatchLine): string {
    return drafts[l.id] ?? (l.pallets_qty != null ? String(l.pallets_qty) : '')
  }

  function parsed(raw: string): number | null {
    return raw === '' ? null : Math.max(0, parseInt(raw, 10))
  }

  function dirty(l: DispatchLine): boolean {
    return drafts[l.id] !== undefined && parsed(draftFor(l)) !== (l.pallets_qty ?? null)
  }

  async function save(l: DispatchLine) {
    if (!onSavePallets) return
    setSavingLine(l.id)
    try {
      const ok = await onSavePallets(l.id, parsed(draftFor(l)))
      if (ok) setDrafts((prev) => { const next = { ...prev }; delete next[l.id]; return next })
    } finally {
      setSavingLine(null)
    }
  }

  return (
    <table className="t">
      <thead>
        <tr>
          <th>Товар · вариант</th>
          <th style={{ width: 150 }}>Магазин</th>
          <th style={{ width: 80 }}>Ссылка</th>
          <th style={{ textAlign: 'right', width: 70 }}>План</th>
          <th style={{ textAlign: 'right', width: editable ? 120 : 70 }}>Палеты</th>
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
              {editable ? (
                <td>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4 }}>
                    <input
                      className="input sm num"
                      inputMode="numeric"
                      placeholder="0"
                      aria-label="Количество палет"
                      value={draftFor(l)}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/\D/g, '')
                        setDrafts((prev) => ({ ...prev, [l.id]: raw }))
                      }}
                      style={{ width: 56, textAlign: 'right' }}
                    />
                    {dirty(l) && (
                      <button
                        className="btn ghost icon sm"
                        title="Сохранить палеты"
                        disabled={savingLine === l.id}
                        onClick={() => void save(l)}
                      >
                        <Icon name={savingLine === l.id ? 'refresh' : 'save'} size={13} style={savingLine === l.id ? { animation: 'spin 0.7s linear infinite' } : undefined} />
                      </button>
                    )}
                  </div>
                </td>
              ) : (
                <td className="num">{l.pallets_qty ?? <span style={{ color: 'var(--c-text-faint)' }}>—</span>}</td>
              )}
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
