import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createShipment, advanceShipment } from '../../api/shipmentsApi'
import type { ShipmentLineIn, ShipmentCargoType } from '../../api/shipmentsApi'
import type { BalanceItem } from '../../api/balancesApi'
import { Combobox } from '../data/Combobox'
import type { ComboboxOption } from '../data/Combobox'
import { Icon } from '../primitives/Icon'
import { AutoGrowTextarea, Field } from '../primitives/Input'
import { DatePicker } from '../primitives/DatePicker'
import { Alert } from '../primitives/Alert'
import { EmptyState } from '../primitives/EmptyState'
import { ShipmentStepper } from '../features/inventory/ShipmentStepper'
import { BalancePicker } from '../features/inventory/shared/BalancePicker'
import { NumberStep } from '../features/inventory/shared/NumberStep'
import { fmtYmdAsDmy } from '../../utils/format'
import { balanceKey } from '../../utils/balanceKey'
import { canViewCosts } from '../../utils/access'
import { useLookups } from '../../hooks/useLookups'
import { useCurrentUser } from '../../hooks/useCurrentUser'

type DraftLine = ShipmentLineIn & { _key: string; available: number }

export function InventoryShipmentCreatePage() {
  const navigate = useNavigate()

  const [cargoType, setCargoType] = useState<ShipmentCargoType>('good')
  const [clientId, setClientId] = useState<string | null>(null)
  const [clientName, setClientName] = useState<string | null>(null)
  const [logisticsCost, setLogisticsCost] = useState('')
  const [shipDate, setShipDate] = useState('')
  const [comment, setComment] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [showPicker, setShowPicker] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showBlockReasons, setShowBlockReasons] = useState(false)

  const { clients } = useLookups()
  const { user } = useCurrentUser()
  const showCosts = canViewCosts(user)

  const clientOptions: ComboboxOption[] = clients.map((c) => ({ value: c.id, label: c.name }))

  const totalQty = lines.reduce((s, l) => s + l.qty, 0)
  const hasOverflow = lines.some((l) => l.qty > l.available)
  const logisticsCostNumber = Number(logisticsCost)
  const logisticsCostFilled = logisticsCost.trim() !== '' && Number.isFinite(logisticsCostNumber) && logisticsCostNumber >= 0
  const readyChecks = [
    { ok: !!clientId, error: 'Выберите клиента' },
    { ok: !!shipDate, error: 'Укажите дату отгрузки' },
    ...(showCosts ? [{ ok: logisticsCostFilled, error: 'Укажите стоимость логистики' }] : []),
    { ok: lines.length > 0, error: 'Добавьте хотя бы одну позицию в отгрузку' },
    { ok: !hasOverflow, error: 'Уменьшите количество в позициях, где запрошено больше остатка' },
  ]
  const blockReasons = readyChecks.filter((check) => !check.ok).map((check) => check.error)

  function handleClientChange(val: string | number | null, opt?: ComboboxOption) {
    setClientId(val ? String(val) : null)
    setClientName(opt?.label ?? null)
    // clear lines that may not belong to this client
    setLines([])
  }

  function updateQty(key: string, qty: number) {
    setLines((ls) => ls.map((l) => l._key === key ? { ...l, qty: Math.max(1, qty) } : l))
  }

  function removeLine(key: string) {
    setLines((ls) => ls.filter((l) => l._key !== key))
  }

  function addFromBalance(b: BalanceItem, qty: number, zoneId: string | null, zoneName: string | null) {
    const key = balanceKey(b)
    setLines((ls) => [...ls, {
      _key:              key,
      product_id:        b.product_id,
      product_name:      b.product_name,
      product_sku:       b.product_sku,
      color_id:          b.color_id,
      color_name:        b.color_name,
      size_id:           b.size_id,
      size_name:         b.size_name,
      qty,
      available:         cargoType === 'defect' ? b.defect : b.good + b.on_review,
      storage_zone_id:   zoneId,
      storage_zone_name: zoneName,
    }])
  }

  async function handleSave(toPacking: boolean) {
    setError('')
    setSaving(true)
    try {
      const res = await createShipment({
        cargo_type:     cargoType,
        client_id:      clientId || null,
        client_name:    clientName || null,
        ...(showCosts ? { logistics_cost: logisticsCostFilled ? logisticsCostNumber : null } : {}),
        ship_date:      shipDate || null,
        comment:        comment.trim() || null,
        lines:          lines.map((line) => ({
          product_id:        line.product_id,
          product_name:      line.product_name,
          product_sku:       line.product_sku,
          color_id:          line.color_id,
          color_name:        line.color_name,
          size_id:           line.size_id,
          size_name:         line.size_name,
          qty:               line.qty,
          storage_zone_id:   line.storage_zone_id ?? null,
          storage_zone_name: line.storage_zone_name ?? null,
        })),
      })
      const docId = res.message
      if (toPacking) await advanceShipment(docId)
      navigate(`/inventory/shipments/${docId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  function handleSendToPacking() {
    if (blockReasons.length > 0) {
      setShowBlockReasons(true)
      return
    }
    setShowBlockReasons(false)
    void handleSave(true)
  }

  return (
    <div className="page">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <button className="btn ghost icon" style={{ marginTop: 2 }} onClick={() => navigate('/inventory/shipments')}>
            <Icon name="arrowLeft" size={16} />
          </button>
          <div>
            <div className="page-title">Новая отгрузка</div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" disabled={saving} onClick={() => navigate('/inventory/shipments')}>Отмена</button>
          <button className="btn primary" disabled={saving} onClick={handleSendToPacking}>
            <Icon name="check" size={14} />Запланировать отгрузку
          </button>
          </div>
          {showBlockReasons && blockReasons.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--c-danger)', textAlign: 'right', lineHeight: 1.5 }}>
              {blockReasons.map((reason, index) => (
                <div key={index}>- {reason}</div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ShipmentStepper status="draft" style={{ marginTop: -10 }} />

      {hasOverflow && (
        <Alert tone="warning" style={{ marginBottom: 14 }}>
          <span style={{ fontWeight: 500 }}>Запрошено больше, чем доступно по одной или нескольким позициям.</span>
        </Alert>
      )}

      {error && <div style={{ color: 'var(--c-danger)', fontSize: 13, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' }}>
        {/* Left */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          <div className="card">
            <div className="card-head">
              <Icon name="file" size={15} style={{ color: 'var(--c-accent)' }} />
              <div className="card-head-title">Основная информация</div>
            </div>
            <div className="card-body">
              <CargoTypeToggle value={cargoType} onChange={(v) => { setCargoType(v); setLines([]) }} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 12 }}>
                <Field label="Клиент" required style={{ marginBottom: 0 }}>
                  <Combobox
                    value={clientId}
                    onChange={handleClientChange}
                    options={clientOptions}
                    placeholder="Выберите клиента…"
                    clearable
                  />
                </Field>
                <Field label="Дата отгрузки (план)" required style={{ marginBottom: 0 }}>
                  <DatePicker value={shipDate} onChange={setShipDate} />
                </Field>
                {showCosts && (
                  <Field label="Стоимость логистики для клиента, ₽" required style={{ marginBottom: 0 }}>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      step={0.01}
                      value={logisticsCost}
                      onChange={(e) => setLogisticsCost(e.target.value)}
                    />
                  </Field>
                )}
                <Field label="Комментарий" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                  <AutoGrowTextarea
                    minRows={3}
                    placeholder="Примечание для команды склада"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    style={{ resize: 'vertical', minHeight: 76 }}
                  />
                </Field>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <Icon name="boxes" size={15} style={{ color: 'var(--c-accent)' }} />
              <div className="card-head-title">Состав отгрузки</div>
              {lines.length > 0 && (
                <span className="badge accent" style={{ marginLeft: 6 }}>{lines.length}</span>
              )}
              <div style={{ marginLeft: 'auto' }}>
                <button className="btn sm primary" onClick={() => setShowPicker(true)} disabled={!clientId}>
                  <Icon name="plus" size={12} />Добавить товар
                </button>
              </div>
            </div>

            {lines.length === 0 ? (
              <div style={{ padding: '32px 0' }}>
                <EmptyState title="Состав пуст" sub={clientId ? 'Нажмите «Добавить товар» для выбора из остатков' : 'Сначала выберите клиента'} />
              </div>
            ) : (
              <table className="t">
                <thead>
                  <tr>
                    <th style={{ width: 32 }} />
                    <th>Товар · вариант</th>
                    <th style={{ textAlign: 'right', width: 90 }}>Доступно</th>
                    <th style={{ textAlign: 'right', width: 160 }}>План отгрузки</th>
                    <th style={{ width: 32 }} />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const over = l.qty > l.available
                    return (
                      <tr key={l._key} style={over ? { background: 'var(--c-warning-bg)' } : {}}>
                        <td>
                          <div style={{ width: 26, height: 26, borderRadius: 4, background: 'var(--c-bg-sunken)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Icon name="box" size={12} style={{ color: 'var(--c-text-muted)' }} />
                          </div>
                        </td>
                        <td>
                          <div style={{ fontWeight: 500, fontSize: 13 }}>{l.product_name}</div>
                          <div className="t-sub mono">{[l.product_sku, l.color_name, l.size_name].filter(Boolean).join(' · ')}</div>
                        </td>
                        <td className="num" style={{ color: 'var(--c-success)', fontWeight: 500 }}>{l.available}</td>
                        <td>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
                            <NumberStep value={l.qty} onChange={(v) => updateQty(l._key, v)} />
                            {over && <Icon name="alert" size={13} style={{ color: 'var(--c-warning)' }} />}
                          </div>
                        </td>
                        <td>
                          <button className="btn ghost icon sm" onClick={() => removeLine(l._key)}>
                            <Icon name="trash" size={13} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--c-bg-sunken)' }}>
                    <td colSpan={2} style={{ padding: '10px 12px', fontWeight: 500, fontSize: 12.5 }}>
                      Итого: {lines.length} SKU
                    </td>
                    <td />
                    <td className="num" style={{ padding: '10px 12px', fontWeight: 600, fontSize: 14 }}>{totalQty}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>

        {/* Right */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div className="card-head">
              <Icon name="chart" size={15} style={{ color: 'var(--c-accent)' }} />
              <div className="card-head-title">Итого</div>
            </div>
            <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'auto 1fr', rowGap: 10, columnGap: 12, fontSize: 13 }}>
              <span style={{ color: 'var(--c-text-muted)' }}>SKU</span>
              <span className="mono" style={{ textAlign: 'right' }}>{lines.length}</span>
              <span style={{ color: 'var(--c-text-muted)' }}>Кол-во</span>
              <span className="mono" style={{ textAlign: 'right', fontWeight: 500, fontSize: 14 }}>{totalQty}</span>
              <span style={{ color: 'var(--c-text-muted)' }}>Дата</span>
              <span className="mono" style={{ textAlign: 'right' }}>{fmtYmdAsDmy(shipDate)}</span>
              {showCosts && logisticsCostFilled && (
                <>
                  <span style={{ color: 'var(--c-text-muted)' }}>Логистика</span>
                  <span className="mono" style={{ textAlign: 'right' }}>{logisticsCostNumber.toLocaleString()}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {showPicker && (
        <BalancePicker
          clientId={clientId}
          cargoType={cargoType}
          onAdd={(b, qty, zoneId, zoneName) => { addFromBalance(b, qty, zoneId, zoneName); setShowPicker(false) }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  )
}

function CargoTypeToggle({ value, onChange }: { value: ShipmentCargoType; onChange: (v: ShipmentCargoType) => void }) {
  const options: { key: ShipmentCargoType; label: string; icon: string; accent: string; bg: string; desc: string }[] = [
    {
      key: 'good',
      label: 'Годный товар',
      icon: '✓',
      accent: 'var(--c-success)',
      bg: 'var(--c-success-bg, #f0faf4)',
      desc: 'Отгрузка из остатков без дефектов',
    },
    {
      key: 'defect',
      label: 'Брак',
      icon: '!',
      accent: 'var(--c-warning)',
      bg: 'var(--c-warning-bg)',
      desc: 'Отгрузка бракованного товара',
    },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      {options.map((opt) => {
        const active = value === opt.key
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 14px',
              borderRadius: 'var(--r-lg)',
              border: `2px solid ${active ? opt.accent : 'var(--c-border)'}`,
              background: active ? opt.bg : 'var(--c-bg)',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'border-color .15s, background .15s',
            }}
          >
            <div style={{
              width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: active ? opt.accent : 'var(--c-bg-sunken)',
              color: active ? '#fff' : 'var(--c-text-muted)',
              fontWeight: 700, fontSize: 15,
              transition: 'background .15s, color .15s',
            }}>
              {opt.icon}
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, color: active ? opt.accent : 'var(--c-text)' }}>
                {opt.label}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', marginTop: 1 }}>
                {opt.desc}
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

