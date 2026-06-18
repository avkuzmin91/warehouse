import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { createInvoice, getUninvoicedShipments } from '../../../api/invoicesApi'
import type { UninvoicedShipment } from '../../../api/invoicesApi'
import { FormPage } from '../../layouts/FormPage'
import { Combobox } from '../../data/Combobox'
import { DatePicker } from '../../primitives/DatePicker'
import { Icon } from '../../primitives/Icon'
import { Badge } from '../../primitives/Badge'
import { PhaseBlock } from '../shared/process/PhaseBlock'
import { Panel, ReadRow } from '../shared/process/processUI'
import { useLookups } from '../../../hooks/useLookups'
import { useApi } from '../../../hooks/useApi'
import { useToast } from '../../feedback/Toast'
import { fmtDate, formatMoneyKopecks, parseRublesToKopecks } from '../../../utils/format'
import { CargoTag, ShipmentContentsPanel, SelectedContentsRollup, productsPreviewText } from './financeUI'
import { InvoiceRailPanel } from './InvoiceRail'

export function InvoiceCreateFeature() {
  const navigate = useNavigate()
  const toast = useToast()
  const { clients } = useLookups()
  const [params] = useSearchParams()

  const [clientId, setClientId] = useState<string>(params.get('client') ?? '')
  const [dueDate, setDueDate] = useState('')
  const [amount, setAmount] = useState('')
  const [comment, setComment] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [showErrors, setShowErrors] = useState(false)

  const { data: uninv, loading } = useApi(
    (signal) => clientId
      ? getUninvoicedShipments({ client_id: clientId, limit: 200 }, signal)
      : Promise.resolve({ items: [], total: 0, page: 1, limit: 200 }),
    [clientId],
  )
  const shipments: UninvoicedShipment[] = uninv?.items ?? []

  useEffect(() => { setSelected(new Set()) }, [clientId])

  const kopecks = parseRublesToKopecks(amount)
  const clientName = clients.find((c) => c.id === clientId)?.name ?? null
  const selQty = shipments.filter((s) => selected.has(s.id)).reduce((a, s) => a + s.total_qty, 0)

  // Создаётся черновик — обязателен только клиент; сумма проверяется лишь на корректность числа.
  const blockReasons: string[] = [
    ...(!clientId ? ['Выберите клиента'] : []),
    ...(amount && kopecks == null ? ['Сумма счёта — некорректное число'] : []),
  ]
  const clientInvalid = showErrors && !clientId
  const amountInvalid = showErrors && !!amount && kopecks == null

  function toggle(id: string) {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  function toggleExpand(id: string) {
    setExpanded((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  function toggleAll() {
    setSelected((prev) => prev.size === shipments.length ? new Set() : new Set(shipments.map((s) => s.id)))
  }

  function submit() {
    if (blockReasons.length) { setShowErrors(true); toast(blockReasons[0], 'error'); return }
    setShowErrors(false)
    setSubmitting(true)
    createInvoice({
      client_id: clientId,
      client_name: clientName,
      due_date: dueDate || null,
      total_amount: kopecks ?? 0,
      comment: comment.trim() || null,
      shipment_ids: [...selected],
    })
      .then((r) => { toast('Черновик создан', 'success'); navigate(`/finance/invoices/${r.message}`) })
      .catch((e) => toast(e instanceof Error ? e.message : String(e), 'error'))
      .finally(() => setSubmitting(false))
  }

  return (
    <FormPage
      title="Новый счёт"
      backTo="/finance/invoices"
      actions={
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          <button className="btn primary" onClick={submit} disabled={submitting}>
            <Icon name="check" size={14} />{submitting ? 'Сохранение…' : 'Создать черновик'}
          </button>
          {showErrors && blockReasons.length > 0 && (
            <div className="block-reasons">
              {blockReasons.map((r, i) => <div key={i}>· {r}</div>)}
            </div>
          )}
        </div>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 360px', gap: 18, alignItems: 'start' }}>
        {/* Левая колонка — фазы заполнения */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <PhaseBlock icon="building" title="Клиент" role="manager" state="active" hint="отгрузки покажутся по выбранному клиенту">
            <Combobox
              value={clientId || null}
              onChange={(v) => setClientId(v ? String(v) : '')}
              options={clients.map((c) => ({ value: c.id, label: c.name }))}
              placeholder="Выберите клиента…"
              clearable
              prefix="building"
              invalid={clientInvalid}
            />
            {clientInvalid && (
              <div style={{ fontSize: 11.5, color: 'var(--c-danger)', marginTop: 4 }}>Выберите клиента — это обязательное поле.</div>
            )}
          </PhaseBlock>

          <PhaseBlock
            icon="truckOut" title="Отгрузки без счёта" role="manager" state="active"
            hint={clientId ? `доступно: ${shipments.length}` : 'сначала выберите клиента'}
            right={
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {selected.size > 0 && <Badge tone="info">Выбрано: {selected.size}</Badge>}
                {shipments.length > 0 && (
                  <button className="btn ghost sm" onClick={toggleAll}>
                    {selected.size === shipments.length ? 'Снять все' : 'Выбрать все'}
                  </button>
                )}
              </span>
            }
          >
            {!clientId ? (
              <div style={{ padding: '14px 0', textAlign: 'center', fontSize: 13, color: 'var(--c-text-subtle)' }}>
                Выберите клиента выше, чтобы увидеть его завершённые отгрузки.
              </div>
            ) : loading ? (
              <div style={{ padding: '14px 0', textAlign: 'center', fontSize: 13, color: 'var(--c-text-subtle)' }}>Загрузка…</div>
            ) : shipments.length === 0 ? (
              <div style={{ padding: '14px 0', textAlign: 'center', fontSize: 13, color: 'var(--c-text-subtle)' }}>
                У клиента нет завершённых отгрузок без счёта.
              </div>
            ) : (
              <>
                <div style={{ margin: '0 -14px' }}>
                  {shipments.map((s) => {
                    const on = selected.has(s.id)
                    const open = expanded.has(s.id)
                    return (
                      <div key={s.id} style={{
                        borderBottom: '1px solid var(--c-border)',
                        background: on ? 'var(--c-accent-bg)' : undefined,
                      }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', cursor: 'pointer' }}>
                          <span className={`t-checkbox ${on ? 'checked' : ''}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {on && <Icon name="check" size={10} />}
                          </span>
                          <input type="checkbox" checked={on} onChange={() => toggle(s.id)} style={{ display: 'none' }} />
                          <span className="mono" style={{ fontWeight: 500, minWidth: 92 }}>{s.doc_number}</span>
                          <CargoTag cargoType={s.cargo_type} />
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: 'block', fontSize: 12.5, color: 'var(--c-text-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {s.destination ?? '—'} · {fmtDate(s.ship_date)}
                            </span>
                            {s.products_preview.length > 0 && (
                              <span style={{ display: 'block', fontSize: 11.5, color: 'var(--c-text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {productsPreviewText(s.products_preview, s.sku_count)}
                              </span>
                            )}
                          </span>
                          <span className="mono" style={{ fontSize: 12, color: 'var(--c-text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>{s.total_qty} шт · {s.sku_count} SKU</span>
                          <button
                            type="button" className="btn ghost icon sm"
                            title={open ? 'Свернуть состав' : 'Показать состав'}
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleExpand(s.id) }}
                          >
                            <Icon name={open ? 'chevUp' : 'chevDown'} size={14} />
                          </button>
                        </label>
                        {open && (
                          <div style={{ padding: '2px 14px 12px 38px' }}>
                            <ShipmentContentsPanel shipmentId={s.id} />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                <SelectedContentsRollup shipmentIds={[...selected]} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 12, fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
                  <Icon name="lock" size={12} />Привязанные отгрузки нельзя добавить в другой счёт.
                </div>
              </>
            )}
          </PhaseBlock>

          <PhaseBlock icon="receipt" title="Параметры счёта" role="manager" state="active">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <FieldLabel>Плановая дата расчёта</FieldLabel>
                <DatePicker value={dueDate} onChange={setDueDate} />
              </div>
              <div>
                <FieldLabel>Сумма счёта, ₽</FieldLabel>
                <input
                  className="input" inputMode="decimal" placeholder="например, 150000" value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  style={amountInvalid ? { borderColor: 'var(--c-danger)', background: 'var(--c-danger-bg)' } : undefined}
                />
                <div style={{ fontSize: 11.5, color: amount && kopecks == null ? 'var(--c-danger)' : 'var(--c-text-subtle)', marginTop: 4 }}>
                  {amount && kopecks == null ? 'Введите число' : `К начислению: ${formatMoneyKopecks(kopecks ?? 0)}`}
                </div>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <FieldLabel>Комментарий</FieldLabel>
                <textarea className="input" rows={3} style={{ resize: 'vertical' }} placeholder="Необязательно" value={comment} onChange={(e) => setComment(e.target.value)} />
              </div>
            </div>
          </PhaseBlock>
        </div>

        {/* Правая колонка — превью жизненного цикла + сводка */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <InvoiceRailPanel phase="draft" overdue={false} dueDate={dueDate ? fmtDate(dueDate) : 'выбрать'} duePrev={null} stamps={{ draft: 'сейчас' }} />
          <Panel icon="wallet" title="Сводка счёта">
            <div style={{ padding: '0 2px' }}>
              <ReadRow label="Клиент" strong>{clientName ?? '—'}</ReadRow>
              <ReadRow label="Отгрузок выбрано" mono strong>{selected.size}</ReadRow>
              <ReadRow label="Всего мест" mono>{selQty.toLocaleString('ru-RU')} шт</ReadRow>
              <ReadRow label="Срок расчёта" mono>{dueDate ? fmtDate(dueDate) : '—'}</ReadRow>
              <div style={{ borderTop: '1px solid var(--c-border)', margin: '8px 0 4px' }} />
              <ReadRow label="Сумма счёта" mono strong>{formatMoneyKopecks(kopecks ?? 0)}</ReadRow>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10, fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
              <Icon name="edit" size={12} />Отгрузки, сумму, срок и файл можно дозаполнить в карточке черновика — счёт выставляется отдельно.
            </div>
          </Panel>
        </div>
      </div>
    </FormPage>
  )
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--c-text-muted)' }}>{children}</span>
      {required && <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--c-text-faint)' }}>обяз.</span>}
    </div>
  )
}
