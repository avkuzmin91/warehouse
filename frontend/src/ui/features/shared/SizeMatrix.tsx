import { useMemo } from 'react'
import type { BalanceGroupItem, BalanceItem } from '../../../api/balancesApi'

/** Ячейка сетки: остаток одного варианта, сведённый к паре «годный / брак».
 * Разрезы остатков считают бакеты по-разному (по товарам — четыре корзины,
 * по местам — строки статус×качество), поэтому сетка принимает уже готовые числа. */
export type SizeMatrixCell = {
  color_id: string | null
  color_name: string | null
  size_id: string | null
  size_name: string | null
  size_sort_order?: number | null
  good: number
  defect: number
}

function itemGood(i: BalanceItem): number {
  return i.storage_good + i.packing_good + i.packed_good + i.ready_good
}

function itemDefect(i: BalanceItem): number {
  return i.storage_defect + i.packing_defect + i.packed_defect + i.ready_defect
}

/** Ячейки сетки из группы разреза «По товарам». */
export function balanceGroupCells(group: BalanceGroupItem): SizeMatrixCell[] {
  return group.items.map((i) => ({
    color_id: i.color_id,
    color_name: i.color_name,
    size_id: i.size_id,
    size_name: i.size_name,
    size_sort_order: i.size_sort_order,
    good: itemGood(i),
    defect: itemDefect(i),
  }))
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

const cellKey = (colorId: string | null, sizeId: string | null) => `${colorId ?? ''}::${sizeId ?? ''}`

/** Сетка цвет×размер: строки — цвета, колонки — размеры (по sort_order справочника).
 * Ячейка — годный остаток варианта, брак — «+n»; «·» — вариант не существует. */
export function SizeMatrix({ cells }: { cells: SizeMatrixCell[] }) {
  const { colorRows, sizeCols, byCell } = useMemo(() => {
    const colors: { id: string | null; name: string }[] = []
    const colorSeen = new Set<string>()
    const sizeMap = new Map<string, { id: string | null; name: string; order: number | null }>()
    // Одна пара цвет×размер может прийти несколькими строками (разные статусы
    // и качество) — в сетке они складываются в одну ячейку.
    const sums = new Map<string, { good: number; defect: number }>()
    for (const c of cells) {
      const cKey = c.color_id ?? ''
      if (!colorSeen.has(cKey)) {
        colorSeen.add(cKey)
        colors.push({ id: c.color_id, name: c.color_name ?? 'Без цвета' })
      }
      const sKey = c.size_id ?? ''
      if (!sizeMap.has(sKey)) {
        sizeMap.set(sKey, { id: c.size_id, name: c.size_name ?? '—', order: c.size_sort_order ?? null })
      }
      const key = cellKey(c.color_id, c.size_id)
      const acc = sums.get(key)
      if (acc) {
        acc.good += c.good
        acc.defect += c.defect
      } else {
        sums.set(key, { good: c.good, defect: c.defect })
      }
    }
    const sizes = [...sizeMap.values()].sort((a, b) => {
      if (a.order != null && b.order != null) return a.order - b.order
      if (a.order != null) return -1
      if (b.order != null) return 1
      return a.name.localeCompare(b.name, 'ru')
    })
    return { colorRows: colors, sizeCols: sizes, byCell: sums }
  }, [cells])

  const sum = (pred: (c: SizeMatrixCell) => boolean) => {
    const rows = cells.filter(pred)
    return { good: rows.reduce((s, c) => s + c.good, 0), defect: rows.reduce((s, c) => s + c.defect, 0) }
  }

  const anyDefect = cells.some((c) => c.defect > 0)

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
            const rowSum = sum((x) => x.color_id === c.id)
            return (
              <tr key={c.id ?? ''}>
                <td style={{ padding: '4px 16px 4px 0', color: 'var(--c-text-muted)' }}>{c.name}</td>
                {sizeCols.map((s) => {
                  const cell = byCell.get(cellKey(c.id, s.id))
                  return (
                    <td key={s.id ?? ''} className="num" style={{ padding: '4px 12px', textAlign: 'right' }}>
                      {cell == null
                        ? <span style={{ color: 'var(--c-text-faint)' }}>·</span>
                        : <GD good={cell.good} defect={cell.defect} />}
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
                const colSum = sum((x) => x.size_id === s.id)
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
