import { useEffect, useState } from 'react'
import type { ReceiptLineInput } from '../../../../../api/receiptsApi'
import { getInventoryProducts } from '../../../../../api/inventoryLookupsApi'
import type { DictionaryItem, InventoryProductLookup } from '../../../../../api/domainTypes'
import { useLookups } from '../../../../../hooks/useLookups'
import { Icon } from '../../../../primitives/Icon'
import { Combobox } from '../../../../data/Combobox'
import { DatePicker } from '../../../../primitives/DatePicker'
import { FieldLabel, SelectField } from '../../components/fields'

export type CreateReceiptFormValue = {
  client_id: string
  supplier_name: string
  arrival_date: string
  ttn: string
  zone_id: string
  zone_name: string
  comment: string
  lines: (ReceiptLineInput & { _id: number })[]
}

let lineSeq = 0

/** Тело режима «Создать новое»: мини-документ поступления + ожидаемые строки. */
export function CreateReceiptForm({ value, onChange }: {
  value: CreateReceiptFormValue
  onChange: (patch: Partial<CreateReceiptFormValue>) => void
}) {
  const { clients: clientsAll, unloadingZones } = useLookups()
  const clients: DictionaryItem[] = clientsAll.filter((c) => c.is_active && !c.is_deleted)
  const zones: DictionaryItem[] = unloadingZones.filter((z) => z.is_active && !z.is_deleted)

  const [products, setProducts] = useState<InventoryProductLookup[]>([])

  useEffect(() => {
    if (!value.client_id) { setProducts([]); return }
    const ctrl = new AbortController()
    getInventoryProducts(value.client_id, ctrl.signal)
      .then((ps) => { if (!ctrl.signal.aborted) setProducts(ps) })
      .catch(() => {})
    return () => ctrl.abort()
  }, [value.client_id])

  function addLine() {
    onChange({ lines: [...value.lines, { _id: ++lineSeq, product_id: '', product_name: '', product_sku: '', planned_qty: 1 }] })
  }
  function removeLine(id: number) {
    onChange({ lines: value.lines.filter((l) => l._id !== id) })
  }
  function setLineProduct(id: number, productId: string) {
    const p = products.find((x) => x.id === productId)
    onChange({
      lines: value.lines.map((l) => l._id === id
        ? { ...l, product_id: productId, product_name: p?.name ?? '', product_sku: p?.sku ?? '' }
        : l),
    })
  }
  function setLineQty(id: number, qty: number) {
    onChange({ lines: value.lines.map((l) => l._id === id ? { ...l, planned_qty: qty } : l) })
  }

  return (
    <div className="col gap-16">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'start' }}>
        <div>
          <FieldLabel required>Клиент</FieldLabel>
          <Combobox
            value={value.client_id}
            placeholder="Поиск клиента…"
            options={clients.map((c) => ({ value: c.id, label: c.name }))}
            onChange={(v) => onChange({ client_id: String(v ?? ''), lines: [] })}
            prefix="user"
          />
        </div>
        <div>
          <FieldLabel>Поставщик</FieldLabel>
          <input
            className="input sm"
            style={{ width: '100%' }}
            placeholder="Не обязательно"
            value={value.supplier_name}
            onChange={(e) => onChange({ supplier_name: e.target.value })}
          />
        </div>
        <div>
          <FieldLabel required>Дата прибытия</FieldLabel>
          <DatePicker value={value.arrival_date} onChange={(v) => onChange({ arrival_date: v })} />
        </div>
        <div>
          <FieldLabel>ТТН / накладная</FieldLabel>
          <input
            className="input sm"
            style={{ width: '100%' }}
            placeholder="Номер документа"
            value={value.ttn}
            onChange={(e) => onChange({ ttn: e.target.value })}
          />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <FieldLabel>Зона разгрузки</FieldLabel>
          <SelectField
            value={value.zone_id}
            placeholder="Не обязательно"
            leadIcon="map"
            options={zones.map((z) => ({ id: z.id, name: z.name }))}
            onChange={(id) => onChange({ zone_id: id, zone_name: zones.find((z) => z.id === id)?.name ?? '' })}
          />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <FieldLabel>Комментарий</FieldLabel>
          <textarea
            className="input"
            rows={2}
            placeholder="Примечание для команды склада"
            value={value.comment}
            onChange={(e) => onChange({ comment: e.target.value })}
            style={{ resize: 'vertical', height: 'auto', padding: '8px 10px', lineHeight: 1.5, width: '100%' }}
          />
        </div>
      </div>

      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>Ожидаемые строки</span>
          <button className="btn sm" onClick={addLine} disabled={!value.client_id} title={value.client_id ? undefined : 'Сначала выберите клиента'}>
            <Icon name="plus" size={12} />Добавить строку
          </button>
        </div>

        {value.lines.length === 0 ? (
          <div className="t-sub" style={{ fontSize: 12, padding: '8px 10px', border: '1px dashed var(--c-border-strong)', borderRadius: 'var(--r-md)', background: 'var(--c-bg-sunken)' }}>
            Строки можно добавить сейчас или дозаполнить на приёмке.
          </div>
        ) : (
          <div className="col gap-8">
            {value.lines.map((l) => (
              <div key={l._id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Combobox
                    value={l.product_id}
                    placeholder="SKU или название…"
                    options={products.map((p) => ({ value: p.id, label: p.name, sub: p.sku }))}
                    onChange={(v) => setLineProduct(l._id, String(v ?? ''))}
                    prefix="box"
                  />
                </div>
                <div style={{
                  display: 'flex', alignItems: 'center', height: 34, padding: '0 10px', borderRadius: 'var(--r-md)',
                  border: '1px solid var(--c-border-strong)', background: 'var(--c-bg-elev)', width: 96, flexShrink: 0,
                }}>
                  <input
                    inputMode="numeric"
                    value={l.planned_qty ? String(l.planned_qty) : ''}
                    onChange={(e) => { const raw = e.target.value.replace(/\D/g, ''); setLineQty(l._id, raw ? parseInt(raw, 10) : 0) }}
                    style={{ flex: 1, border: 0, outline: 'none', background: 'transparent', fontFamily: 'var(--font-mono)', fontSize: 13.5, fontWeight: 500, textAlign: 'right', minWidth: 0, color: 'var(--c-text)' }}
                  />
                  <span style={{ marginLeft: 6, color: 'var(--c-text-subtle)', fontSize: 12.5 }}>шт</span>
                </div>
                <button className="btn ghost icon sm" style={{ flexShrink: 0, marginTop: 2 }} onClick={() => removeLine(l._id)} title="Удалить">
                  <Icon name="trash" size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
