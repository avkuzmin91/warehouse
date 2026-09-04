import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import type { ContainerHoldingRow } from '../../../../api/containersApi'
import { Icon } from '../../../primitives/Icon'

const CHIP: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '0 7px',
  height: 19,
  borderRadius: 999,
  fontSize: 11,
  border: '1px solid var(--c-border)',
  background: 'var(--c-bg-sunken)',
  color: 'var(--c-text-muted)',
  textDecoration: 'none',
  whiteSpace: 'nowrap',
}

/** Короб в строке остатка: уточнение адреса «место · короб», а не отдельный статус.
 *
 * Короб из корзины «Ждёт размещения» помечен отдельно: он стоит у стола, и место
 * в строке остатка у него — зона упаковки, а не полка.
 */
export function BoxChip({ holding }: { holding: ContainerHoldingRow }) {
  const pending = holding.op_status === 'boxed'
  return (
    <Link
      to={`/inventory/boxes/${holding.container_id}`}
      className="mono"
      style={pending ? { ...CHIP, borderColor: 'var(--c-warning)', color: 'var(--c-warning)' } : CHIP}
      title={pending ? 'Короб у стола — ждёт развозки по местам' : 'Открыть карточку короба'}
    >
      <Icon name="box" size={11} />
      {holding.doc_number}
      <span style={{ opacity: 0.7 }}>· {holding.qty.toLocaleString('ru-RU')}</span>
    </Link>
  )
}

/** Часть остатка вне тары — только её и можно двигать поштучно. */
export function LooseChip({ qty }: { qty: number }) {
  return (
    <span style={CHIP} title="Лежит вне короба — доступно для ручных операций">
      россыпью <span className="mono">{qty.toLocaleString('ru-RU')}</span>
    </span>
  )
}
