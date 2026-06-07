import { useState } from 'react'
import { packShipmentLine, moveShipmentLineToPacking } from '../../../../api/shipmentsApi'
import type { ShipmentLine, ShipmentLineFile } from '../../../../api/shipmentsApi'
import { Icon } from '../../../primitives/Icon'
import { Table, Td } from '../../../data/Table'
import { LineIdentityCell } from '../../../features/inventory/receiptDetail/components/LineIdentityCell'
import { useToast } from '../../../feedback/Toast'

type Props = {
  docId: string
  lines: ShipmentLine[]
  disabled: boolean
  canMove: boolean   // кладовщик: перемещение on_review в зону упаковки
  canPack: boolean   // начальник смены: разбивка good/defect
  onPreviewFile: (file: ShipmentLineFile, line: ShipmentLine) => void
  onReload: () => Promise<void> | void
}

export function PackingPanel({ docId, lines, disabled, canMove, canPack, onPreviewFile, onReload }: Props) {
  const showToast = useToast()
  const [moveQty, setMoveQty] = useState<Record<string, string>>({})
  const [packQty, setPackQty] = useState<Record<string, string>>({})
  const [savingLine, setSavingLine] = useState<string | null>(null)

  const planTotal = lines.reduce((s, l) => s + l.qty, 0)
  const packedTotal = lines.reduce((s, l) => s + l.packed_good + l.packed_defect, 0)
  const pct = planTotal > 0 ? Math.min(100, Math.floor((packedTotal / planTotal) * 100)) : 0

  function amount(map: Record<string, string>, id: string): number {
    const raw = Number(map[id])
    return Number.isFinite(raw) ? Math.floor(Math.abs(raw)) : 0
  }

  async function run(lineId: string, fn: () => Promise<unknown>, after?: () => void) {
    setSavingLine(lineId)
    try {
      await fn()
      after?.()
      await onReload()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ошибка', 'error')
    } finally {
      setSavingLine(null)
    }
  }

  function doMove(line: ShipmentLine) {
    const qty = amount(moveQty, line.id)
    if (qty <= 0) { showToast('Укажите количество', 'error'); return }
    run(line.id, () => moveShipmentLineToPacking(docId, line.id, qty), () =>
      setMoveQty((p) => ({ ...p, [line.id]: '' })))
  }

  function doPack(line: ShipmentLine, sign: 1 | -1, kind: 'good' | 'defect') {
    const qty = amount(packQty, line.id)
    if (qty <= 0) { showToast('Укажите количество', 'error'); return }
    run(line.id, () => packShipmentLine(docId, line.id, sign * qty, kind), () =>
      setPackQty((p) => ({ ...p, [line.id]: '' })))
  }

  return (
    <div className="card">
      <div className="card-head">
        <Icon name="forklift" size={15} className="ic-accent" />
        <div className="card-head-title">Упаковка по плану</div>
        <div className="right" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12.5, color: 'var(--c-text-subtle)' }}>
            Упаковано <b className="mono" style={{ color: 'var(--c-text)' }}>{packedTotal}</b> / {planTotal}
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: pct >= 100 ? 'var(--c-success)' : 'var(--c-accent)' }}>
            {pct}%
          </span>
        </div>
      </div>

      <Table>
        <thead>
          <tr>
            <th>Товар</th>
            <th style={{ width: 70, textAlign: 'right' }}>План</th>
            <th style={{ width: 90, textAlign: 'right' }}>В упаковке</th>
            <th style={{ width: 110, textAlign: 'right' }}>Годный / Брак</th>
            <th style={{ width: 80 }}>ТЗ</th>
            <th style={{ width: 280 }}>Действия</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const isSaving = savingLine === line.id
            const busy = disabled || isSaving
            const packedSum = line.packed_good + line.packed_defect
            const complete = packedSum >= line.qty
            return (
              <tr key={line.id}>
                <Td>
                  <LineIdentityCell name={line.product_name} sku={line.product_sku} color={line.color_name} size={line.size_name} />
                </Td>
                <Td className="num"><span className="mono" style={{ fontWeight: 500 }}>{line.qty}</span></Td>
                <Td className="num">
                  <span className="mono" style={{ color: line.review_in_packing > 0 ? 'var(--c-text)' : 'var(--c-text-faint)' }}>
                    {line.review_in_packing}
                  </span>
                </Td>
                <Td className="num">
                  <span className="mono" style={{ fontWeight: 600, color: 'var(--c-success)' }}>{line.packed_good}</span>
                  <span style={{ color: 'var(--c-text-faint)' }}> / </span>
                  <span className="mono" style={{ fontWeight: 600, color: line.packed_defect > 0 ? 'var(--c-danger)' : 'var(--c-text-faint)' }}>{line.packed_defect}</span>
                </Td>
                <Td>
                  {(line.files ?? []).length === 0 ? (
                    <span className="t-sub" style={{ fontSize: 12 }}>—</span>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {(line.files ?? []).map((f) => (
                        <button key={f.id} className="btn ghost sm" style={{ padding: '2px 6px' }} title={f.filename}
                          onClick={() => onPreviewFile(f, line)}>
                          <Icon name="paperclip" size={12} />
                        </button>
                      ))}
                    </div>
                  )}
                </Td>
                <Td>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {canMove && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input className="input sm" type="number" min={1} placeholder="в упаковку" style={{ width: 86 }}
                          value={moveQty[line.id] ?? ''} disabled={busy}
                          onChange={(e) => setMoveQty((p) => ({ ...p, [line.id]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') doMove(line) }} />
                        <button className="btn ghost sm" disabled={busy} title="Переместить в зону упаковки" onClick={() => doMove(line)}>
                          <Icon name="forklift" size={12} />В упаковку
                        </button>
                      </div>
                    )}
                    {canPack && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input className="input sm" type="number" min={1} placeholder="кол-во" style={{ width: 70 }}
                          value={packQty[line.id] ?? ''} disabled={busy}
                          onChange={(e) => setPackQty((p) => ({ ...p, [line.id]: e.target.value }))} />
                        <button className="btn primary sm" disabled={busy || complete} title="Упаковать как годный" onClick={() => doPack(line, 1, 'good')}>
                          <Icon name="check" size={12} />Годный
                        </button>
                        <button className="btn sm" disabled={busy || complete} title="Упаковать как брак" onClick={() => doPack(line, 1, 'defect')}
                          style={{ background: 'var(--c-danger-bg)', color: 'var(--c-danger)' }}>
                          Брак
                        </button>
                        <button className="btn ghost sm icon" disabled={busy || line.packed_good <= 0} title="Списать годный" onClick={() => doPack(line, -1, 'good')}>
                          <Icon name="minus" size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                </Td>
              </tr>
            )
          })}
        </tbody>
      </Table>
    </div>
  )
}
