import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createShipment, advanceShipment, getShipment, uploadShipmentLineFile } from '../../../api/shipmentsApi'
import type { ShipmentLineIn, ShipmentCargoType } from '../../../api/shipmentsApi'
import type { BalanceItem } from '../../../api/balancesApi'
import { getInventoryClientStores } from '../../../api/inventoryLookupsApi'
import type { ClientStoreItem } from '../../../api/domainTypes'
import { Combobox } from '../../data/Combobox'
import type { ComboboxOption } from '../../data/Combobox'
import { Icon } from '../../primitives/Icon'
import { AutoGrowTextarea, Field } from '../../primitives/Input'
import { DatePicker } from '../../primitives/DatePicker'
import { Alert } from '../../primitives/Alert'
import { EmptyState } from '../../primitives/EmptyState'
import { BalancePicker } from './shared/BalancePicker'
import { NumberStep } from './shared/NumberStep'
import { PhaseBlock } from '../shared/process/PhaseBlock'
import { ShipHeader } from './shipmentDetail/components/ShipHeader'
import { Panel, ReadRow, RailPanel, ChecklistPanel, LockedGrid } from './shipmentDetail/components/processUI'
import { FilePreviewModal } from './shipmentDetail/components/FilePreviewModal'
import { LineFilesCell } from './shipmentDetail/components/LineFilesCell'
import { validateLineFile } from './shipmentDetail/components/fileHelpers'
import type { FilePreviewMeta } from './shipmentDetail/shared/types'
import { PrimaryAction } from '../shared/process/PrimaryAction'
import { fmtYmdAsDmy } from '../../../utils/format'
import { balanceKey } from '../../../utils/balanceKey'
import { canViewCosts } from '../../../utils/access'
import { useLookups } from '../../../hooks/useLookups'
import { useCurrentUser } from '../../../hooks/useCurrentUser'

type DraftLine = ShipmentLineIn & { _key: string; available: number; files: File[] }
type DraftLineFilePreview = FilePreviewMeta & { file: File }

export function ShipmentCreateFeature({ cargoType }: { cargoType: ShipmentCargoType }) {
  const navigate = useNavigate()

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

  const isDefectCargo = cargoType === 'defect'
  const totalQty = lines.reduce((s, l) => s + l.qty, 0)
  const hasOverflow = lines.some((l) => l.qty > l.available)
  const logisticsCostNumber = Number(logisticsCost)
  const logisticsCostFilled = logisticsCost.trim() !== '' && Number.isFinite(logisticsCostNumber) && logisticsCostNumber >= 0
  // Брак-отгрузка минует упаковку: ТЗ не требуется, у строк должно быть местоположение.
  const readyChecks = [
    { ok: !!clientId, label: 'Клиент выбран', error: 'Выберите клиента' },
    { ok: !!shipDate, label: 'Дата отгрузки (план) указана', error: 'Укажите дату отгрузки' },
    ...(isDefectCargo
      ? []
      : [{ ok: comment.trim() !== '', label: 'Техническое задание заполнено', error: 'Заполните техническое задание' }]),
    ...(showCosts ? [{ ok: logisticsCostFilled, label: 'Стоимость логистики указана', error: 'Укажите стоимость логистики' }] : []),
    { ok: lines.length > 0, label: 'Добавлены строки', error: 'Добавьте хотя бы одну позицию в отгрузку' },
    { ok: !hasOverflow, label: 'Количество в пределах остатка', error: 'Уменьшите количество в позициях, где запрошено больше остатка' },
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
      available:         cargoType === 'defect' ? b.storage_defect : b.storage_good,
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
      <ShipHeader
        status="draft"
        cargoType={cargoType}
        title={isDefectCargo ? 'Новая отгрузка брака' : 'Новая отгрузка'}
        subtitle="номер присвоится при сохранении"
        onBack={() => navigate('/inventory/shipments')}
        blockReasons={showBlockReasons ? blockReasons : []}
        actions={
          <>
            <button className="btn" disabled={saving} onClick={() => navigate('/inventory/shipments')}>Отмена</button>
            <PrimaryAction
              icon="check"
              label="Запланировать отгрузку"
              hint={isDefectCargo
                ? 'уйдёт кладовщику на подготовку — статус «Перемещение»'
                : 'уйдёт кладовщику — статус «В плане»'}
              disabled={saving}
              onClick={handleSendToPacking}
            />
          </>
        }
      />

      {hasOverflow && (
        <Alert tone="warning" style={{ marginBottom: 14 }}>
          <span style={{ fontWeight: 500 }}>Запрошено больше, чем доступно по одной или нескольким позициям.</span>
        </Alert>
      )}

      {error && <div style={{ color: 'var(--c-danger)', fontSize: 13, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 332px', gap: 18, alignItems: 'start' }}>
        {/* Left — фазы */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          <PhaseBlock icon="file" title="Основная информация" role="manager" state="active"
            hint="Клиент и задание для команды склада">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
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
                <Field label="Техническое задание" required={!isDefectCargo} style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                  <AutoGrowTextarea
                    minRows={3}
                    placeholder="Опишите задачу для команды склада"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    style={{ resize: 'vertical', minHeight: 76 }}
                  />
                </Field>
              </div>
          </PhaseBlock>

          <PhaseBlock icon="boxes" title="Состав отгрузки" role="manager" state="active"
            hint="Товар из остатков клиента"
            right={
              <button className="btn sm primary" onClick={() => setShowPicker(true)} disabled={!clientId}>
                <Icon name="plus" size={12} />Добавить товар
              </button>
            }>

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
                          <LineFilesCell
                            entries={l.files.map((f, i) => ({
                              id: String(i),
                              filename: f.name,
                              mimeType: f.type || null,
                            }))}
                            canEdit
                            onPreview={(entry) => {
                              const file = l.files[Number(entry.id)]
                              if (!file) return
                              setFilePreview({
                                file,
                                productName: l.product_name,
                                sku: l.product_sku,
                                colorName: l.color_name ?? null,
                                sizeName: l.size_name ?? null,
                                qty: l.qty,
                              })
                            }}
                            onAdd={(files) => addLineFiles(l._key, files)}
                            onReplace={(entryId, file) => replaceLineFile(l._key, Number(entryId), file)}
                            onRemove={(entryId) => removeLineFile(l._key, Number(entryId))}
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
          </PhaseBlock>

          {!isDefectCargo && (
            <>
              <PhaseBlock icon="box" title="Упаковка" role="shift_lead" state="locked"
                hint="Годный и брак внесёт начальник смены после передачи товара">
                <LockedGrid labels={['На упаковке', 'Годный', 'Брак']} />
              </PhaseBlock>

              <PhaseBlock icon="archive" title="Раскладка и рейс" role="warehouse" state="locked"
                hint="Местоположения и готовность к рейсу — после упаковки">
                <LockedGrid labels={['Местоположения', 'Готово к рейсу']} />
              </PhaseBlock>
            </>
          )}

          {isDefectCargo && (
            <PhaseBlock icon="archive" title="Подготовка к отгрузке" role="warehouse" state="locked"
              hint="Кладовщик выберет места-источники и перенесёт брак в зону отгрузки">
              <LockedGrid labels={['Места-источники', 'Готово к рейсу']} />
            </PhaseBlock>
          )}
        </div>

        {/* Right — маршрут + итог + готовность */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <RailPanel status="draft" cargoType={cargoType} />
          <Panel icon="chart" title="Итого">
            <div style={{ padding: '0 2px' }}>
              <ReadRow label="SKU" mono>{lines.length}</ReadRow>
              <ReadRow label="Кол-во" mono strong>{totalQty} шт</ReadRow>
              <ReadRow label="Дата (план)" mono>{shipDate ? fmtYmdAsDmy(shipDate) : '—'}</ReadRow>
              {showCosts && (
                <ReadRow label="Логистика" mono>{logisticsCostFilled ? `${logisticsCostNumber.toLocaleString('ru-RU')} ₽` : '—'}</ReadRow>
              )}
            </div>
          </Panel>
          <ChecklistPanel items={readyChecks.map((c) => ({ ok: c.ok, label: c.label }))} />
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

/** Обёртка общей модалки для локальных (ещё не загруженных) файлов: object URL + revoke. */
function DraftFilePreviewModal({ preview, onClose }: {
  preview: DraftLineFilePreview | null
  onClose: () => void
}) {
  const file = preview?.file ?? null
  const url = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  return (
    <FilePreviewModal
      filename={file?.name ?? null}
      mimeType={file ? (file.type || null) : null}
      url={url}
      meta={preview}
      onClose={onClose}
    />
  )
}
