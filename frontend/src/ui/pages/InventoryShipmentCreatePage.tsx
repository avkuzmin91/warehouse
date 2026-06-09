import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { createShipment, advanceShipment, getShipment, uploadShipmentLineFile } from '../../api/shipmentsApi'
import type { ShipmentLineIn, ShipmentCargoType } from '../../api/shipmentsApi'
import type { BalanceItem } from '../../api/balancesApi'
import { getInventoryClientStores } from '../../api/inventoryLookupsApi'
import type { ClientStoreItem } from '../../api/domainTypes'
import { Combobox } from '../data/Combobox'
import type { ComboboxOption } from '../data/Combobox'
import { Icon } from '../primitives/Icon'
import { AutoGrowTextarea, Field } from '../primitives/Input'
import { DatePicker } from '../primitives/DatePicker'
import { Alert } from '../primitives/Alert'
import { EmptyState } from '../primitives/EmptyState'
import { Modal } from '../feedback/Modal'
import { ShipmentStepper } from '../features/inventory/ShipmentStepper'
import { BalancePicker } from '../features/inventory/shared/BalancePicker'
import { NumberStep } from '../features/inventory/shared/NumberStep'
import { fmtYmdAsDmy } from '../../utils/format'
import { balanceKey } from '../../utils/balanceKey'
import { canViewCosts } from '../../utils/access'
import { useLookups } from '../../hooks/useLookups'
import { useCurrentUser } from '../../hooks/useCurrentUser'

type DraftLine = ShipmentLineIn & { _key: string; available: number; files: File[] }
type DraftLineFilePreview = {
  file: File
  productName: string
  sku: string
  colorName: string | null
  sizeName: string | null
  qty: number
}

export function InventoryShipmentCreatePage() {
  const navigate = useNavigate()

  const [cargoType, setCargoType] = useState<ShipmentCargoType>('good')
  const [clientId, setClientId] = useState<string | null>(null)
  const [clientName, setClientName] = useState<string | null>(null)
  const [logisticsCost, setLogisticsCost] = useState('')
  const [shipDate, setShipDate] = useState('')
  const [comment, setComment] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [clientStores, setClientStores] = useState<ClientStoreItem[]>([])
  const [filePreview, setFilePreview] = useState<DraftLineFilePreview | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showBlockReasons, setShowBlockReasons] = useState(false)

  const { clients } = useLookups()
  const { user } = useCurrentUser()
  const showCosts = canViewCosts(user)

  const clientOptions: ComboboxOption[] = clients.map((c) => ({ value: c.id, label: c.name }))
  const storeOptions: ComboboxOption[] = clientStores.map((s) => ({ value: s.id, label: s.name }))

  useEffect(() => {
    if (!clientId) {
      setClientStores([])
      return
    }
    const controller = new AbortController()
    getInventoryClientStores(clientId, controller.signal)
      .then(setClientStores)
      .catch(() => setClientStores([]))
    return () => controller.abort()
  }, [clientId])

  const totalQty = lines.reduce((s, l) => s + l.qty, 0)
  const hasOverflow = lines.some((l) => l.qty > l.available)
  const logisticsCostNumber = Number(logisticsCost)
  const logisticsCostFilled = logisticsCost.trim() !== '' && Number.isFinite(logisticsCostNumber) && logisticsCostNumber >= 0
  const readyChecks = [
    { ok: !!clientId, error: 'Выберите клиента' },
    { ok: !!shipDate, error: 'Укажите дату отгрузки' },
    { ok: comment.trim() !== '', error: 'Заполните техническое задание' },
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

  function setLineStore(key: string, storeId: string, storeName: string | null) {
    setLines((ls) => ls.map((l) => l._key === key
      ? { ...l, store_id: storeId || null, store_name: storeId ? storeName : null }
      : l))
  }

  function addLineFiles(key: string, files: File[]) {
    if (files.length === 0) return
    for (const file of files) {
      const invalid = validateLineFile(file)
      if (invalid) { setError(`${file.name}: ${invalid}`); return }
    }
    setError('')
    setLines((ls) => ls.map((l) => l._key === key ? { ...l, files: [...l.files, ...files] } : l))
  }

  function replaceLineFile(key: string, index: number, file: File) {
    const invalid = validateLineFile(file)
    if (invalid) { setError(`${file.name}: ${invalid}`); return }
    setError('')
    setLines((ls) => ls.map((l) => l._key === key
      ? { ...l, files: l.files.map((f, i) => i === index ? file : f) }
      : l))
  }

  function removeLineFile(key: string, index: number) {
    setLines((ls) => ls.map((l) => l._key === key
      ? { ...l, files: l.files.filter((_, i) => i !== index) }
      : l))
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
      store_id:          null,
      store_name:        null,
      files:             [],
    }])
  }

  async function uploadDraftFiles(docId: string) {
    const withFiles = lines.filter((l) => l.files.length > 0)
    if (withFiles.length === 0) return
    const detail = await getShipment(docId)
    for (const draft of withFiles) {
      const target = detail.lines.find((cl) => balanceKey(cl) === draft._key)
      if (!target) continue
      for (const file of draft.files) {
        await uploadShipmentLineFile(docId, target.id, file)
      }
    }
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
          store_id:          line.store_id ?? null,
          store_name:        line.store_name ?? null,
        })),
      })
      const docId = res.message
      await uploadDraftFiles(docId)
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
                <Field label="Техническое задание" required style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                  <AutoGrowTextarea
                    minRows={3}
                    placeholder="Опишите задачу для команды склада"
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
                    <th style={{ width: 180 }}>Магазин</th>
                    <th style={{ textAlign: 'right', width: 160 }}>План отгрузки</th>
                    <th style={{ width: 124, textAlign: 'center' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--c-text-subtle)' }}>
                        <Icon name="paperclip" size={12} style={{ opacity: 0.7 }} />Файлы
                      </span>
                    </th>
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
                        <td>
                          <div className="store-cell-combobox">
                            <Combobox
                              value={l.store_id ?? null}
                              placeholder="Без магазина"
                              options={storeOptions}
                              onChange={(v, opt) => setLineStore(l._key, String(v ?? ''), opt?.label ?? null)}
                              clearable
                            />
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
                            <NumberStep value={l.qty} onChange={(v) => updateQty(l._key, v)} />
                            {over && <Icon name="alert" size={13} style={{ color: 'var(--c-warning)' }} />}
                          </div>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <DraftLineFilesCell
                            files={l.files}
                            previewMeta={{
                              productName: l.product_name,
                              sku: l.product_sku,
                              colorName: l.color_name ?? null,
                              sizeName: l.size_name ?? null,
                              qty: l.qty,
                            }}
                            onPreview={setFilePreview}
                            onAdd={(files) => addLineFiles(l._key, files)}
                            onReplace={(index, file) => replaceLineFile(l._key, index, file)}
                            onRemove={(index) => removeLineFile(l._key, index)}
                          />
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
                    <td colSpan={3} style={{ padding: '10px 12px', fontWeight: 500, fontSize: 12.5 }}>
                      Итого: {lines.length} SKU
                    </td>
                    <td className="num" style={{ padding: '10px 12px', fontWeight: 600, fontSize: 14 }}>{totalQty}</td>
                    <td />
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

      <DraftFilePreviewModal
        preview={filePreview}
        onClose={() => setFilePreview(null)}
      />
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

const ALLOWED_FILE_EXTS = ['pdf', 'png', 'jpg', 'jpeg']
const MAX_FILE_BYTES = 10 * 1024 * 1024

function validateLineFile(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!ALLOWED_FILE_EXTS.includes(ext)) return 'Допустимы файлы: PDF, PNG, JPG'
  if (file.size > MAX_FILE_BYTES) return 'Файл слишком большой (максимум 10 МБ)'
  return null
}

function isPdfName(filename: string): boolean {
  return filename.split('.').pop()?.toLowerCase() === 'pdf'
}

function draftFileIcon(filename: string): 'filePdf' | 'fileImg' {
  return isPdfName(filename) ? 'filePdf' : 'fileImg'
}

function draftFileColor(filename: string): string {
  return isPdfName(filename) ? 'var(--c-danger)' : 'var(--c-accent)'
}

function isImageName(filename: string): boolean {
  return ['png', 'jpg', 'jpeg'].includes(filename.split('.').pop()?.toLowerCase() ?? '')
}

function shortFileName(name: string, max = 16): string {
  if (name.length <= max) return name
  const ext = name.includes('.') ? '.' + name.split('.').pop() : ''
  const base = name.slice(0, max - ext.length - 1)
  return `${base}…${ext}`
}

function printFile(url: string) {
  const frame = document.createElement('iframe')
  let cleaned = false
  let cleanupTimer: number | undefined

  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    if (cleanupTimer != null) window.clearTimeout(cleanupTimer)
    window.setTimeout(() => frame.remove(), 500)
  }

  frame.style.position = 'fixed'
  frame.style.right = '0'
  frame.style.bottom = '0'
  frame.style.width = '1px'
  frame.style.height = '1px'
  frame.style.border = '0'
  frame.style.opacity = '0'
  frame.style.pointerEvents = 'none'
  frame.src = url
  frame.onload = () => {
    window.setTimeout(() => {
      const printWindow = frame.contentWindow
      if (!printWindow) {
        cleanup()
        return
      }

      const cleanupAfterDialog = () => {
        window.setTimeout(cleanup, 1000)
      }

      printWindow.addEventListener('afterprint', cleanupAfterDialog, { once: true })
      window.addEventListener('focus', cleanupAfterDialog, { once: true })
      cleanupTimer = window.setTimeout(cleanup, 120000)

      printWindow.focus()
      printWindow.print()
    }, 700)
  }
  document.body.appendChild(frame)
}

function fitWidthPreviewUrl(url: string): string {
  const [base] = url.split('#')
  return `${base}#zoom=page-width&view=FitH`
}

function DraftFilePreviewModal({ preview, onClose }: {
  preview: DraftLineFilePreview | null
  onClose: () => void
}) {
  const file = preview?.file ?? null
  const url = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  const isPdfFile = file ? isPdfName(file.name) : false
  const isImage = file ? isImageName(file.name) : false
  const previewUrl = isPdfFile ? fitWidthPreviewUrl(url) : url

  return (
    <Modal
      open={!!preview}
      onClose={onClose}
      title={file?.name ?? 'Файл'}
      subtitle={preview ? `${preview.productName} · ${preview.sku}` : undefined}
      width={1040}
      footer={(
        <>
          <a className="btn ghost" href={url} target="_blank" rel="noopener noreferrer">
            <Icon name="eye" size={14} />Открыть отдельно
          </a>
          <button className="btn primary" disabled={!file} onClick={() => printFile(url)}>
            <Icon name="print" size={14} />Печать
          </button>
        </>
      )}
    >
      {preview && file && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 240px', gap: 16, minHeight: 520 }}>
          <div
            style={{
              minHeight: 520,
              border: '1px solid var(--c-border)',
              borderRadius: 'var(--r-lg)',
              background: 'var(--c-bg-sunken)',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {isPdfFile ? (
              <iframe
                title={file.name}
                src={previewUrl}
                style={{ width: '100%', height: 520, border: 0, background: 'var(--c-bg-elev)' }}
              />
            ) : isImage ? (
              <img
                src={url}
                alt={file.name}
                style={{ display: 'block', width: '100%', height: 520, objectFit: 'contain' }}
              />
            ) : (
              <div style={{ color: 'var(--c-text-subtle)', fontSize: 13 }}>Предпросмотр недоступен</div>
            )}
          </div>

          <div
            style={{
              border: '1px solid var(--c-border)',
              borderRadius: 'var(--r-lg)',
              background: 'var(--c-bg-elev)',
              padding: 14,
              alignSelf: 'start',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 'var(--r-md)',
                  background: isPdfFile ? 'var(--c-danger-bg)' : 'var(--c-accent-bg)',
                  color: draftFileColor(file.name),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Icon name={draftFileIcon(file.name)} size={17} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  ШК к отгрузке
                </div>
                <div className="text-xs subtle">{isPdfFile ? 'PDF' : 'Изображение'}</div>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 10 }}>
              <PreviewMeta label="Товар" value={preview.productName} />
              <PreviewMeta label="SKU" value={preview.sku} mono />
              <PreviewMeta label="Цвет" value={preview.colorName || '—'} />
              <PreviewMeta label="Размер" value={preview.sizeName || '—'} />
              <div
                style={{
                  marginTop: 4,
                  padding: '12px 14px',
                  borderRadius: 'var(--r-lg)',
                  background: 'var(--c-accent-bg)',
                  border: '1px solid var(--c-accent-border)',
                }}
              >
                <div style={{ fontSize: 11.5, color: 'var(--c-accent-text)', marginBottom: 3 }}>План к печати</div>
                <div className="mono" style={{ fontSize: 24, fontWeight: 700, color: 'var(--c-accent-text)' }}>
                  {preview.qty.toLocaleString('ru-RU')} шт
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

function PreviewMeta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', marginBottom: 2 }}>{label}</div>
      <div
        className={mono ? 'mono' : undefined}
        style={{ fontSize: 13, fontWeight: 500, overflowWrap: 'anywhere' }}
      >
        {value}
      </div>
    </div>
  )
}

function DraftLineFilesCell({ files, previewMeta, onPreview, onAdd, onReplace, onRemove }: {
  files: File[]
  previewMeta: Omit<DraftLineFilePreview, 'file'>
  onPreview: (preview: DraftLineFilePreview) => void
  onAdd: (files: File[]) => void
  onReplace: (index: number, file: File) => void
  onRemove: (index: number) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const replaceTargetRef = useRef<number | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [popStyle, setPopStyle] = useState<React.CSSProperties>({})

  function pickFile(replaceIndex: number | null) {
    replaceTargetRef.current = replaceIndex
    inputRef.current?.click()
  }

  function previewFile(file: File) {
    onPreview({ ...previewMeta, file })
  }

  function handleInputChange(e: { target: HTMLInputElement }) {
    const selected = Array.from(e.target.files ?? [])
    if (selected.length > 0) {
      if (replaceTargetRef.current != null) onReplace(replaceTargetRef.current, selected[0])
      else onAdd(selected)
    }
    replaceTargetRef.current = null
    e.target.value = ''
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const dropped = Array.from(e.dataTransfer.files ?? [])
    if (dropped.length > 0) onAdd(dropped)
  }

  const updatePopPosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const gap = 4
    const width = 240
    const left = Math.min(rect.left, window.innerWidth - width - 8)
    setPopStyle({ position: 'fixed', top: rect.bottom + gap, left, width })
  }, [])

  useEffect(() => {
    if (!popoverOpen) return
    updatePopPosition()
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t) || popoverRef.current?.contains(t)) return
      setPopoverOpen(false)
    }
    window.addEventListener('resize', updatePopPosition)
    window.addEventListener('scroll', updatePopPosition, true)
    document.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('resize', updatePopPosition)
      window.removeEventListener('scroll', updatePopPosition, true)
      document.removeEventListener('mousedown', onDown)
    }
  }, [popoverOpen, updatePopPosition])

  const hiddenInput = (
    <input
      ref={inputRef}
      type="file"
      accept=".pdf,.png,.jpg,.jpeg"
      multiple
      style={{ display: 'none' }}
      onChange={handleInputChange}
    />
  )

  if (files.length === 0) {
    return (
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        style={{ display: 'inline-flex' }}
      >
        {hiddenInput}
        <button
          type="button"
          title="Прикрепить файл (PDF, PNG, JPG)"
          onClick={() => pickFile(null)}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            height: 28, width: 28, borderRadius: 'var(--r-md)',
            border: `1px solid ${dragOver ? 'var(--c-accent)' : 'var(--c-border)'}`,
            background: dragOver ? 'var(--c-bg-hover)' : 'var(--c-bg-elev)',
            color: 'var(--c-accent)',
            cursor: 'pointer', transition: 'all 120ms ease',
          }}
        >
          <Icon name="importFile" size={15} />
        </button>
      </div>
    )
  }

  const single = files[0]
  const many = files.length > 1

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: 'inline-flex', justifyContent: 'center' }}
    >
      {hiddenInput}
      <div
        ref={triggerRef}
        onClick={() => { if (many) setPopoverOpen((o) => !o) }}
        title={many ? `${files.length} файла` : single.name}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          height: 28, maxWidth: 180, padding: '0 4px 0 8px',
          borderRadius: 'var(--r-md)',
          border: `1px solid ${dragOver ? 'var(--c-accent)' : 'var(--c-border)'}`,
          background: dragOver ? 'var(--c-bg-hover)' : 'var(--c-bg-elev)',
          cursor: many ? 'pointer' : 'default', transition: 'border-color 120ms ease',
        }}
      >
        {many ? (
          <>
            <Icon name="filePdf" size={14} style={{ color: 'var(--c-danger)', flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--c-text)' }}>
              {files.length} файла
            </span>
            <Icon name="chevDown" size={12} style={{ color: 'var(--c-text-subtle)', flexShrink: 0 }} />
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); previewFile(single) }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0,
                border: 0, background: 'transparent', padding: 0, cursor: 'pointer',
                color: 'var(--c-text)',
              }}
            >
              <Icon
                name={draftFileIcon(single.name)}
                size={14}
                style={{ color: draftFileColor(single.name), flexShrink: 0 }}
              />
              <span style={{
                fontSize: 12, fontWeight: 500,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {shortFileName(single.name)}
              </span>
            </button>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 1, flexShrink: 0,
              opacity: hover ? 1 : 0, transition: 'opacity 120ms ease',
              pointerEvents: hover ? 'auto' : 'none',
            }}>
              <button
                type="button"
                title="Прикрепить ещё файл"
                onClick={(e) => { e.stopPropagation(); pickFile(null) }}
                className="btn ghost icon sm"
                style={{ width: 22, height: 22, color: 'var(--c-accent)' }}
              >
                <Icon name="importFile" size={12} />
              </button>
              <button
                type="button"
                title="Заменить файл"
                onClick={(e) => { e.stopPropagation(); pickFile(0) }}
                className="btn ghost icon sm"
                style={{ width: 22, height: 22, color: 'var(--c-text-subtle)' }}
              >
                <Icon name="refresh" size={12} />
              </button>
              <button
                type="button"
                title="Удалить файл"
                onClick={(e) => { e.stopPropagation(); onRemove(0) }}
                className="btn ghost icon sm"
                style={{ width: 22, height: 22, color: 'var(--c-text-faint)' }}
              >
                <Icon name="x" size={12} />
              </button>
            </span>
          </>
        )}
      </div>

      {popoverOpen && many && createPortal(
        <div
          ref={popoverRef}
          style={{
            ...popStyle,
            background: 'var(--c-bg-elev)',
            border: '1px solid var(--c-border)',
            borderRadius: 'var(--r-lg)',
            boxShadow: 'var(--sh-2)',
            zIndex: 9999, padding: 4,
          }}
        >
          {files.map((f, i) => (
            <div
              key={i}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 8px', borderRadius: 'var(--r-md)',
              }}
            >
              <button
                type="button"
                onClick={() => { setPopoverOpen(false); previewFile(f) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1,
                  border: 0, background: 'transparent', padding: 0, cursor: 'pointer',
                  textAlign: 'left', color: 'var(--c-text)',
                }}
              >
                <Icon
                  name={draftFileIcon(f.name)}
                  size={15}
                  style={{ color: draftFileColor(f.name), flexShrink: 0 }}
                />
                <span style={{
                  fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {f.name}
                </span>
              </button>
              <button
                type="button"
                title="Удалить файл"
                onClick={() => { onRemove(i); if (files.length <= 1) setPopoverOpen(false) }}
                className="btn ghost icon sm"
                style={{ width: 22, height: 22, color: 'var(--c-text-faint)', flexShrink: 0 }}
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          ))}
          <div style={{ height: 1, background: 'var(--c-border)', margin: '4px 0' }} />
          <button
            type="button"
            onClick={() => { setPopoverOpen(false); pickFile(null) }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              padding: '6px 8px', borderRadius: 'var(--r-md)',
              border: 0, background: 'transparent', cursor: 'pointer',
              fontSize: 12.5, color: 'var(--c-accent)',
            }}
          >
            <Icon name="importFile" size={15} />Прикрепить файл
          </button>
        </div>,
        document.body,
      )}
    </div>
  )
}

