import type { DictionaryItem } from '../../../../../api/domainTypes'
import type { TripReceiptItem } from '../../../../../api/tripsApi'
import { Icon } from '../../../../primitives/Icon'
import { Combobox } from '../../../../data/Combobox'

/* Приёмка inbound-рейса при разгрузке: по каждой строке аллокации кладовщик вводит
 * фактически принятое и место хранения. По умолчанию принимаем всю аллокацию рейса.
 * Привезти меньше («недовоз») и больше плана («сверх плана») — обе ситуации нормальны:
 * принятое вводится по факту, излишек поднимет аллокацию рейса. Завершение разгрузки
 * проводит приход — товар встаёт «На хранении». */
export function UnloadReceiveTable({ receipts, zones, acceptByLine, zoneByLine, onAccept, onZone, showErrors }: {
  receipts: TripReceiptItem[]
  zones: DictionaryItem[]
  acceptByLine: Record<string, number>
  zoneByLine: Record<string, string>
  onAccept: (lineId: string, qty: number) => void
  onZone: (lineId: string, zoneId: string) => void
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
        <span style={{ fontSize: 13, fontWeight: 600 }}>Приёмка — посчитайте принятое по строкам</span>
      </div>

      {withAlloc.map((r) => (
        <div key={r.line_id} style={{ borderBottom: '1px solid var(--c-border)' }}>
          <div style={{ padding: '8px 14px 2px', fontSize: 12, color: 'var(--c-text-muted)', display: 'flex', gap: 8 }}>
            <span className="mono" style={{ fontWeight: 600 }}>{r.receipt_number}</span>
            <span>·</span>
            <span>{r.client_name ?? '—'}</span>
          </div>
          {r.allocations.map((a) => {
            const acc = acceptByLine[a.line_id] ?? a.qty
            const zoneId = zoneByLine[a.line_id] ?? ''
            const short = acc < a.qty
            const surplus = acc > a.qty
            const zoneMissing = showErrors && acc > 0 && !zoneId
            return (
              <div
                key={a.line_id}
                style={{
                  display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 88px 184px', gap: 10,
                  alignItems: 'center', padding: '8px 14px',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {a.product_name ?? a.product_sku ?? '—'}
                    {a.variant ? <span style={{ color: 'var(--c-text-subtle)', fontWeight: 500 }}> · {a.variant}</span> : null}
                  </div>
                  {a.product_name && a.product_sku ? (
                    <div className="mono" style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>{a.product_sku}</div>
                  ) : null}
                  <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
                    план рейса {a.qty} шт
                    {short ? <> · <span style={{ color: 'var(--c-warning)' }}>недовоз</span></> : null}
                    {surplus ? <> · <span style={{ color: 'var(--c-accent)' }}>сверх плана +{acc - a.qty}</span></> : null}
                  </div>
                </div>
                <input
                  className="input sm num"
                  type="number"
                  min={0}
                  value={acc}
                  onChange={(e) => onAccept(a.line_id, Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                />
                <Combobox
                  value={zoneId || null}
                  onChange={(v) => onZone(a.line_id, v == null ? '' : String(v))}
                  options={zones.map((z) => ({ value: z.id, label: z.name }))}
                  placeholder="Место хранения…"
                  invalid={zoneMissing}
                />
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
