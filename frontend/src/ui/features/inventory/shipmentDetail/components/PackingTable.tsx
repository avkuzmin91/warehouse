import type { ShipmentLine } from '../../../../../api/shipmentsApi'
import { Icon } from '../../../../primitives/Icon'
import { Table, Td } from '../../../../data/Table'
import { LineIdentityCell } from '../../shared/LineIdentityCell'
import type { EditableShipmentLine } from '../shared/types'

type PackingTableProps = {
  // transfer — передача (Кладовщик, packing); packing — годный/брак (Нач. смены, on_packing); result — итог (read-only).
  mode:          'transfer' | 'packing' | 'result'
  // Задача размещения: колонка «Собрано» (скан на ТСД) и гейт подвоза сверх плана.
  putaway?:      boolean
  lines:         EditableShipmentLine[]
  canMove:       boolean
  canPack:       boolean
  canReturn:     boolean
  // Размещение упакованного по местам прямо на упаковке (отгрузка из упаковки до её конца).
  canPlace:      boolean
  acting:        boolean
  savingLine:    string | null
  onOpenMove:    (line: ShipmentLine) => void
  onReturn:      (line: ShipmentLine) => void
  onOpenPacking: (line: ShipmentLine) => void
  onOpenPlace:   (line: ShipmentLine) => void
}

/** Упаковка: план-цель + на упаковке + (годный/брак) + действия передачи/упаковки. */
// Собрано по строке = всё, что снято сканом из зоны упаковки (годное и брак). Считаем по
// факту упаковки, а не по остатку у стола: после развозки он пустеет, собранное — нет.
function collectedOf(line: EditableShipmentLine): number {
  return line.packed_good + line.packed_defect
}

export function PackingTable({
  mode, putaway = false, lines, canMove, canPack, canReturn, canPlace, acting, savingLine,
  onOpenMove, onReturn, onOpenPacking, onOpenPlace,
}: PackingTableProps) {
  const planTotal = lines.reduce((s, l) => s + l.qty, 0)
  const poolTotal = lines.reduce((s, l) => s + l.available_for_pack, 0)
  const packedTotal = lines.reduce((s, l) => s + l.packed_good + l.packed_defect, 0)
  const collectedTotal = lines.reduce((s, l) => s + collectedOf(l), 0)
  const isResult = mode === 'result'
  const showGoodDefect = mode === 'packing' || mode === 'result'
  const colCount = (isResult ? 3 : showGoodDefect ? 5 : 4) + (putaway && !isResult ? 1 : 0)

  return (
    <Table>
      <thead>
        <tr>
          <th>Товар · вариант</th>
          <th style={{ width: 100, textAlign: 'right' }}>План</th>
          {!isResult && <th style={{ width: 110, textAlign: 'right' }}>На упаковке</th>}
          {putaway && !isResult && <th style={{ width: 110, textAlign: 'right' }}>Собрано</th>}
          {showGoodDefect && <th style={{ width: 120, textAlign: 'right' }}>Годный / Брак</th>}
          {!isResult && <th style={{ width: 340, whiteSpace: 'nowrap' }}>{mode === 'packing' ? 'Действия упаковки' : 'Передача'}</th>}
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => {
          const busy = acting || savingLine === line.id
          const collected = collectedOf(line)
          // Позиция закрыта, когда собранное плюс лежащее на упаковке покрывает план:
          // подвозить ещё нечего, иначе со склада уедет товар сверх задания.
          const putawayDone = putaway && line.qty - collected - line.available_for_pack <= 0
          return (
            <tr key={line.id}>
              <Td>
                <LineIdentityCell name={line.product_name} sku={line.product_sku} color={line.color_name} size={line.size_name} productId={line.product_id} />
              </Td>
              <Td className="num"><span className="num" style={{ fontWeight: 500 }}>{line.qty}</span></Td>
              {!isResult && (
                <Td className="num">
                  <span className="num" style={{ color: line.available_for_pack > 0 ? 'var(--c-text)' : 'var(--c-text-faint)' }}>
                    {line.available_for_pack}
                  </span>
                </Td>
              )}
              {putaway && !isResult && (
                <Td className="num">
                  <span className="num" style={{
                    fontWeight: collected > 0 ? 600 : 400,
                    color: collected > 0 ? 'var(--c-text)' : 'var(--c-text-faint)',
                  }}>{collected}</span>
                  {line.packed_defect > 0 && (
                    <span style={{ color: 'var(--c-danger)', fontSize: 11.5 }}> · брак {line.packed_defect}</span>
                  )}
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                    {mode === 'packing' && canPack && (
                      <button className="btn primary sm" disabled={busy} title="Внести годный/брак с датой упаковки" onClick={() => onOpenPacking(line)}>
                        <Icon name="check" size={12} />Внести упаковку
                      </button>
                    )}
                    {mode === 'packing' && canPlace && line.packed_pending_good > 0 && (
                      <button className="btn ghost sm" disabled={busy} title="Разместить упакованное по местам — станет доступно к отгрузке" onClick={() => onOpenPlace(line)}>
                        <Icon name="archive" size={12} />Разместить ({line.packed_pending_good})
                      </button>
                    )}
                    {canMove && (
                      <button
                        className="btn ghost sm"
                        disabled={busy || putawayDone}
                        title={putawayDone
                          ? 'Позиция закрыта: план покрыт собранным и тем, что уже на упаковке'
                          : mode === 'packing' ? 'Передать ещё товар на упаковку' : 'Передать товар в зону упаковки'}
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
              {putaway && !isResult && (
                <span style={{ color: 'var(--c-text-subtle)' }}>
                  Собрано <b className="num" style={{ color: 'var(--c-text)' }}>{collectedTotal}</b>
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
