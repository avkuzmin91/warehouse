import { useMemo } from 'react'
import type { ShipmentLine } from '../../../../../api/shipmentsApi'
import { Modal } from '../../../../feedback/Modal'
import { Icon } from '../../../../primitives/Icon'
import { LineIdentityCell } from '../../shared/LineIdentityCell'

type Props = {
  open:      boolean
  docNumber: string
  clientName: string | null
  lines:     ShipmentLine[]
  acting:    boolean
  onCancel:  () => void
  onConfirm: () => void
}

const MAX_LISTED = 6

/**
 * Напоминание при завершении упаковки с недобором по годному. Брак в выполнение
 * не идёт — учитывается только packed_good против плана строки.
 */
export function FinishPackingConfirmModal({
  open, docNumber, clientName, lines, acting, onCancel, onConfirm,
}: Props) {
  const stats = useMemo(() => {
    const planTotal = lines.reduce((s, l) => s + l.qty, 0)
    const goodTotal = lines.reduce((s, l) => s + l.packed_good, 0)
    const pct = planTotal > 0 ? Math.round((goodTotal / planTotal) * 100) : 100
    const short = lines
      .filter((l) => l.packed_good < l.qty)
      .map((l) => ({ line: l, deficit: l.qty - l.packed_good }))
    const shortUnits = short.reduce((s, x) => s + x.deficit, 0)
    return { planTotal, goodTotal, pct, short, shortUnits, totalLines: lines.length }
  }, [lines])

  const listed = stats.short.slice(0, MAX_LISTED)
  const restCount = stats.short.length - listed.length

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Завершить упаковку не полностью?"
      subtitle={`Отгрузка ${docNumber}${clientName ? ` · ${clientName}` : ''}`}
      width={440}
      footer={
        <>
          <button className="btn ghost" disabled={acting} onClick={onCancel} autoFocus>
            Вернуться к упаковке
          </button>
          <button
            className="btn"
            disabled={acting}
            onClick={onConfirm}
            style={{ color: 'var(--c-warning)', background: 'var(--c-warning-bg)', borderColor: 'var(--c-warning)' }}
          >
            <Icon name="check" size={14} />Всё равно завершить
          </button>
        </>
      }
    >
      <div style={{ marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--c-text-subtle)' }}>Упаковано годного</span>
          <span style={{ fontSize: 22, fontWeight: 600 }}>
            {stats.pct}<span style={{ fontSize: 15, color: 'var(--c-text-subtle)' }}>%</span>
          </span>
        </div>
        <div style={{ height: 8, borderRadius: 6, background: 'var(--c-bg-sunken)', overflow: 'hidden' }}>
          <div style={{ width: `${stats.pct}%`, height: '100%', background: 'var(--c-warning)' }} />
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--c-text-faint)' }}>
          {stats.goodTotal} из {stats.planTotal} шт по плану
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, margin: '16px 0' }}>
        <div style={{ background: 'var(--c-bg-sunken)', borderRadius: 'var(--r-md)', padding: '12px 14px' }}>
          <div style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>Недоупаковано</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--c-warning)', marginTop: 2 }}>
            {stats.shortUnits} <span style={{ fontSize: 13, color: 'var(--c-text-subtle)', fontWeight: 400 }}>шт</span>
          </div>
        </div>
        <div style={{ background: 'var(--c-bg-sunken)', borderRadius: 'var(--r-md)', padding: '12px 14px' }}>
          <div style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>В позициях</div>
          <div style={{ fontSize: 22, fontWeight: 600, marginTop: 2 }}>
            {stats.short.length} <span style={{ fontSize: 13, color: 'var(--c-text-subtle)', fontWeight: 400 }}>из {stats.totalLines}</span>
          </div>
        </div>
      </div>

      <div style={{ fontSize: 12, color: 'var(--c-text-faint)', marginBottom: 8 }}>Недобор по годному</div>
      <div style={{ border: '1px solid var(--c-border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
        {listed.map((x, i) => (
          <div
            key={x.line.id}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
              padding: '9px 12px',
              borderBottom: i < listed.length - 1 || restCount > 0 ? '1px solid var(--c-border)' : 'none',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <LineIdentityCell
                name={x.line.product_name}
                sku={x.line.product_sku}
                color={x.line.color_name}
                size={x.line.size_name}
              />
            </div>
            <span className="mono" style={{ flex: 'none', fontSize: 13, color: 'var(--c-text-subtle)' }}>
              {x.line.packed_good} / {x.line.qty} <span style={{ color: 'var(--c-warning)' }}>−{x.deficit}</span>
            </span>
          </div>
        ))}
        {restCount > 0 && (
          <div style={{ padding: '9px 12px', fontSize: 12.5, color: 'var(--c-text-subtle)' }}>
            …и ещё {restCount} {restCount === 1 ? 'позиция' : 'позиций'}
          </div>
        )}
      </div>

      <div style={{
        display: 'flex', gap: 8, marginTop: 16, padding: '10px 12px',
        background: 'var(--c-warning-bg)', borderRadius: 'var(--r-md)',
      }}>
        <span style={{ flex: 'none', color: 'var(--c-warning)', marginTop: 1 }}><Icon name="alert" size={15} /></span>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--c-warning)', lineHeight: 1.5 }}>
          При наличии товара на хранении нужно упаковать весь объём. Уточните у начальника склада, есть ли остаток на замену.
        </p>
      </div>
    </Modal>
  )
}
