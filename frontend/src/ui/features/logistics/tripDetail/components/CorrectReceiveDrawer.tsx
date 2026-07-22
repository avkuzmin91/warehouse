import { useState } from 'react'
import type { DictionaryItem } from '../../../../../api/domainTypes'
import { correctTripReceived } from '../../../../../api/tripsApi'
import type { TripReceiptItem, TripReceivedCorrectionPlacement } from '../../../../../api/tripsApi'
import { Drawer } from '../../../../feedback/Drawer'
import { Alert } from '../../../../primitives/Alert'
import { Field, Input } from '../../../../primitives/Input'
import { Icon } from '../../../../primitives/Icon'
import { Combobox } from '../../../../data/Combobox'

type CellRow = {
  zoneId: string
  zoneName: string | null
  qty: number
  /** Ячейка приёмки рейса из журнала: имя фиксировано, строку можно только обнулить. */
  journal: boolean
}

type LineRef = {
  lineId: string
  receiptNumber: string | null
  clientName: string | null
  title: string
  sku: string | null
  tripQty: number
  receivedQty: number
}

/** Корректировка обсчёта приёмки рейса: правка принятого ЭТИМ рейсом по фактическим
 *  ячейкам раскладки (обнулить, доложить, добавить новую) + одна причина. Сверх плана
 *  рейса — излишек, аллокация поднимется (как при разгрузке). Один вызов на строку. */
export function CorrectReceiveDrawer({ tripId, receipts, zones, open, onClose, onSaved }: {
  tripId: string
  receipts: TripReceiptItem[]
  zones: DictionaryItem[]
  open: boolean
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [rowsByLine, setRowsByLine] = useState<Record<string, CellRow[]>>({})
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const lines: LineRef[] = receipts.flatMap((r) => r.allocations.map((a) => ({
    lineId: a.line_id,
    receiptNumber: r.receipt_number,
    clientName: r.client_name,
    title: a.product_name ?? a.product_sku ?? '—',
    sku: a.product_name ? a.product_sku : null,
    tripQty: a.qty,
    receivedQty: a.received_qty,
  })))

  const initialRows = (lineId: string): CellRow[] => {
    for (const r of receipts) {
      for (const a of r.allocations) {
        if (a.line_id === lineId) {
          return a.placements
            .filter((p) => (p.storage_zone_id ?? '').trim() !== '')
            .map((p) => ({
              zoneId: String(p.storage_zone_id), zoneName: p.storage_zone_name, qty: p.qty, journal: true,
            }))
        }
      }
    }
    return []
  }

  const rowsOf = (l: LineRef) => rowsByLine[l.lineId] ?? initialRows(l.lineId)
  const totalOf = (l: LineRef) => rowsOf(l).reduce((s, r) => s + (r.qty > 0 ? r.qty : 0), 0)
  const isChanged = (l: LineRef) => {
    const init = initialRows(l.lineId)
    const rows = rowsOf(l)
    if (rows.length !== init.length) return rows.some((r) => !r.journal && r.qty > 0) || rows.length < init.length
    return rows.some((r, i) => r.qty !== init[i].qty || r.zoneId !== init[i].zoneId)
  }
  const zoneMissing = (l: LineRef) => rowsOf(l).some((r) => r.qty > 0 && !r.zoneId)

  const changed = lines.filter(isChanged)
  const invalid = changed.some(zoneMissing)
  const canSave = changed.length > 0 && !invalid && reason.trim().length > 0 && !saving

  const setRows = (lineId: string, rows: CellRow[]) => setRowsByLine((p) => ({ ...p, [lineId]: rows }))

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    setError('')
    try {
      for (const l of changed) {
        const placements: TripReceivedCorrectionPlacement[] = rowsOf(l)
          .filter((r) => r.zoneId && (r.journal || r.qty > 0))
          .map((r) => ({ storage_zone_id: r.zoneId, storage_zone_name: r.zoneName, qty: Math.max(0, r.qty) }))
        await correctTripReceived(tripId, l.lineId, {
          received_qty: totalOf(l),
          reason: reason.trim(),
          placements,
        })
      }
      setRowsByLine({})
      setReason('')
      await onSaved()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Исправить приёмку"
      subtitle="Корректировка обсчёта при разгрузке рейса"
      width={560}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
            Меняет принятое рейсом, остатки и журнал
          </span>
          <button className="btn primary" onClick={handleSave} disabled={!canSave}>
            <Icon name="check" size={14} />Применить{changed.length > 0 ? ` (${changed.length})` : ''}
          </button>
        </div>
      }
    >
      {error && <Alert tone="danger" icon={false} style={{ marginBottom: 12 }}>{error}</Alert>}
      <Alert tone="info" style={{ marginBottom: 14 }}>
        Правьте принятое этим рейсом прямо по ячейкам: обнулить, доложить или добавить новую.
        Уменьшить можно не глубже того, что ещё лежит на складе: уже отгруженное или
        перемещённое из приёмки убрать нельзя. Больше плана рейса — излишек, план поднимется.
      </Alert>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {lines.map((l) => {
          const total = totalOf(l)
          const dirty = isChanged(l)
          const rows = rowsOf(l)
          const usedZones = new Set(rows.map((r) => r.zoneId).filter(Boolean))
          return (
            <div
              key={l.lineId}
              style={{
                padding: '10px 12px',
                border: `1px solid ${dirty ? 'var(--c-accent)' : 'var(--c-border)'}`, borderRadius: 'var(--r-md)',
                background: dirty ? 'var(--c-bg-sunken)' : 'var(--c-bg-elev)',
              }}
            >
              <div style={{ minWidth: 0, marginBottom: 6 }}>
                <div style={{ fontSize: 12, color: 'var(--c-text-muted)', display: 'flex', gap: 6 }}>
                  <span className="mono" style={{ fontWeight: 600 }}>{l.receiptNumber ?? '—'}</span>
                  <span>·</span>
                  <span>{l.clientName ?? '—'}</span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {l.title}
                </div>
                {l.sku ? <div className="mono" style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>{l.sku}</div> : null}
                <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
                  план рейса {l.tripQty} шт · принято {l.receivedQty}
                  {dirty && total !== l.receivedQty ? <> → <b style={{ color: 'var(--c-accent)' }}>{total}</b></> : null}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {rows.map((r, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '88px minmax(0,1fr) 28px',
                      gap: 8, alignItems: 'center',
                    }}
                  >
                    <input
                      className="input sm num"
                      type="number"
                      min={0}
                      value={r.qty}
                      disabled={saving}
                      onChange={(e) => setRows(l.lineId, rows.map((row, i) =>
                        i === idx ? { ...row, qty: Math.max(0, Math.floor(Number(e.target.value) || 0)) } : row))}
                    />
                    {r.journal ? (
                      <span style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        <Icon name="map" size={13} style={{ color: 'var(--c-text-subtle)', flexShrink: 0 }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.zoneName || '—'}
                        </span>
                      </span>
                    ) : (
                      <Combobox
                        value={r.zoneId || null}
                        onChange={(v) => {
                          const zid = v == null ? '' : String(v)
                          const z = zones.find((x) => x.id === zid)
                          setRows(l.lineId, rows.map((row, i) =>
                            i === idx ? { ...row, zoneId: zid, zoneName: z?.name ?? null } : row))
                        }}
                        options={zones
                          .filter((z) => z.id === r.zoneId || !usedZones.has(z.id))
                          .map((z) => ({ value: z.id, label: z.name }))}
                        placeholder="Место хранения…"
                        invalid={r.qty > 0 && !r.zoneId}
                      />
                    )}
                    {!r.journal ? (
                      <button
                        type="button"
                        className="btn ghost icon sm"
                        aria-label="Убрать ячейку"
                        title="Убрать ячейку"
                        onClick={() => setRows(l.lineId, rows.filter((_, i) => i !== idx))}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    ) : <span />}
                  </div>
                ))}
                <div>
                  <button
                    type="button"
                    className="btn ghost sm"
                    disabled={saving}
                    onClick={() => setRows(l.lineId, [...rows, { zoneId: '', zoneName: null, qty: 0, journal: false }])}
                  >
                    <Icon name="plus" size={14} /> Ещё ячейка
                  </button>
                </div>
              </div>

              {zoneMissing(l) && (
                <div style={{ fontSize: 11.5, color: 'var(--c-danger)', marginTop: 6 }}>
                  Укажите место хранения для добавленной ячейки
                </div>
              )}
            </div>
          )
        })}
      </div>

      <Field label="Причина корректировки" required style={{ marginTop: 14, marginBottom: 0 }}>
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Напр.: пересчёт, ошибка приёмщика"
          disabled={saving}
        />
      </Field>
    </Drawer>
  )
}
