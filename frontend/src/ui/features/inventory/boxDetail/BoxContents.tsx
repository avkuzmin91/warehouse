import { Link } from 'react-router-dom'
import type { ContainerContentLine, ContainerItem } from '../../../../api/containersApi'
import { Card, CardHead } from '../../../primitives/Card'
import { Badge } from '../../../primitives/Badge'
import { Icon } from '../../../primitives/Icon'

type Props = {
  box: ContainerItem
  contents: ContainerContentLine[]
  busy: boolean
  onAdd: () => void
  onRemove: (line: ContainerContentLine) => void
}

type Group = {
  key: string
  sku: string | null
  product_name: string | null
  color_name: string | null
  quality: 'good' | 'defect'
  qty: number
  rows: ContainerContentLine[]
}

function variantKey(c: ContainerContentLine): string {
  return `${c.product_id}|${c.color_id ?? ''}|${c.size_id ?? ''}|${c.quality}`
}

/** Размеры сортируем как числа, когда они числа: 41, 42, 43 вместо «41, 42, 43» строкой. */
function bySize(a: ContainerContentLine, b: ContainerContentLine): number {
  const an = Number(a.size_name)
  const bn = Number(b.size_name)
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn
  return (a.size_name ?? '').localeCompare(b.size_name ?? '', 'ru')
}

/** Позиции короба, свёрнутые в «товар · цвет» с размерами внутри.
 *
 * Backend отдаёт строку на каждую строку задачи, поэтому один вариант может прийти
 * дважды; кладовщику важен физический итог, а изъятие всё равно идёт по варианту,
 * а не по строке задачи, — поэтому сворачиваем.
 */
function groupContents(contents: ContainerContentLine[]): Group[] {
  const merged = new Map<string, ContainerContentLine>()
  for (const c of contents) {
    const key = variantKey(c)
    const prev = merged.get(key)
    if (prev) prev.qty += c.qty
    else merged.set(key, { ...c })
  }
  const groups = new Map<string, Group>()
  for (const c of merged.values()) {
    const key = `${c.product_id}|${c.color_id ?? ''}|${c.quality}`
    const g = groups.get(key)
    if (g) {
      g.rows.push(c)
      g.qty += c.qty
    } else {
      groups.set(key, {
        key,
        sku: c.product_sku,
        product_name: c.product_name,
        color_name: c.color_name,
        quality: c.quality,
        qty: c.qty,
        rows: [c],
      })
    }
  }
  const list = [...groups.values()]
  for (const g of list) g.rows.sort(bySize)
  list.sort((a, b) => (a.product_name ?? '').localeCompare(b.product_name ?? '', 'ru'))
  return list
}

function emptyHint(box: ContainerItem): string {
  if (box.status === 'new') return 'Свободная этикетка: короб ещё не брали в задачу.'
  if (box.status === 'open') return 'Короб набирается на ТСД: скан этикетки короба → скан товара.'
  return 'Короб пуст — всё содержимое изъяли.'
}

export function BoxContents({ box, contents, busy, onAdd, onRemove }: Props) {
  const groups = groupContents(contents)
  const positions = groups.reduce((s, g) => s + g.rows.length, 0)
  const canEditContents = box.status === 'placed'
  // Короб набирается либо годным, либо браком; смешанный бывает только в старых данных.
  const qualities = new Set(groups.map((g) => g.quality))
  const defectOnly = qualities.size === 1 && qualities.has('defect')
  const mixed = qualities.size > 1

  return (
    <Card>
      <CardHead>
        <span className="card-head-title">Содержимое</span>
        {defectOnly && <Badge tone="danger">Брак</Badge>}
        {mixed && <Badge tone="warning">Смешанный</Badge>}
        <span style={{ flex: 1 }} />
        <span className="t-sub">
          {box.items_qty} шт.{positions > 0 ? ` · ${positions} поз.` : ''}
        </span>
        {canEditContents && (
          <button
            className="btn sm ghost"
            disabled={busy}
            title="Со стола или с полки — в этот короб. Короб однороден по качеству."
            onClick={onAdd}
          >
            <Icon name="plus" size={13} /> Доложить товар
          </button>
        )}
      </CardHead>

      {groups.length === 0 ? (
        <div className="t-sub" style={{ padding: 14 }}>
          {emptyHint(box)}
          {box.status === 'open' && box.doc_id && (
            <>
              {' '}
              <Link to={`/inventory/shipments/${box.doc_id}`}>{box.doc_number_task ?? 'Открыть задачу'}</Link>
            </>
          )}
        </div>
      ) : (
        <div>
          {groups.map((g, idx) => {
            // Позиция без размеров — одна строка: заводить под неё подзаголовок не за чем.
            const flat = g.rows.length === 1 && !g.rows[0].size_name
            return (
              <div
                key={g.key}
                style={{ borderBottom: idx < groups.length - 1 ? '1px solid var(--c-border)' : undefined }}
              >
                <div
                  className="row gap-8"
                  style={{
                    padding: '9px 14px',
                    background: flat ? 'transparent' : 'var(--c-bg-sunken)',
                    flexWrap: 'wrap',
                  }}
                >
                  <span className="mono" style={{ fontSize: 12 }}>{g.sku ?? '—'}</span>
                  <span style={{ fontWeight: 500 }}>{g.product_name ?? '—'}</span>
                  {g.color_name && <span className="t-sub">{g.color_name}</span>}
                  {g.quality === 'defect' && <Badge tone="danger">Брак</Badge>}
                  <span style={{ flex: 1 }} />
                  <span className="num" style={{ minWidth: 56, fontWeight: flat ? 500 : 600 }}>{g.qty}</span>
                  <span className="t-sub" style={{ width: 22 }}>шт.</span>
                  <span style={{ width: canEditContents ? 74 : 0 }}>
                    {flat && canEditContents && (
                      <button
                        className="btn sm ghost"
                        disabled={busy}
                        title="На эту же полку, в другое место или в другой короб"
                        onClick={() => onRemove(g.rows[0])}
                      >
                        Изъять
                      </button>
                    )}
                  </span>
                </div>
                {!flat && g.rows.map((r) => (
                  <div
                    key={variantKey(r)}
                    className="row gap-8"
                    style={{ padding: '6px 14px 6px 28px' }}
                  >
                    <span style={{ fontSize: 13 }}>{r.size_name ?? 'без размера'}</span>
                    <span style={{ flex: 1 }} />
                    <span className="num" style={{ minWidth: 56 }}>{r.qty}</span>
                    <span className="t-sub" style={{ width: 22 }}>шт.</span>
                    <span style={{ width: canEditContents ? 74 : 0 }}>
                      {canEditContents && (
                        <button
                          className="btn sm ghost"
                          disabled={busy}
                          title="На эту же полку, в другое место или в другой короб"
                          onClick={() => onRemove(r)}
                        >
                          Изъять
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
