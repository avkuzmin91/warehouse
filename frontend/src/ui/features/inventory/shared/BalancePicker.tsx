import { useEffect, useState } from 'react'
import { getBalances } from '../../../../api/balancesApi'
import type { BalanceItem } from '../../../../api/balancesApi'
import type { ShipmentCargoType } from '../../../../api/shipmentsApi'
import { balanceKey } from '../../../../utils/balanceKey'
import { EmptyState } from '../../../primitives/EmptyState'
import { Icon } from '../../../primitives/Icon'
import { NumberStep } from './NumberStep'

type Props = {
  clientId: string | null
  cargoType: ShipmentCargoType
  selectedKeys: string[]
  onAdd: (item: BalanceItem, qty: number) => void
  onClose: () => void
}

/**
 * Drawer-поиск товара по остаткам для добавления в отгрузку.
 * Используется в InventoryShipmentCreatePage и InventoryShipmentDetailPage.
 */
export function BalancePicker({ clientId, cargoType, selectedKeys, onAdd, onClose }: Props) {
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<BalanceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<{ item: BalanceItem; qty: number } | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    setLoading(true)
    getBalances({
      limit: 200,
      search: search || undefined,
      only_positive: true,
      client_id: clientId || undefined,
      has_defect: cargoType === 'defect' ? true : undefined,
    }, ctrl.signal)
      .then((res) => {
        if (ctrl.signal.aborted) return
        setItems(res.items.filter((b) => cargoType === 'defect' ? b.defect > 0 : b.good > 0))
      })
      .catch(() => { /* aborted or error */ })
      .finally(() => {
        if (ctrl.signal.aborted) return
        setLoading(false)
      })
    return () => ctrl.abort()
  }, [search, clientId, cargoType])

  const available = pending
    ? (cargoType === 'defect' ? pending.item.defect : pending.item.good)
    : 0

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
                {cargoType === 'defect' ? 'Только брак' : 'Только годный товар'}
                {clientId ? ' · по выбранному клиенту' : ''}
              </div>
            </div>
            <button className="btn ghost icon" onClick={onClose}><Icon name="x" size={16} /></button>
          </div>
          <div style={{ position: 'relative' }}>
            <Icon name="search" size={14} style={{ position: 'absolute', left: 10, top: 8, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
            <input
              className="input"
              style={{ paddingLeft: 32 }}
              placeholder="SKU, название, цвет, размер…"
              value={search}
              autoFocus
              onChange={(e) => { setSearch(e.target.value); setPending(null) }}
            />
          </div>
        </div>

        {pending ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 20, gap: 20 }}>
            <div
              style={{
                padding: '14px 16px', borderRadius: 8,
                border: '1px solid var(--c-accent)', background: 'var(--c-accent-bg)',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>{pending.item.product_name}</div>
              <div className="t-sub mono" style={{ marginTop: 2 }}>
                {[pending.item.product_sku, pending.item.color_name, pending.item.size_name].filter(Boolean).join(' · ')}
              </div>
              <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--c-text-muted)' }}>
                Доступно:{' '}
                <span className="mono" style={{ fontWeight: 600, color: cargoType === 'defect' ? 'var(--c-warning)' : 'var(--c-success)' }}>
                  {available}
                </span> шт
              </div>
            </div>

            <div>
              <label className="field-label"><span>К отгрузке</span></label>
              <NumberStep
                value={pending.qty}
                onChange={(v) => setPending((p) => p && { ...p, qty: v })}
                min={0}
                warning={pending.qty > available}
                width={160}
                height={30}
              />
              {pending.qty > available && (
                <div style={{ fontSize: 12, color: 'var(--c-warning)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Icon name="alert" size={12} />Превышает доступный остаток
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {loading ? (
              <div style={{ color: 'var(--c-text-muted)', fontSize: 13, padding: 12 }}>Загрузка…</div>
            ) : items.length === 0 ? (
              <EmptyState title="Ничего не найдено" sub="Нет остатков по заданному запросу" />
            ) : (
              items.map((item) => {
                const key = balanceKey(item)
                const added = selectedKeys.includes(key)
                return (
                  <div
                    key={key}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                      borderRadius: 8, border: `1px solid ${added ? 'var(--c-accent)' : 'var(--c-border)'}`,
                      cursor: added ? 'default' : 'pointer',
                      background: added ? 'var(--c-accent-bg)' : undefined,
                      opacity: added ? 0.75 : 1,
                    }}
                    onClick={() => { if (!added) setPending({ item, qty: 0 }) }}
                  >
                    <div style={{ width: 34, height: 34, borderRadius: 6, background: 'var(--c-bg-sunken)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon name="box" size={14} style={{ color: 'var(--c-text-muted)' }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{item.product_name}</div>
                      <div className="t-sub mono">{[item.product_sku, item.color_name, item.size_name].filter(Boolean).join(' · ')}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div className="mono" style={{ color: cargoType === 'defect' ? 'var(--c-warning)' : 'var(--c-success)', fontWeight: 500, fontSize: 13 }}>
                        {cargoType === 'defect' ? item.defect : item.good}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>доступно</div>
                    </div>
                    <Icon name={added ? 'check' : 'plus'} size={14} style={{ color: 'var(--c-accent)', flexShrink: 0 }} />
                  </div>
                )
              })
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
                disabled={pending.qty <= 0}
                onClick={() => onAdd(pending.item, pending.qty)}
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
