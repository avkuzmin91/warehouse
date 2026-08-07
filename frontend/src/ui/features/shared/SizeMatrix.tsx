import { useMemo } from 'react'
import type { BalanceGroupItem, BalanceItem } from '../../../api/balancesApi'

function itemGood(i: BalanceItem): number {
  return i.storage_good + i.packing_good + i.packed_good + i.ready_good
}

function itemDefect(i: BalanceItem): number {
  return i.storage_defect + i.packing_defect + i.packed_defect + i.ready_defect
}

/** Ячейка матрицы: главное число — годный (им торгуют), брак — оранжевый «+n».
 * Красный 0 — размер вымыт, даже если физически лежит брак. */
function GD({ good, defect, bold }: { good: number; defect: number; bold?: boolean }) {
  return (
    <span
      style={{ whiteSpace: 'nowrap', fontWeight: bold ? 600 : undefined }}
      title={defect > 0 ? `годный ${good.toLocaleString('ru-RU')} · брак ${defect.toLocaleString('ru-RU')}` : undefined}
    >
      {good === 0
        ? <span style={{ color: 'var(--c-danger)' }}>0</span>
        : good.toLocaleString('ru-RU')}
      {defect > 0 && (
        <span style={{ color: 'var(--c-warning)', fontSize: 11.5 }}> +{defect.toLocaleString('ru-RU')}</span>
      )}
    </span>
  )
}

/** Сетка цвет×размер по группе остатков: строки — цвета, колонки — размеры
 * (по sort_order справочника). Ячейка — годный остаток варианта, брак — «+n»;
 * «·» — вариант не существует. */
export function SizeMatrix({ group }: { group: BalanceGroupItem }) {
  const { colorRows, sizeCols } = useMemo(() => {
    const colors: { id: string | null; name: string }[] = []
    const colorSeen = new Set<string>()
    const sizeMap = new Map<string, { id: string | null; name: string; order: number | null }>()
    for (const it of group.items) {
      const cKey = it.color_id ?? ''
      if (!colorSeen.has(cKey)) {
        colorSeen.add(cKey)
        colors.push({ id: it.color_id, name: it.color_name ?? 'Без цвета' })
      }
      const sKey = it.size_id ?? ''
      if (!sizeMap.has(sKey)) {
        sizeMap.set(sKey, { id: it.size_id, name: it.size_name ?? '—', order: it.size_sort_order ?? null })
      }
    }
    const sizes = [...sizeMap.values()].sort((a, b) => {
      if (a.order != null && b.order != null) return a.order - b.order
      if (a.order != null) return -1
      if (b.order != null) return 1
      return a.name.localeCompare(b.name, 'ru')
    })
    return { colorRows: colors, sizeCols: sizes }
  }, [group])

  const sum = (pred: (i: BalanceItem) => boolean) => {
    const rows = group.items.filter(pred)
    return { good: rows.reduce((s, i) => s + itemGood(i), 0), defect: rows.reduce((s, i) => s + itemDefect(i), 0) }
  }

  const anyDefect = group.items.some((i) => itemDefect(i) > 0)

  return (
    <div>
      <table style={{ borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '4px 16px 4px 0', fontWeight: 400, color: 'var(--c-text-subtle)', fontSize: 12 }}>Годный, шт</th>
            {sizeCols.map((s) => (
              <th key={s.id ?? ''} style={{ textAlign: 'right', padding: '4px 12px', fontWeight: 500 }}>{s.name}</th>
            ))}
            <th style={{ textAlign: 'right', padding: '4px 0 4px 16px', fontWeight: 600 }}>Σ</th>
          </tr>
        </thead>
        <tbody>
          {colorRows.map((c) => {
            const rowSum = sum((i) => i.color_id === c.id)
            return (
              <tr key={c.id ?? ''}>
                <td style={{ padding: '4px 16px 4px 0', color: 'var(--c-text-muted)' }}>{c.name}</td>
                {sizeCols.map((s) => {
                  const it = group.items.find((i) => i.color_id === c.id && i.size_id === s.id)
                  return (
                    <td key={s.id ?? ''} className="num" style={{ padding: '4px 12px', textAlign: 'right' }}>
                      {it == null
                        ? <span style={{ color: 'var(--c-text-faint)' }}>·</span>
                        : <GD good={itemGood(it)} defect={itemDefect(it)} />}
                    </td>
                  )
                })}
                <td className="num" style={{ padding: '4px 0 4px 16px', textAlign: 'right' }}>
                  <GD good={rowSum.good} defect={rowSum.defect} bold />
                </td>
              </tr>
            )
          })}
          {colorRows.length > 1 && (
            <tr style={{ borderTop: '1px solid var(--c-border)' }}>
              <td style={{ padding: '4px 16px 4px 0', color: 'var(--c-text-subtle)', fontSize: 12 }}>Σ</td>
              {sizeCols.map((s) => {
                const colSum = sum((i) => i.size_id === s.id)
                return (
                  <td key={s.id ?? ''} className="num" style={{ padding: '4px 12px', textAlign: 'right' }}>
                    <GD good={colSum.good} defect={colSum.defect} bold />
                  </td>
                )
              })}
              <td className="num" style={{ padding: '4px 0 4px 16px', textAlign: 'right' }}>
                <GD good={sum(() => true).good} defect={sum(() => true).defect} bold />
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--c-text-faint)' }}>
        {anyDefect && <><span style={{ color: 'var(--c-warning)' }}>+n</span> — брак · </>}
        <span style={{ color: 'var(--c-danger)' }}>0</span> — размер вымыт · «·» — варианта нет
      </div>
    </div>
  )
}
