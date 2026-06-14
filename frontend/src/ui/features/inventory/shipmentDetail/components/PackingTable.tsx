import type { ShipmentLine } from '../../../../../api/shipmentsApi'
import { Icon } from '../../../../primitives/Icon'
import { Table, Td } from '../../../../data/Table'
import { LineIdentityCell } from '../../shared/LineIdentityCell'
import type { EditableShipmentLine } from '../shared/types'

type PackingTableProps = {
  // transfer — передача (Кладовщик, packing); packing — годный/брак (Нач. смены, on_packing); result — итог (read-only).
  mode:          'transfer' | 'packing' | 'result'
  lines:         EditableShipmentLine[]
  canMove:       boolean
  canPack:       boolean
  canReturn:     boolean
  acting:        boolean
  savingLine:    string | null
  onOpenMove:    (line: ShipmentLine) => void
  onReturn:      (line: ShipmentLine) => void
  onOpenPacking: (line: ShipmentLine) => void
}

/** Упаковка: план-цель + на упаковке + (годный/брак) + действия передачи/упаковки. */
export function PackingTable({
  mode, lines, canMove, canPack, canReturn, acting, savingLine,
  onOpenMove, onReturn, onOpenPacking,
}: PackingTableProps) {
  const planTotal = lines.reduce((s, l) => s + l.qty, 0)
  const poolTotal = lines.reduce((s, l) => s + l.available_for_pack, 0)
  const packedTotal = lines.reduce((s, l) => s + l.packed_good + l.packed_defect, 0)
  const isResult = mode === 'result'
  const showGoodDefect = mode === 'packing' || mode === 'result'
  const colCount = isResult ? 3 : showGoodDefect ? 5 : 4

  return (
    <Table>
      <thead>
        <tr>
          <th>Товар · вариант</th>
          <th style={{ width: 100, textAlign: 'right' }}>План</th>
          {!isResult && <th style={{ width: 110, textAlign: 'right' }}>На упаковке</th>}
          {showGoodDefect && <th style={{ width: 120, textAlign: 'right' }}>Годный / Брак</th>}
          {!isResult && <th style={{ width: 300 }}>{mode === 'packing' ? 'Действия упаковки' : 'Передача'}</th>}
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => {
          const busy = acting || savingLine === line.id
          return (
            <tr key={line.id}>
              <Td>
                <LineIdentityCell name={line.product_name} sku={line.product_sku} color={line.color_name} size={line.size_name} />
              </Td>
              <Td className="num"><span className="num" style={{ fontWeight: 500 }}>{line.qty}</span></Td>
              {!isResult && (
                <Td className="num">
                  <span className="num" style={{ color: line.available_for_pack > 0 ? 'var(--c-text)' : 'var(--c-text-faint)' }}>
                    {line.available_for_pack}
                  </span>
                </Td>
              )}
              {showGoodDefect && (
                <Td className="num">
                  <span className="num" style={{ fontWeight: 600, color: 'var(--c-success)' }}>{line.packed_good}</span>
                  <span style={{ color: 'var(--c-text-faint)' }}> / </span>
                  <span className="num" style={{ fontWeight: 600, color: line.packed_defect > 0 ? 'var(--c-danger)' : 'var(--c-text-faint)' }}>{line.packed_defect}</span>
                </Td>
              )}
              {!isResult && (
                <Td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {mode === 'packing' && canPack && (
                      <button className="btn primary sm" disabled={busy} title="Внести годный/брак с датой упаковки" onClick={() => onOpenPacking(line)}>
                        <Icon name="check" size={12} />Внести упаковку
                      </button>
                    )}
                    {canMove && (
                      <button
                        className="btn primary sm"
                        disabled={busy}
                        title={mode === 'packing' ? 'Передать ещё товар на упаковку' : 'Передать товар в зону упаковки'}
                        onClick={() => onOpenMove(line)}
                      >
                        <Icon name="forklift" size={12} />{mode === 'packing' ? 'Передать ещё' : 'Передать'}
                      </button>
                    )}
                    {canReturn && line.available_for_pack > 0 && (
                      <button className="btn ghost sm icon" disabled={busy} title="Вернуть на хранение (откат передачи)" onClick={() => onReturn(line)}>
                        <Icon name="refresh" size={13} />
                      </button>
                    )}
                  </div>
                </Td>
              )}
            </tr>
          )
        })}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={colCount} style={{ padding: 0 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 24, padding: '10px 14px',
              background: 'var(--c-bg-sunken)', borderTop: '1px solid var(--c-border)', fontSize: 12.5,
            }}>
              <span style={{ fontWeight: 700 }}>Итого</span>
              <span style={{ color: 'var(--c-text-subtle)' }}>
                План <b className="num" style={{ color: 'var(--c-text)' }}>{planTotal}</b>
              </span>
              {!isResult && (
                <span style={{ color: 'var(--c-text-subtle)' }}>
                  На упаковке <b className="num" style={{ color: 'var(--c-text)' }}>{poolTotal}</b>
                </span>
              )}
              {showGoodDefect && (
                <span style={{ color: 'var(--c-text-subtle)' }}>
                  Упаковано <b className="num" style={{ color: 'var(--c-text)' }}>{packedTotal}</b>
                </span>
              )}
            </div>
          </td>
        </tr>
      </tfoot>
    </Table>
  )
}
