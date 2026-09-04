import type { ContainerHoldingRow } from '../api/containersApi'
import { Icon } from './Icon'

/** Короба строки остатка как пилюли адреса: «BOX-000123 · 12» и остаток россыпью.
 *
 * Кладовщик стоит у полки и решает, тащить короб целиком или взять поштучно —
 * без этой раскладки он видит только общее число и упирается в отказ гейта.
 */
export function BoxPills({
  boxes,
  loose,
  onOpen,
}: {
  boxes: ContainerHoldingRow[]
  loose: number
  onOpen?: (containerId: string) => void
}) {
  if (boxes.length === 0) return null
  return (
    <div className="pills">
      {boxes.map((h) => (
        <button
          key={h.container_id}
          type="button"
          className={`pill ${h.op_status === 'packed' ? 'info' : 'accent'}`}
          style={{ fontFamily: 'inherit', cursor: onOpen ? 'pointer' : 'default' }}
          onClick={onOpen ? () => onOpen(h.container_id) : undefined}
          title={h.op_status === 'packed' ? 'Короб у стола — ждёт развозки' : 'Открыть короб'}
        >
          <Icon name="box" size={13} />
          <span className="mono">{h.doc_number}</span> · {h.qty}
        </button>
      ))}
      {loose > 0 && <span className="pill">россыпью {loose}</span>}
    </div>
  )
}
