import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { createShipment, advanceShipment } from '../../api/shipmentsApi'
import type { ShipmentLineIn, ShipmentCargoType } from '../../api/shipmentsApi'
import { getBalances } from '../../api/balancesApi'
import type { BalanceItem } from '../../api/balancesApi'
import {
  getInventoryCarriers,
  getInventoryClients,
  getInventoryWarehouses,
} from '../../api/inventoryLookupsApi'
import type { DictionaryItem } from '../../api/domainTypes'
import { Combobox } from '../data/Combobox'
import type { ComboboxOption } from '../data/Combobox'
import { Icon } from '../primitives/Icon'
import { Field } from '../primitives/Input'
import { DatePicker } from '../primitives/DatePicker'
import { EmptyState } from '../primitives/EmptyState'
import { ShipmentStepper } from '../features/inventory/ShipmentStepper'

type DraftLine = ShipmentLineIn & { _key: string; available: number }

function formatYmdAsDmy(value: string | null): string {
  if (!value) return '—'
  const [year, month, day] = value.split('-')
  if (!year || !month || !day) return value
  return `${day}-${month}-${year}`
}

function balanceKey(b: BalanceItem) {
  return `${b.product_id}__${b.color_id ?? ''}__${b.size_id ?? ''}`
}

export function InventoryShipmentCreatePage() {
  const navigate = useNavigate()

  const [cargoType, setCargoType] = useState<ShipmentCargoType>('good')
  const [clientId, setClientId] = useState<string | null>(null)
  const [clientName, setClientName] = useState<string | null>(null)
  const [destinationId, setDestinationId] = useState<string | null>(null)
  const [destinationName, setDestinationName] = useState<string | null>(null)
  const [carrierId, setCarrierId] = useState<string | null>(null)
  const [carrier, setCarrier] = useState('')
  const [logisticsCost, setLogisticsCost] = useState('')
  const [shipDate, setShipDate] = useState('')
  const [comment, setComment] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [showPicker, setShowPicker] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showBlockReasons, setShowBlockReasons] = useState(false)

  const [clients, setClients] = useState<DictionaryItem[]>([])
  const [destinations, setDestinations] = useState<DictionaryItem[]>([])
  const [carriers, setCarriers] = useState<DictionaryItem[]>([])

  useEffect(() => {
    getInventoryClients().then(setClients).catch(() => {})
    getInventoryWarehouses().then(setDestinations).catch(() => {})
    getInventoryCarriers().then(setCarriers).catch(() => {})
  }, [])

  const clientOptions: ComboboxOption[] = clients.map((c) => ({ value: c.id, label: c.name }))
  const destinationOptions: ComboboxOption[] = destinations.map((d) => ({ value: d.id, label: d.name }))
  const carrierOptions: ComboboxOption[] = carriers.map((c) => ({ value: c.id, label: c.name }))

  const totalQty = lines.reduce((s, l) => s + l.qty, 0)
  const hasOverflow = lines.some((l) => l.qty > l.available)
  const readyChecks = [
    { ok: !!clientId, error: 'Выберите клиента' },
    { ok: !!shipDate, error: 'Укажите дату отгрузки' },
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

  function handleDestinationChange(val: string | number | null, opt?: ComboboxOption) {
    setDestinationId(val ? String(val) : null)
    setDestinationName(opt?.label ?? null)
  }

  function handleCarrierChange(val: string | number | null, opt?: ComboboxOption) {
    setCarrierId(val ? String(val) : null)
    setCarrier(opt?.label ?? '')
  }

  function updateQty(key: string, qty: number) {
    setLines((ls) => ls.map((l) => l._key === key ? { ...l, qty: Math.max(1, qty) } : l))
  }

  function removeLine(key: string) {
    setLines((ls) => ls.filter((l) => l._key !== key))
  }

  function addFromBalance(b: BalanceItem) {
    const key = balanceKey(b)
    if (lines.find((l) => l._key === key)) return
    setLines((ls) => [...ls, {
      _key:         key,
      product_id:   b.product_id,
      product_name: b.product_name,
      product_sku:  b.product_sku,
      color_id:     b.color_id,
      color_name:   b.color_name,
      size_id:      b.size_id,
      size_name:    b.size_name,
      qty:          1,
      available:    cargoType === 'defect' ? b.defect : b.good,
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
        destination:    destinationName || null,
        carrier:        carrier || null,
        logistics_cost: logisticsCost ? parseFloat(logisticsCost) : null,
        ship_date:      shipDate || null,
        comment:        comment || null,
        lines:          lines.map(({ _key, available, ...l }) => l),
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
        <div style={{
          padding: '10px 14px', marginBottom: 14,
          background: 'var(--c-warning-bg)', color: 'var(--c-warning)',
          border: '1px solid #ead1a3', borderRadius: 'var(--r-md)',
          display: 'flex', alignItems: 'center', gap: 10, fontSize: 13,
        }}>
          <Icon name="alert" size={15} />
          <span style={{ fontWeight: 500 }}>Запрошено больше, чем доступно по одной или нескольким позициям.</span>
        </div>
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 16 }}>
                <Field label="Клиент" required>
                  <Combobox
                    value={clientId}
                    onChange={handleClientChange}
                    options={clientOptions}
                    placeholder="Выберите клиента…"
                    clearable
                  />
                </Field>
                <Field label="Назначение">
                  <Combobox
                    value={destinationId}
                    onChange={handleDestinationChange}
                    options={destinationOptions}
                    placeholder="Выберите назначение…"
                    clearable
                  />
                </Field>
                <Field label="Дата отгрузки" required>
                  <DatePicker value={shipDate} onChange={setShipDate} />
                </Field>
                <Field label="Перевозчик">
                  <Combobox
                    value={carrierId}
                    onChange={handleCarrierChange}
                    options={carrierOptions}
                    placeholder="Выберите перевозчика…"
                    clearable
                  />
                </Field>
                <Field label="Стоимость логистики">
                  <input
                    className="input"
                    type="number"
                    min={0}
                    step={0.01}
                    value={logisticsCost}
                    onChange={(e) => setLogisticsCost(e.target.value)}
                    placeholder="0.00"
                  />
                </Field>
              </div>
              <Field label="Инструкции для сборки" style={{ marginTop: 16 }}>
                <textarea
                  className="input"
                  style={{ height: 60, paddingTop: 8, paddingBottom: 8, resize: 'vertical' }}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Необязательно"
                />
              </Field>
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
                    <th style={{ textAlign: 'right', width: 160 }}>К отгрузке</th>
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
              <span className="mono" style={{ textAlign: 'right' }}>{formatYmdAsDmy(shipDate)}</span>
              <span style={{ color: 'var(--c-text-muted)' }}>Перевозчик</span>
              <span style={{ textAlign: 'right', fontSize: 12.5, color: 'var(--c-text-subtle)' }}>{carrier || '—'}</span>
              {logisticsCost && (
                <>
                  <span style={{ color: 'var(--c-text-muted)' }}>Логистика</span>
                  <span className="mono" style={{ textAlign: 'right' }}>{parseFloat(logisticsCost).toLocaleString()}</span>
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
          selectedKeys={lines.map((l) => l._key)}
          onAdd={(b) => { addFromBalance(b); setShowPicker(false) }}
          onAddKeepOpen={(b) => addFromBalance(b)}
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

function NumberStep({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <button className="btn ghost sm" style={{ width: 26, height: 26, padding: 0, minWidth: 0 }} onClick={() => onChange(value - 1)} disabled={value <= 1}>−</button>
      <input
        type="number"
        className="input sm"
        style={{ width: 56, textAlign: 'center' }}
        value={value}
        min={1}
        onChange={(e) => onChange(Math.max(1, Number(e.target.value)))}
      />
      <button className="btn ghost sm" style={{ width: 26, height: 26, padding: 0, minWidth: 0 }} onClick={() => onChange(value + 1)}>+</button>
    </div>
  )
}

function BalancePicker({ clientId, cargoType, selectedKeys, onAdd, onAddKeepOpen, onClose }: {
  clientId: string | null
  cargoType: ShipmentCargoType
  selectedKeys: string[]
  onAdd: (b: BalanceItem) => void
  onAddKeepOpen: (b: BalanceItem) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<BalanceItem[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getBalances({
        limit: 200,
        search: search || undefined,
        only_positive: true,
        client_id: clientId || undefined,
        has_defect: cargoType === 'defect' ? true : undefined,
      })
      // фильтруем на клиенте: для брака скрываем строки без braka, для годного — без good
      const filtered = res.items.filter((b) =>
        cargoType === 'defect' ? b.defect > 0 : b.good > 0
      )
      setItems(filtered)
    } finally {
      setLoading(false)
    }
  }, [search, clientId, cargoType])

  useEffect(() => { load() }, [load])

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 400 }} onClick={onClose} />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 520,
        background: 'var(--c-bg-elev)', boxShadow: '-4px 0 24px rgba(0,0,0,.18)',
        zIndex: 401, display: 'flex', flexDirection: 'column',
      }}>
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
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {loading ? (
            <div style={{ color: 'var(--c-text-muted)', fontSize: 13, padding: 12 }}>Загрузка…</div>
          ) : items.length === 0 ? (
            <EmptyState title="Ничего не найдено" sub="Нет остатков по заданному запросу" />
          ) : (
            items.map((b) => {
              const key = balanceKey(b)
              const added = selectedKeys.includes(key)
              return (
                <div
                  key={key}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                    borderRadius: 8, border: `1px solid ${added ? 'var(--c-accent)' : 'var(--c-border)'}`,
                    cursor: 'pointer',
                    background: added ? 'var(--c-accent-bg)' : undefined,
                  }}
                  onClick={() => added ? onAddKeepOpen(b) : onAdd(b)}
                >
                  <div style={{ width: 34, height: 34, borderRadius: 6, background: 'var(--c-bg-sunken)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon name="box" size={14} style={{ color: 'var(--c-text-muted)' }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{b.product_name}</div>
                    <div className="t-sub mono">{[b.product_sku, b.color_name, b.size_name].filter(Boolean).join(' · ')}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div className="mono" style={{ color: cargoType === 'defect' ? 'var(--c-warning)' : 'var(--c-success)', fontWeight: 500, fontSize: 13 }}>
                      {cargoType === 'defect' ? b.defect : b.good}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>доступно</div>
                  </div>
                  <Icon name={added ? 'check' : 'plus'} size={14} style={{ color: added ? 'var(--c-accent)' : 'var(--c-accent)', flexShrink: 0 }} />
                </div>
              )
            })
          )}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--c-border)' }}>
          <button className="btn" style={{ width: '100%' }} onClick={onClose}>Готово</button>
        </div>
      </div>
    </>
  )
}
