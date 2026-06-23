import type { DictionaryItem } from '../../../../../api/domainTypes'
import type { TripReceiptItem } from '../../../../../api/tripsApi'
import { Icon } from '../../../../primitives/Icon'
import { Combobox } from '../../../../data/Combobox'

/** Одна строка раскладки: сколько штук кладётся в какую ячейку. */
export type ReceivePlacement = { qty: number; zoneId: string }

/* Приёмка inbound-рейса при разгрузке: по каждой строке аллокации кладовщик раскладывает
 * фактически принятое по ячейкам — список «кол-во + место» с возможностью добавить ещё
 * ячейку (товар не влез в одну). Принято по строке = сумма ячеек. По умолчанию одна
 * ячейка на всю аллокацию рейса. Недовоз/сверх плана — обе ситуации нормальны.
 * Завершение разгрузки проводит приход — товар встаёт «На хранении». */
export function UnloadReceiveTable({ receipts, zones, placementsByLine, onPlacements, showErrors }: {
  receipts: TripReceiptItem[]
  zones: DictionaryItem[]
  placementsByLine: Record<string, ReceivePlacement[]>
  onPlacements: (lineId: string, rows: ReceivePlacement[]) => void
  showErrors: boolean
}) {
  const withAlloc = receipts.filter((r) => r.allocations.length > 0)
  if (withAlloc.length === 0) return null

  return (
    <div style={{ border: '1px solid var(--c-border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid var(--c-border)', background: 'var(--c-bg-sunken)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <Icon name="forklift" size={14} style={{ color: 'var(--c-text-subtle)' }} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>Приёмка — посчитайте принятое и разложите по ячейкам</span>
      </div>

      {withAlloc.map((r) => (
        <div key={r.line_id} style={{ borderBottom: '1px solid var(--c-border)' }}>
          <div style={{ padding: '8px 14px 2px', fontSize: 12, color: 'var(--c-text-muted)', display: 'flex', gap: 8 }}>
            <span className="mono" style={{ fontWeight: 600 }}>{r.receipt_number}</span>
            <span>·</span>
            <span>{r.client_name ?? '—'}</span>
          </div>
          {r.allocations.map((a) => {
            const rows = placementsByLine[a.line_id] ?? [{ qty: a.qty, zoneId: '' }]
            const total = rows.reduce((s, p) => s + (p.qty > 0 ? p.qty : 0), 0)
            const short = total < a.qty
            const surplus = total > a.qty
            const setRow = (idx: number, patch: Partial<ReceivePlacement>) =>
              onPlacements(a.line_id, rows.map((p, i) => (i === idx ? { ...p, ...patch } : p)))
            const addRow = () => onPlacements(a.line_id, [...rows, { qty: 0, zoneId: '' }])
            const removeRow = (idx: number) => onPlacements(a.line_id, rows.filter((_, i) => i !== idx))
            return (
              <div key={a.line_id} style={{ padding: '8px 14px' }}>
                <div style={{ minWidth: 0, marginBottom: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {a.product_name ?? a.product_sku ?? '—'}
                    {a.variant ? <span style={{ color: 'var(--c-text-subtle)', fontWeight: 500 }}> · {a.variant}</span> : null}
                  </div>
                  {a.product_name && a.product_sku ? (
                    <div className="mono" style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>{a.product_sku}</div>
                  ) : null}
                  <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
                    план рейса {a.qty} шт · принято {total}
                    {short ? <> · <span style={{ color: 'var(--c-warning)' }}>недовоз</span></> : null}
                    {surplus ? <> · <span style={{ color: 'var(--c-accent)' }}>сверх плана +{total - a.qty}</span></> : null}
                  </div>
                </div>

                {rows.map((p, idx) => {
                  const zoneMissing = showErrors && p.qty > 0 && !p.zoneId
                  return (
                    <div
                      key={idx}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: `88px minmax(0,1fr) ${rows.length > 1 ? '32px' : '0px'}`,
                        gap: 8, alignItems: 'center', marginBottom: 6,
                      }}
                    >
                      <input
                        className="input sm num"
                        type="number"
                        min={0}
                        value={p.qty}
                        onChange={(e) => setRow(idx, { qty: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                      />
                      <Combobox
                        value={p.zoneId || null}
                        onChange={(v) => setRow(idx, { zoneId: v == null ? '' : String(v) })}
                        options={zones.map((z) => ({ value: z.id, label: z.name }))}
                        placeholder="Место хранения…"
                        invalid={zoneMissing}
                      />
                      {rows.length > 1 ? (
                        <button
                          type="button"
                          className="btn ghost icon sm"
                          aria-label="Убрать ячейку"
                          title="Убрать ячейку"
                          onClick={() => removeRow(idx)}
                        >
                          <Icon name="trash" size={14} />
                        </button>
                      ) : null}
                    </div>
                  )
                })}

                <button type="button" className="btn ghost sm" onClick={addRow} style={{ marginTop: 2 }}>
                  <Icon name="plus" size={14} /> Ещё ячейка
                </button>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
