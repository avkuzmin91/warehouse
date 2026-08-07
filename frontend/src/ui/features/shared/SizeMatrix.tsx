import { useMemo } from 'react'
import type { BalanceGroupItem } from '../../../api/balancesApi'

/** Сетка цвет×размер по группе остатков: строки — цвета, колонки — размеры
 * (по sort_order справочника). Ячейка — общий остаток варианта; «·» — вариант
 * не существует, красный 0 — вымытый размер. */
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

  const cell = (colorId: string | null, sizeId: string | null): number | null => {
    const it = group.items.find((i) => i.color_id === colorId && i.size_id === sizeId)
    return it ? it.total : null
  }

  return (
    <table style={{ borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr>
          <th style={{ textAlign: 'left', padding: '4px 16px 4px 0', fontWeight: 400, color: 'var(--c-text-subtle)', fontSize: 12 }}>Всего, шт</th>
          {sizeCols.map((s) => (
            <th key={s.id ?? ''} style={{ textAlign: 'right', padding: '4px 12px', fontWeight: 500 }}>{s.name}</th>
          ))}
          <th style={{ textAlign: 'right', padding: '4px 0 4px 16px', fontWeight: 600 }}>Σ</th>
        </tr>
      </thead>
      <tbody>
        {colorRows.map((c) => {
          const rowSum = group.items.filter((i) => i.color_id === c.id).reduce((s, i) => s + i.total, 0)
          return (
            <tr key={c.id ?? ''}>
              <td style={{ padding: '4px 16px 4px 0', color: 'var(--c-text-muted)' }}>{c.name}</td>
              {sizeCols.map((s) => {
                const v = cell(c.id, s.id)
                return (
                  <td key={s.id ?? ''} className="num" style={{ padding: '4px 12px', textAlign: 'right' }}>
                    {v == null
                      ? <span style={{ color: 'var(--c-text-faint)' }}>·</span>
                      : v === 0
                        ? <span style={{ color: 'var(--c-danger)' }}>0</span>
                        : v.toLocaleString('ru-RU')}
                  </td>
                )
              })}
              <td className="num" style={{ padding: '4px 0 4px 16px', textAlign: 'right', fontWeight: 600 }}>
                {rowSum.toLocaleString('ru-RU')}
              </td>
            </tr>
          )
        })}
        {colorRows.length > 1 && (
          <tr style={{ borderTop: '1px solid var(--c-border)' }}>
            <td style={{ padding: '4px 16px 4px 0', color: 'var(--c-text-subtle)', fontSize: 12 }}>Σ</td>
            {sizeCols.map((s) => {
              const colSum = group.items.filter((i) => i.size_id === s.id).reduce((sum, i) => sum + i.total, 0)
              return (
                <td key={s.id ?? ''} className="num" style={{ padding: '4px 12px', textAlign: 'right', fontWeight: 600 }}>
                  {colSum.toLocaleString('ru-RU')}
                </td>
              )
            })}
            <td className="num" style={{ padding: '4px 0 4px 16px', textAlign: 'right', fontWeight: 600 }}>
              {group.total.toLocaleString('ru-RU')}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}
