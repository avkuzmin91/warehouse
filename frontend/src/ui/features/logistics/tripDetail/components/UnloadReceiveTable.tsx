import { useState } from 'react'
import type { DictionaryItem } from '../../../../../api/domainTypes'
import type { TripReceiptItem } from '../../../../../api/tripsApi'
import { Icon } from '../../../../primitives/Icon'
import { Combobox } from '../../../../data/Combobox'
import { usePrintBarcodeLabels } from '../../../shared/usePrintBarcodeLabels'

/** Одна строка раскладки: сколько штук кладётся в какую ячейку. */
export type ReceivePlacement = { qty: number; zoneId: string }

/* Приёмка inbound-рейса при разгрузке: по каждой строке аллокации кладовщик раскладывает
 * фактически принятое по ячейкам — список «кол-во + место» с возможностью добавить ещё
 * ячейку (товар не влез в одну). Принято по строке = сумма ячеек. По умолчанию одна
 * ячейка на всю аллокацию рейса, место предзаполнено прошлой приёмкой строки.
 * Мастер-ячейка применяет одно место ко всем строкам, кроме правленных вручную
 * (правка места/состава ячеек помечает строку; правка количества — нет).
 * Недовоз/сверх плана — обе ситуации нормальны. Завершение разгрузки проводит приход. */
export function UnloadReceiveTable({ receipts, zones, placementsByLine, onPlacements, showErrors }: {
  receipts: TripReceiptItem[]
  zones: DictionaryItem[]
  placementsByLine: Record<string, ReceivePlacement[]>
  onPlacements: (lineId: string, rows: ReceivePlacement[]) => void
  showErrors: boolean
}) {
  const withAlloc = receipts.filter((r) => r.allocations.length > 0)
  // Товар приезжает немаркированным — этикетки печатаются здесь, пока он на рампе.
  const { printLabels, printing } = usePrintBarcodeLabels()
  // Место правили руками (или меняли состав ячеек) — мастер эту строку не перезаписывает.
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [masterAll, setMasterAll] = useState('')
  const [masterByReceipt, setMasterByReceipt] = useState<Record<string, string>>({})

  if (withAlloc.length === 0) return null

  const zoneOpts = zones.map((z) => ({ value: z.id, label: z.name }))
  const touchedCount = withAlloc.reduce(
    (s, r) => s + r.allocations.filter((a) => touched[a.line_id]).length, 0,
  )

  function markTouched(lineId: string) {
    setTouched((prev) => (prev[lineId] ? prev : { ...prev, [lineId]: true }))
  }

  function applyMaster(zoneId: string, receipt?: TripReceiptItem) {
    if (receipt) setMasterByReceipt((prev) => ({ ...prev, [receipt.line_id]: zoneId }))
    else {
      setMasterAll(zoneId)
      setMasterByReceipt({})
    }
    if (!zoneId) return
    for (const r of receipt ? [receipt] : withAlloc) {
      for (const a of r.allocations) {
        if (touched[a.line_id]) continue
        const rows = placementsByLine[a.line_id] ?? [{ qty: a.qty, zoneId: '' }]
        onPlacements(a.line_id, rows.map((p) => ({ ...p, zoneId })))
      }
    }
  }

  return (
    <div style={{ border: '1px solid var(--c-border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid var(--c-border)', background: 'var(--c-bg-sunken)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <Icon name="forklift" size={14} style={{ color: 'var(--c-text-subtle)' }} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>Приёмка — посчитайте принятое и разложите по ячейкам</span>
      </div>

      <div style={{
        padding: '8px 14px', borderBottom: '1px solid var(--c-border)', background: 'var(--c-bg-sunken)',
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap' }}>Разгрузить всё</span>
        <Icon name="arrowRight" size={13} style={{ color: 'var(--c-text-subtle)', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 200, maxWidth: 340 }}>
          <Combobox
            value={masterAll || null}
            options={zoneOpts}
            placeholder="Выберите место"
            onChange={(v) => applyMaster(v == null ? '' : String(v))}
            clearable
          />
        </div>
        <span style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
          ко всем строкам, кроме изменённых вручную{touchedCount > 0 ? ` · вручную: ${touchedCount}` : ''}
        </span>
      </div>

      {withAlloc.map((r) => (
        <div key={r.line_id} style={{ borderBottom: '1px solid var(--c-border)' }}>
          <div style={{ padding: '8px 14px 2px', fontSize: 12, color: 'var(--c-text-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="mono" style={{ fontWeight: 600 }}>{r.receipt_number}</span>
            <span>·</span>
            <span>{r.client_name ?? '—'}</span>
            {withAlloc.length > 1 && (
              <div style={{ marginLeft: 'auto', width: 220 }} title="Место для всего поступления">
                <Combobox
                  value={masterByReceipt[r.line_id] || null}
                  options={zoneOpts}
                  placeholder="Место для поступления"
                  onChange={(v) => applyMaster(v == null ? '' : String(v), r)}
                  clearable
                />
              </div>
            )}
          </div>
          {r.allocations.map((a) => {
            const rows = placementsByLine[a.line_id] ?? [{ qty: a.qty, zoneId: '' }]
            const total = rows.reduce((s, p) => s + (p.qty > 0 ? p.qty : 0), 0)
            const short = total < a.qty
            const surplus = total > a.qty
            const isTouched = !!touched[a.line_id]
            const fromLastTime = !isTouched && rows.length === 1
              && !!rows[0].zoneId && rows[0].zoneId === a.storage_zone_id && rows[0].zoneId !== masterAll
            const setRow = (idx: number, patch: Partial<ReceivePlacement>) => {
              if (patch.zoneId !== undefined) markTouched(a.line_id)
              onPlacements(a.line_id, rows.map((p, i) => (i === idx ? { ...p, ...patch } : p)))
            }
            const addRow = () => {
              markTouched(a.line_id)
              onPlacements(a.line_id, [...rows, { qty: 0, zoneId: '' }])
            }
            const removeRow = (idx: number) => {
              markTouched(a.line_id)
              onPlacements(a.line_id, rows.filter((_, i) => i !== idx))
            }
            return (
              <div key={a.line_id} style={{ padding: '8px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
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
                      {isTouched ? <> · <span style={{ color: 'var(--c-accent)' }}>вручную</span></> : null}
                      {fromLastTime ? <> · <span>как в прошлый раз</span></> : null}
                    </div>
                  </div>
                  {a.product_id ? (
                    <button
                      type="button"
                      className="btn ghost sm"
                      style={{ flexShrink: 0 }}
                      disabled={printing || total <= 0}
                      title={total > 0 ? `Напечатать этикетки ШК: ${total} шт.` : 'Сначала укажите принятое количество'}
                      onClick={() => void printLabels([{
                        product_id: a.product_id as string,
                        color_id: a.color_id,
                        size_id: a.size_id,
                        qty: total,
                      }])}
                    >
                      <Icon name="print" size={13} /> Этикетки
                    </button>
                  ) : null}
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
                        options={zoneOpts}
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
