import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBackNav } from '../../../hooks/useBackNav'
import { createShipment, advanceShipment, getShipment, uploadShipmentLineFile, checkShipmentDuplicate, decodeShipmentFileBarcodes } from '../../../api/shipmentsApi'
import type { LineFileBarcode } from '../../../api/shipmentsApi'
import { useToast } from '../../feedback/Toast'
import type { ShipmentLineIn, ShipmentCargoType, ShipmentTaskKind } from '../../../api/shipmentsApi'
import type { DuplicateMatch, ProductFileItem } from '../../../api/domainTypes'
import { attachShipmentLineFileFromProduct } from '../../../api/shipmentsApi'
import { resolvePublicUploadSrc } from '../../../api/constants'
import { ProductLabelPickerModal } from './shipmentDetail/components/ProductLabelPickerModal'
import { DuplicateWarnModal } from './shared/DuplicateWarnModal'
import { ClientActiveDocsPanel, activeDocVariantKey, loadActiveShipments } from './shared/ClientActiveDocsPanel'
import type { PlannableItem } from '../../../api/balancesApi'
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
import { AssignSkuDrawer } from './shared/AssignSkuDrawer'
import { NumberStep } from './shared/NumberStep'
import { updateProduct } from '../../../api/adminApi'
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
import { canCreateDocuments } from '../../../utils/access'
import { useLookups } from '../../../hooks/useLookups'
import { useCurrentUser } from '../../../hooks/useCurrentUser'

type DraftLine = ShipmentLineIn & { _uid: string; _key: string; onHand: number; inTransit: number; sku_pending: boolean; files: File[]; productFiles: ProductFileItem[] }
type DraftLineFilePreview = FilePreviewMeta & { file?: File; url?: string; mimeType?: string | null; filename?: string }

export function ShipmentCreateFeature(
  { cargoType, taskKind = 'packing' }: { cargoType: ShipmentCargoType; taskKind?: ShipmentTaskKind },
) {
  const navigate = useNavigate()
  const goBack = useBackNav('/inventory/shipments')

  const [clientId, setClientId] = useState<string | null>(null)
  const [clientName, setClientName] = useState<string | null>(null)
  const [shipDate, setShipDate] = useState('')
  const [comment, setComment] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [clientStores, setClientStores] = useState<ClientStoreItem[]>([])
  const [filePreview, setFilePreview] = useState<DraftLineFilePreview | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  const [skuLine, setSkuLine] = useState<DraftLine | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showBlockReasons, setShowBlockReasons] = useState(false)
  const [dupMatches, setDupMatches] = useState<DuplicateMatch[]>([])
  // Куда идти после подтверждения дубля: черновик или сразу «Запланировать упаковку».
  const pendingPackingRef = useRef(false)
  const lineUidSeq = useRef(0)

  const { clients } = useLookups()
  const { user } = useCurrentUser()
  const canCreate = canCreateDocuments(user)
  const toast = useToast()

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
  // Сверх остатка, но в пределах «остаток + в пути» — товар ещё едет: сохранить
  // черновик можно, запланировать — только после прихода. Сверх «в пути» — реальный перебор.
  const hasInTransit = lines.some((l) => l.qty > l.onHand && l.qty <= l.onHand + l.inTransit)
  const hasOverCap = lines.some((l) => l.qty > l.onHand + l.inTransit)
  const allOnStock = lines.every((l) => l.qty <= l.onHand)
  // Брак-отгрузка минует упаковку: ТЗ не требуется, у строк должно быть местоположение.
  const readyChecks = [
    { ok: !!clientId, label: 'Клиент выбран', error: 'Выберите клиента' },
    { ok: !!shipDate, label: 'Дата упаковки (план) указана', error: 'Укажите дату упаковки' },
    ...(isDefectCargo
      ? []
      : [{ ok: comment.trim() !== '', label: 'Техническое задание заполнено', error: 'Заполните техническое задание' }]),
    { ok: lines.length > 0, label: 'Добавлены строки', error: 'Добавьте хотя бы одну позицию в отгрузку' },
    { ok: lines.every((l) => !l.sku_pending), label: 'У всех товаров указан SKU', error: 'Укажите SKU для товаров без артикула (кнопка «Указать SKU» в строке)' },
    { ok: !hasOverCap, label: 'Количество в пределах остатка и товара в пути', error: 'Уменьшите количество в позициях, где запрошено больше остатка и товара в пути' },
    { ok: allOnStock, label: 'Весь товар на остатках', error: 'Часть товара ещё в пути — сохраните черновик и запланируйте после прихода' },
  ]
  const blockReasons = readyChecks.filter((check) => !check.ok).map((check) => check.error)

  function handleClientChange(val: string | number | null, opt?: ComboboxOption) {
    setClientId(val ? String(val) : null)
    setClientName(opt?.label ?? null)
    // clear lines that may not belong to this client
    setLines([])
  }

  function updateQty(uid: string, qty: number) {
    setLines((ls) => ls.map((l) => l._uid === uid ? { ...l, qty: Math.max(1, qty) } : l))
  }

  function removeLine(uid: string) {
    setLines((ls) => ls.filter((l) => l._uid !== uid))
  }

  function setLineStore(uid: string, storeId: string, storeName: string | null) {
    setLines((ls) => ls.map((l) => l._uid === uid
      ? { ...l, store_id: storeId || null, store_name: storeId ? storeName : null }
      : l))
  }

  const [labelPickerLine, setLabelPickerLine] = useState<DraftLine | null>(null)

  function addProductFileRef(uid: string, file: ProductFileItem) {
    setLines((ls) => ls.map((l) => l._uid === uid && !l.productFiles.some((f) => f.id === file.id)
      ? { ...l, productFiles: [...l.productFiles, file] }
      : l))
  }

  function removeProductFileRef(uid: string, fileId: string) {
    setLines((ls) => ls.map((l) => l._uid === uid
      ? { ...l, productFiles: l.productFiles.filter((f) => f.id !== fileId) }
      : l))
  }

  // Распознанные ШК на локальных файлах черновика — код виден сразу при добавлении,
  // до создания документа. Ключ — сам File (объекты стабильны до сохранения).
  const [draftFileCodes, setDraftFileCodes] = useState<ReadonlyMap<File, string[]>>(new Map())

  function recognizeDraftFiles(files: File[]) {
    for (const file of files) {
      decodeShipmentFileBarcodes(file)
        .then((res) => {
          if (res.barcodes.length === 0) return
          setDraftFileCodes((prev) => new Map(prev).set(file, res.barcodes))
        })
        .catch(() => {})
    }
  }

  function addLineFiles(uid: string, files: File[]) {
    if (files.length === 0) return
    for (const file of files) {
      const invalid = validateLineFile(file)
      if (invalid) { setError(`${file.name}: ${invalid}`); return }
    }
    setError('')
    setLines((ls) => ls.map((l) => l._uid === uid ? { ...l, files: [...l.files, ...files] } : l))
    recognizeDraftFiles(files)
  }

  function replaceLineFile(uid: string, index: number, file: File) {
    const invalid = validateLineFile(file)
    if (invalid) { setError(`${file.name}: ${invalid}`); return }
    setError('')
    setLines((ls) => ls.map((l) => l._uid === uid
      ? { ...l, files: l.files.map((f, i) => i === index ? file : f) }
      : l))
    recognizeDraftFiles([file])
  }

  function removeLineFile(uid: string, index: number) {
    setLines((ls) => ls.map((l) => l._uid === uid
      ? { ...l, files: l.files.filter((_, i) => i !== index) }
      : l))
  }

  function makeDraftLine(b: PlannableItem, qty: number, zoneId: string | null, zoneName: string | null): DraftLine {
    return {
      _uid:              `line-${lineUidSeq.current++}`,
      _key:              balanceKey(b),
      product_id:        b.product_id,
      product_name:      b.product_name,
      product_sku:       b.product_sku,
      color_id:          b.color_id,
      color_name:        b.color_name,
      size_id:           b.size_id,
      size_name:         b.size_name,
      qty,
      onHand:            cargoType === 'defect' ? b.storage_defect : b.storage_good,
      inTransit:         cargoType === 'defect' ? 0 : b.in_transit,
      sku_pending:       !!b.sku_pending,
      storage_zone_id:   zoneId,
      storage_zone_name: zoneName,
      store_id:          null,
      store_name:        null,
      files:             [],
      productFiles:      [],
    }
  }

  function addFromBalance(b: PlannableItem, qty: number, zoneId: string | null, zoneName: string | null) {
    setLines((ls) => [...ls, makeDraftLine(b, qty, zoneId, zoneName)])
  }

  function addManyFromBalance(rows: { item: PlannableItem; qty: number }[]) {
    setLines((ls) => [...ls, ...rows.map(({ item, qty }) => makeDraftLine(item, qty, null, null))])
  }

  async function handleAssignSku(line: DraftLine, skuBase: string) {
    // SKU принадлежит товару; присваиваем/меняем базовый артикул и отражаем его во всех
    // строках того же товара в черновике (черновик ещё не сохранён — обновляем локально).
    await updateProduct(line.product_id, { sku_base: skuBase })
    setLines((ls) => ls.map((l) => l.product_id === line.product_id
      ? { ...l, sku_pending: false, product_sku: skuBase }
      : l))
  }

  // Загрузка файлов черновика. Разбор распознанных ШК происходит в деталке
  // (BarcodeReviewModal): коды хранятся на файлах строк и не теряются, здесь
  // достаточно понять, есть ли что разбирать.
  async function uploadDraftFiles(docId: string): Promise<{ needsReview: boolean; docNumber: string }> {
    const withFiles = lines.filter((l) => l.files.length > 0 || l.productFiles.length > 0)
    if (withFiles.length === 0) return { needsReview: false, docNumber: '' }
    const detail = await getShipment(docId)
    const used = new Set<string>()
    let needsReview = false
    for (const draft of withFiles) {
      const target = detail.lines.find((cl) =>
        !used.has(cl.id) &&
        balanceKey(cl) === draft._key &&
        (cl.store_id ?? null) === (draft.store_id ?? null))
      if (!target) continue
      used.add(target.id)
      for (const file of draft.files) {
        const res = await uploadShipmentLineFile(docId, target.id, file)
        if ((res.barcodes ?? []).some((b: LineFileBarcode) => b.status !== 'confirmed')) needsReview = true
      }
      for (const pf of draft.productFiles) {
        // Дубль этикетки на строке — не ошибка, пропускаем.
        await attachShipmentLineFileFromProduct(docId, target.id, pf.id).catch(() => {})
      }
    }
    return { needsReview, docNumber: detail.doc_number }
  }

  async function handleSave(toPacking: boolean) {
    setError('')
    setSaving(true)
    try {
      const dup = await checkShipmentDuplicate({
        cargo_type: cargoType,
        client_id: clientId || '',
        ship_date: shipDate || null,
        lines: lines.map((l) => ({ product_id: l.product_id, color_id: l.color_id ?? null, size_id: l.size_id ?? null, qty: l.qty })),
      })
      if (dup.matches.length > 0) { pendingPackingRef.current = toPacking; setDupMatches(dup.matches); setSaving(false); return }
    } catch { /* проверка на дубль не критична — не блокируем создание */ }
    await runCreate(toPacking)
  }

  async function runCreate(toPacking: boolean) {
    setSaving(true)
    try {
      const res = await createShipment({
        cargo_type:     cargoType,
        task_kind:      taskKind,
        client_id:      clientId || null,
        client_name:    clientName || null,
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
      const { needsReview, docNumber } = await uploadDraftFiles(docId)
      if (toPacking) await advanceShipment(docId)
      // Сохранение и разбор ШК — независимые шаги: сначала подтверждаем сохранение,
      // затем деталка открывает разбор (state.reviewBarcodes) — отмена там ничего не отменит.
      toast(`Задача ${docNumber ? `${docNumber} ` : ''}сохранена`, 'success')
      navigate(`/inventory/shipments/${docId}`, {
        replace: true,
        state: needsReview ? { reviewBarcodes: true } : undefined,
      })
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

  if (!canCreate) {
    return (
      <div className="page">
        <div style={{ padding: 32, color: 'var(--c-text-subtle)' }}>Недостаточно прав для создания отгрузок.</div>
      </div>
    )
  }

  return (
    <div className="page">
      <ShipHeader
        status="draft"
        cargoType={cargoType}
        title={taskKind === 'putaway'
          ? 'Новая задача: упаковка с ТСД'
          : isDefectCargo ? 'Новая задача упаковки брака' : 'Новая задача: упаковка без ТСД'}
        subtitle="номер присвоится при сохранении"
        initiator={{ name: user?.display_name || user?.email || null }}
        onBack={goBack}
        blockReasons={showBlockReasons ? blockReasons : []}
        actions={
          <>
            <button className="btn" disabled={saving} onClick={goBack}>Отмена</button>
            <button
              className="btn"
              disabled={saving || !clientId || lines.length === 0}
              onClick={() => void handleSave(false)}
              title="Сохранить как черновик — для товара, который ещё в пути"
            >
              <Icon name="save" size={13} />Сохранить черновик
            </button>
            <PrimaryAction
              icon="check"
              label="Запланировать упаковку"
              hint={isDefectCargo
                ? 'уйдёт кладовщику на подготовку — статус «Перемещение»'
                : 'уйдёт кладовщику — статус «В плане»'}
              disabled={saving}
              onClick={handleSendToPacking}
            />
          </>
        }
      />

      {hasOverCap && (
        <Alert tone="warning" style={{ marginBottom: 14 }}>
          <span style={{ fontWeight: 500 }}>Запрошено больше, чем остаток и товар в пути по одной или нескольким позициям.</span>
        </Alert>
      )}
      {!hasOverCap && hasInTransit && (
        <Alert tone="info" style={{ marginBottom: 14 }}>
          <span>Часть товара ещё в пути. Сохраните черновик — запланировать отгрузку можно будет после прихода.</span>
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
                <Field label="Дата упаковки (план)" required style={{ marginBottom: 0 }}>
                  <DatePicker value={shipDate} onChange={setShipDate} />
                </Field>
                <Field label="Техническое задание" required={!isDefectCargo} style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                  <AutoGrowTextarea
                    minRows={3}
                    placeholder="Опишите задачу для команды склада"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    style={{ resize: 'vertical', minHeight: 76 }}
                  />
                </Field>
                <ClientActiveDocsPanel
                  clientId={clientId}
                  nounForms={isDefectCargo
                    ? ['активная задача упаковки брака', 'активные задачи упаковки брака', 'активных задач упаковки брака']
                    : ['активная задача упаковки', 'активные задачи упаковки', 'активных задач упаковки']}
                  load={(cid, signal) => loadActiveShipments(cid, cargoType, signal)}
                  detailHref={(id) => `/inventory/shipments/${id}`}
                  formKeys={lines.map((l) => activeDocVariantKey(l.product_sku, l.product_name, l.color_name, l.size_name))}
                  style={{ gridColumn: '1 / -1' }}
                />
              </div>
          </PhaseBlock>

          <PhaseBlock icon="boxes" title="Состав упаковки" role="manager" state="active"
            hint="Товар на остатках и в пути"
            right={
              <button className="btn sm primary" onClick={() => setShowPicker(true)} disabled={!clientId}>
                <Icon name="plus" size={12} />Добавить товар
              </button>
            }>

            {lines.length === 0 ? (
              <div style={{ padding: '32px 0' }}>
                <EmptyState title="Состав пуст" sub={clientId ? 'Нажмите «Добавить товар» — остатки и товар в пути' : 'Сначала выберите клиента'} />
              </div>
            ) : (
              <table className="t">
                <thead>
                  <tr>
                    <th style={{ width: 32 }} />
                    <th>Товар · вариант</th>
                    <th style={{ width: 180 }}>Магазин</th>
                    <th style={{ textAlign: 'right', width: 176 }}>План упаковки</th>
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
                    const overCap = l.qty > l.onHand + l.inTransit
                    const waiting = !overCap && l.qty > l.onHand
                    return (
                      <tr key={l._uid} style={overCap ? { background: 'var(--c-warning-bg)' } : {}}>
                        <td>
                          <div style={{ width: 26, height: 26, borderRadius: 4, background: 'var(--c-bg-sunken)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Icon name="box" size={12} style={{ color: 'var(--c-text-muted)' }} />
                          </div>
                        </td>
                        <td>
                          <div style={{ fontWeight: 500, fontSize: 13 }}>{l.product_name}</div>
                          <div className="t-sub mono">{[l.product_sku, l.color_name, l.size_name].filter(Boolean).join(' · ')}</div>
                          {l.sku_pending ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                              <span className="badge warning">Без SKU</span>
                              <button className="btn ghost sm" onClick={() => setSkuLine(l)}>
                                <Icon name="edit" size={12} />Указать SKU
                              </button>
                            </div>
                          ) : (
                            <div style={{ marginTop: 4 }}>
                              <button className="btn ghost sm" onClick={() => setSkuLine(l)}>
                                <Icon name="edit" size={12} />Изменить SKU
                              </button>
                            </div>
                          )}
                        </td>
                        <td>
                          <div className="store-cell-combobox">
                            <Combobox
                              value={l.store_id ?? null}
                              placeholder="Без магазина"
                              options={storeOptions}
                              onChange={(v, opt) => setLineStore(l._uid, String(v ?? ''), opt?.label ?? null)}
                              clearable
                            />
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
                            <NumberStep value={l.qty} onChange={(v) => updateQty(l._uid, v)} />
                            {overCap ? (
                              <Icon name="alert" size={13} style={{ color: 'var(--c-warning)' }} />
                            ) : waiting ? (
                              <Icon name="clock" size={13} style={{ color: 'var(--c-text-subtle)' }} />
                            ) : null}
                          </div>
                          <div className="t-sub" style={{ textAlign: 'right', marginTop: 2, whiteSpace: 'nowrap' }}>
                            на складе {l.onHand}{!isDefectCargo && l.inTransit > 0 ? ` · в пути ${l.inTransit}` : ''}
                          </div>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <LineFilesCell
                            entries={[
                              ...l.productFiles.map((f) => ({
                                id: `pf-${f.id}`,
                                filename: f.filename,
                                mimeType: f.mime_type,
                                href: resolvePublicUploadSrc(f.url),
                                caption: f.barcode ? `ШК ${f.barcode}` : undefined,
                              })),
                              ...l.files.map((f, i) => ({
                                id: String(i),
                                filename: f.name,
                                mimeType: f.type || null,
                                caption: (draftFileCodes.get(f) ?? []).length > 0
                                  ? `ШК ${(draftFileCodes.get(f) ?? []).join(', ')}`
                                  : undefined,
                              })),
                            ]}
                            canEdit
                            onPreview={(entry) => {
                              const meta = {
                                productName: l.product_name,
                                sku: l.product_sku,
                                colorName: l.color_name ?? null,
                                sizeName: l.size_name ?? null,
                                qty: l.qty,
                              }
                              if (entry.id.startsWith('pf-')) {
                                const pf = l.productFiles.find((f) => `pf-${f.id}` === entry.id)
                                if (!pf) return
                                setFilePreview({ ...meta, url: resolvePublicUploadSrc(pf.url), mimeType: pf.mime_type, filename: pf.filename })
                                return
                              }
                              const file = l.files[Number(entry.id)]
                              if (!file) return
                              setFilePreview({ ...meta, file })
                            }}
                            onAdd={(files) => addLineFiles(l._uid, files)}
                            onReplace={(entryId, file) => {
                              if (entryId.startsWith('pf-')) {
                                removeProductFileRef(l._uid, entryId.slice(3))
                                addLineFiles(l._uid, [file])
                                return
                              }
                              replaceLineFile(l._uid, Number(entryId), file)
                            }}
                            onRemove={(entryId) => {
                              if (entryId.startsWith('pf-')) removeProductFileRef(l._uid, entryId.slice(3))
                              else removeLineFile(l._uid, Number(entryId))
                            }}
                            onPickFromCard={() => setLabelPickerLine(l)}
                          />
                        </td>
                        <td>
                          <button className="btn ghost icon sm" onClick={() => removeLine(l._uid)}>
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
          <RailPanel status="draft" cargoType={cargoType} taskKind={taskKind} />
          <Panel icon="chart" title="Итого">
            <div style={{ padding: '0 2px' }}>
              <ReadRow label="SKU" mono>{lines.length}</ReadRow>
              <ReadRow label="Кол-во" mono strong>{totalQty} шт</ReadRow>
              <ReadRow label="Дата (план)" mono>{shipDate ? fmtYmdAsDmy(shipDate) : '—'}</ReadRow>
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
          onAddMany={addManyFromBalance}
          onClose={() => setShowPicker(false)}
        />
      )}

      {skuLine && (
        <AssignSkuDrawer
          productName={skuLine.product_name}
          variantLabel={[skuLine.color_name, skuLine.size_name].filter(Boolean).join(' · ') || null}
          currentSku={skuLine.sku_pending ? null : skuLine.product_sku}
          onSubmit={(skuBase) => handleAssignSku(skuLine, skuBase)}
          onClose={() => setSkuLine(null)}
        />
      )}

      <DraftFilePreviewModal
        preview={filePreview}
        onClose={() => setFilePreview(null)}
      />

      {labelPickerLine && (
        <ProductLabelPickerModal
          productId={labelPickerLine.product_id}
          productName={labelPickerLine.product_name}
          lineColorId={labelPickerLine.color_id ?? null}
          lineSizeId={labelPickerLine.size_id ?? null}
          excludeUrls={labelPickerLine.productFiles.map((f) => f.url)}
          onPick={(f) => { addProductFileRef(labelPickerLine._uid, f); setLabelPickerLine(null) }}
          onClose={() => setLabelPickerLine(null)}
        />
      )}

      <DuplicateWarnModal
        open={dupMatches.length > 0}
        matches={dupMatches}
        entityAccusative="задачу упаковки"
        busy={saving}
        onOpenExisting={(id) => navigate(`/inventory/shipments/${id}`)}
        onProceed={() => { setDupMatches([]); void runCreate(pendingPackingRef.current) }}
        onCancel={() => setDupMatches([])}
      />
    </div>
  )
}

/** Обёртка общей модалки: локальные файлы — через object URL + revoke, этикетки из
 * карточки товара — по серверному url. */
function DraftFilePreviewModal({ preview, onClose }: {
  preview: DraftLineFilePreview | null
  onClose: () => void
}) {
  const file = preview?.file ?? null
  const objectUrl = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file])
  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }, [objectUrl])

  return (
    <FilePreviewModal
      filename={file ? file.name : preview?.filename ?? null}
      mimeType={file ? (file.type || null) : preview?.mimeType ?? null}
      url={file ? objectUrl : preview?.url ?? ''}
      meta={preview}
      onClose={onClose}
    />
  )
}
