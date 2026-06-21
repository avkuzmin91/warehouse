import { useEffect, useState } from 'react'
import { getPlannableItems } from '../../../../api/balancesApi'
import type { PlannableItem } from '../../../../api/balancesApi'
import type { ShipmentCargoType } from '../../../../api/shipmentsApi'
import { EmptyState } from '../../../primitives/EmptyState'
import { Icon } from '../../../primitives/Icon'
import { NumberStep } from './NumberStep'

type Props = {
  clientId: string | null
  cargoType: ShipmentCargoType
  onAdd: (item: PlannableItem, qty: number, zoneId: string | null, zoneName: string | null) => void
  onClose: () => void
}

// Годный груз планируется из свободного годного «На хранении» + товара в пути
// (заявлен в поступлении, ещё не приехал). Брак планируется из суммарного брака
// «На хранении» (в пути брак не считаем). Местоположение-источник годного выбирает
// кладовщик при передаче на упаковку; брака — при подготовке.
type PickRow = {
  item: PlannableItem
  onHand: number
  inTransit: number
  cap: number
}

export function BalancePicker({ clientId, cargoType, onAdd, onClose }: Props) {
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<PickRow[]>([])
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<{ row: PickRow; qty: number } | null>(null)

  const isDefect = cargoType === 'defect'

  useEffect(() => {
    const ctrl = new AbortController()
    setLoading(true)
    getPlannableItems({
      limit: 200,
      search: search || undefined,
      client_id: clientId || undefined,
      cargo_type: cargoType,
    }, ctrl.signal)
      .then((res) => {
        if (ctrl.signal.aborted) return
        const next = res.items.map((b): PickRow => {
          const onHand = isDefect ? b.storage_defect : b.storage_good
          const inTransit = isDefect ? 0 : b.in_transit
          return { item: b, onHand, inTransit, cap: onHand + inTransit }
        })
        setRows(next)
      })
      .catch(() => { /* aborted or error */ })
      .finally(() => {
        if (ctrl.signal.aborted) return
        setLoading(false)
      })
    return () => ctrl.abort()
  }, [search, clientId, cargoType, isDefect])

  const cap = pending ? pending.row.cap : 0
  const onHand = pending ? pending.row.onHand : 0
  const overStock = pending ? pending.qty > onHand : false

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 400 }} onClick={onClose} />
      <div
        style={{
          position: 'fixed',
          top: 0, right: 0, bottom: 0, width: 520,
          background: 'var(--c-bg-elev)',
          boxShadow: '-4px 0 24px rgba(0,0,0,.18)',
          zIndex: 401,
          display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--c-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>Подобрать товар</div>
              <div style={{ fontSize: 12.5, color: 'var(--c-text-subtle)' }}>
                {isDefect ? 'Брак на хранении' : 'Годный товар на хранении и в пути'}
                {clientId ? ' · по выбранному клиенту' : ''}
              </div>
            </div>
            <button className="btn ghost icon" onClick={onClose}><Icon name="x" size={16} /></button>
          </div>
          {!pending && (
            <div style={{ position: 'relative' }}>
              <Icon name="search" size={14} style={{ position: 'absolute', left: 10, top: 8, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
              <input
                className="input"
                style={{ paddingLeft: 32 }}
                placeholder="SKU, название, цвет, размер…"
                value={search}
                autoFocus
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          )}
        </div>

        {pending ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 20, gap: 20 }}>
            <div
              style={{
                padding: '14px 16px', borderRadius: 8,
                border: '1px solid var(--c-accent)', background: 'var(--c-accent-bg)',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>{pending.row.item.product_name}</div>
              <div className="t-sub mono" style={{ marginTop: 2 }}>
                {pending.row.item.sku_pending && (
                  <span style={{ color: 'var(--c-warning)', fontWeight: 600 }}>
                    Без SKU{(pending.row.item.color_name || pending.row.item.size_name) ? ' · ' : ''}
                  </span>
                )}
                {[pending.row.item.product_sku, pending.row.item.color_name, pending.row.item.size_name].filter(Boolean).join(' · ')}
              </div>
              <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--c-text-muted)', display: 'flex', gap: 16 }}>
                <span>
                  На складе:{' '}
                  <span className="mono" style={{ fontWeight: 600, color: isDefect ? 'var(--c-warning)' : 'var(--c-success)' }}>
                    {onHand}
                  </span> шт
                </span>
                {!isDefect && pending.row.inTransit > 0 && (
                  <span>
                    В пути:{' '}
                    <span className="mono" style={{ fontWeight: 600, color: 'var(--c-text-subtle)' }}>
                      {pending.row.inTransit}
                    </span> шт
                  </span>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="field-label"><span>План отгрузки</span></label>
                <NumberStep
                  value={pending.qty}
                  onChange={(v) => setPending((p) => p && { ...p, qty: v })}
                  min={0}
                  warning={pending.qty > cap}
                  width={160}
                  height={30}
                />
                {pending.qty > cap ? (
                  <div style={{ fontSize: 12, color: 'var(--c-warning)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Icon name="alert" size={12} />Превышает остаток и товар в пути ({cap} шт)
                  </div>
                ) : overStock && (
                  <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Icon name="clock" size={12} />Часть из товара в пути — отгрузку можно запланировать после прихода
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {loading ? (
              <div style={{ color: 'var(--c-text-muted)', fontSize: 13, padding: 12 }}>Загрузка…</div>
            ) : rows.length === 0 ? (
              <EmptyState title="Ничего не найдено" sub={isDefect ? 'Нет брака на хранении по запросу' : 'Нет остатков и товара в пути по запросу'} />
            ) : (
              rows.map((row, i) => (
                <div
                  key={`${row.item.product_id}__${row.item.color_id}__${row.item.size_id}__${i}`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                    borderRadius: 8, border: '1px solid var(--c-border)',
                    cursor: 'pointer',
                  }}
                  onClick={() => setPending({ row, qty: 0 })}
                >
                  <div style={{ width: 34, height: 34, borderRadius: 6, background: 'var(--c-bg-sunken)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon name="box" size={14} style={{ color: 'var(--c-text-muted)' }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{row.item.product_name}</div>
                    <div className="t-sub mono">
                      {row.item.sku_pending && (
                        <span style={{ color: 'var(--c-warning)', fontWeight: 600 }}>
                          Без SKU{(row.item.color_name || row.item.size_name) ? ' · ' : ''}
                        </span>
                      )}
                      {[row.item.product_sku, row.item.color_name, row.item.size_name].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div className="mono" style={{ color: isDefect ? 'var(--c-warning)' : 'var(--c-success)', fontWeight: 500, fontSize: 13 }}>
                      {row.onHand}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>
                      {isDefect ? 'брак' : 'на складе'}
                    </div>
                    {!isDefect && row.inTransit > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--c-text-subtle)', marginTop: 1 }}>
                        +{row.inTransit} в пути
                      </div>
                    )}
                  </div>
                  <Icon name="plus" size={14} style={{ color: 'var(--c-accent)', flexShrink: 0 }} />
                </div>
              ))
            )}
          </div>
        )}

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--c-border)', display: 'flex', gap: 8 }}>
          {pending ? (
            <>
              <button className="btn" style={{ flex: 1 }} onClick={() => setPending(null)}>Назад</button>
              <button
                className="btn primary"
                style={{ flex: 1 }}
                disabled={pending.qty <= 0 || pending.qty > cap}
                onClick={() => onAdd(
                  pending.row.item,
                  pending.qty,
                  null,
                  null,
                )}
              >
                <Icon name="plus" size={13} />Добавить
              </button>
            </>
          ) : (
            <button className="btn" style={{ width: '100%' }} onClick={onClose}>Готово</button>
          )}
        </div>
      </div>
    </>
  )
}
