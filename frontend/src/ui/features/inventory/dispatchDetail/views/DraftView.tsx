import { useEffect, useRef, useState } from 'react'
import type { DispatchCargoType, DispatchDetail, DispatchLine } from '../../../../../api/dispatchApi'
import { recommendedPallets, recommendedBoxes, getDispatchReservations } from '../../../../../api/dispatchApi'
import type { PlannableItem } from '../../../../../api/balancesApi'
import { getPlannableItems } from '../../../../../api/balancesApi'
import { getInventoryClientStores } from '../../../../../api/inventoryLookupsApi'
import type { ClientStoreItem } from '../../../../../api/domainTypes'
import { updateProduct } from '../../../../../api/adminApi'
import { Combobox } from '../../../../data/Combobox'
import type { ComboboxOption } from '../../../../data/Combobox'
import { Icon } from '../../../../primitives/Icon'
import { AutoGrowTextarea, Field } from '../../../../primitives/Input'
import { DatePicker } from '../../../../primitives/DatePicker'
import { EmptyState } from '../../../../primitives/EmptyState'
import { PhaseBlock } from '../../../shared/process/PhaseBlock'
import { ProductLink } from '../../../shared/ProductLink'
import { Panel, ReadRow, RailPanel, LockedGrid } from '../components/processUI'
import { BalancePicker } from '../../shared/BalancePicker'
import { AssignSkuDrawer } from '../../shared/AssignSkuDrawer'
import { NumberStep } from '../../shared/NumberStep'
import { LineFilesCell } from '../../shipmentDetail/components/LineFilesCell'
import { FilePreviewModal } from '../../shipmentDetail/components/FilePreviewModal'
import type { FilePreviewMeta } from '../../shipmentDetail/shared/types'
import { dispatchFileGlyph, DISPATCH_FILE_ACCEPT } from '../components/DispatchLineFiles'
import { PackMultiplicity } from '../components/PackMultiplicity'
import { PackPriceBanner } from '../components/PackPriceBanner'
import { resolvePublicUploadSrc } from '../../../../../api/constants'
import { AvailabilityCell } from '../../shared/AvailabilityCell'
import type { LineAvailability } from '../../shared/AvailabilityCell'
import { fmtYmdAsDmy } from '../../../../../utils/format'
import { canViewCosts } from '../../../../../utils/access'
import { useCurrentUser } from '../../../../../hooks/useCurrentUser'
import { useToast } from '../../../../feedback/Toast'

type LineDraft = { qty: number; pallets: number | null; palletsTouched: boolean; boxes: number | null; boxesTouched: boolean; siteUrl: string; storeId: string; storeName: string | null }

type Props = {
  doc: DispatchDetail
  canEdit: boolean
  acting: boolean
  onAddLine: (item: PlannableItem, qty: number) => Promise<void>
  onUpdateLine: (lineId: string, body: { qty?: number; pallets_qty?: number | null; boxes_qty?: number | null; site_url?: string | null; store_id?: string | null; store_name?: string | null }) => Promise<boolean>
  onDeleteLine: (lineId: string) => Promise<void>
  onUploadFile: (lineId: string, file: File) => Promise<boolean>
  onDeleteFile: (lineId: string, fileId: string) => Promise<boolean>
  onUpdateDoc: (body: { client_id?: string | null; client_name?: string | null; ship_date?: string | null; logistics_cost?: number | null; comment?: string | null }) => Promise<boolean>
  onReload: () => Promise<void>
  registerInfoFlush?: (fn: (() => Promise<boolean>) | null) => void
  registerLinesFlush?: (fn: (() => Promise<boolean>) | null) => void
  onDirtyChange?: (dirty: boolean) => void
}

function variantKey(productId: string, colorId: string | null, sizeId: string | null): string {
  return `${productId}|${colorId ?? ''}|${sizeId ?? ''}`
}

function draftFromLine(line: DispatchLine): LineDraft {
  return {
    qty:            line.qty,
    pallets:        line.pallets_qty,
    palletsTouched: false,
    boxes:          line.boxes_qty,
    boxesTouched:   false,
    siteUrl:        line.site_url ?? '',
    storeId:        line.store_id ?? '',
    storeName:      line.store_name ?? null,
  }
}

export function DraftView({ doc, canEdit, acting, onAddLine, onUpdateLine, onDeleteLine, onUploadFile, onDeleteFile, onUpdateDoc, onReload, registerInfoFlush, registerLinesFlush, onDirtyChange }: Props) {
  const { user } = useCurrentUser()
  const toast = useToast()
  const showCosts = canViewCosts(user)
  const isDefectCargo = doc.cargo_type === 'defect'

  const [showPicker, setShowPicker] = useState(false)
  const [skuLine, setSkuLine] = useState<DispatchLine | null>(null)
  const [clientStores, setClientStores] = useState<ClientStoreItem[]>([])
  const [uploadingLine, setUploadingLine] = useState<string | null>(null)
  const [filePreview, setFilePreview] = useState<{ filename: string; mimeType: string | null; url: string; meta: FilePreviewMeta } | null>(null)
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({})
  const [availMap, setAvailMap] = useState<Record<string, LineAvailability> | null>(null)

  async function handleUploadFiles(lineId: string, files: File[]) {
    setUploadingLine(lineId)
    try {
      for (const file of files) {
        const ok = await onUploadFile(lineId, file)
        if (!ok) break
      }
    } finally {
      setUploadingLine(null)
    }
  }

  // Замена = загрузка нового + удаление старого (отдельного эндпоинта нет, как в упаковке).
  async function handleReplaceFile(lineId: string, oldFileId: string, file: File) {
    setUploadingLine(lineId)
    try {
      const ok = await onUploadFile(lineId, file)
      if (ok) await onDeleteFile(lineId, oldFileId)
    } finally {
      setUploadingLine(null)
    }
  }

  const [shipDate, setShipDate] = useState(doc.ship_date ?? '')
  const [logisticsCost, setLogisticsCost] = useState(doc.logistics_cost != null ? String(doc.logistics_cost) : '')
  const [comment, setComment] = useState(doc.comment ?? '')
  const [infoDirty, setInfoDirty] = useState(false)

  // Не затираем несохранённые правки «Основной информации» при перезагрузке doc
  // (например, после сохранения строки товара) — синхронизируемся только когда нет dirty.
  useEffect(() => {
    if (infoDirty) return
    setShipDate(doc.ship_date ?? '')
    setLogisticsCost(doc.logistics_cost != null ? String(doc.logistics_cost) : '')
    setComment(doc.comment ?? '')
  }, [doc, infoDirty])

  useEffect(() => {
    setDrafts((prev) => {
      const next: Record<string, LineDraft> = {}
      for (const line of doc.lines) next[line.id] = prev[line.id] ?? draftFromLine(line)
      return next
    })
  }, [doc])

  useEffect(() => {
    if (!doc.client_id) { setClientStores([]); return }
    const ctrl = new AbortController()
    getInventoryClientStores(doc.client_id, ctrl.signal)
      .then(setClientStores)
      .catch(() => setClientStores([]))
    return () => ctrl.abort()
  }, [doc.client_id])

  // Доступность по строкам = тот же расчёт, что и в окне подбора (BalancePicker):
  // свободно = упаковано(ready+packed) − резерв для годного, брак на хранении − резерв
  // для брака. Черновик не входит в резерв (его держат только preparing+), поэтому
  // свободное здесь совпадает с серверным гейтом и не двоит собственную строку.
  useEffect(() => {
    if (!doc.client_id) { setAvailMap(null); return }
    const ctrl = new AbortController()
    const isDefect = doc.cargo_type === 'defect'
    // Брак и годный без упаковки берут только со хранения (упаковка/в пути — не источник).
    const bypassPacking = isDefect || doc.cargo_type === 'good_unpacked'
    Promise.all([
      getPlannableItems({ client_id: doc.client_id, cargo_type: doc.cargo_type, limit: 200 }, ctrl.signal),
      getDispatchReservations({ client_id: doc.client_id, cargo_type: doc.cargo_type }, ctrl.signal)
        .then((r) => r.items).catch(() => []),
    ])
      .then(([res, reservations]) => {
        if (ctrl.signal.aborted) return
        const reserved: Record<string, number> = {}
        for (const rv of reservations) reserved[variantKey(rv.product_id, rv.color_id, rv.size_id)] = rv.reserved
        const map: Record<string, LineAvailability> = {}
        for (const b of res.items) {
          const k = variantKey(b.product_id, b.color_id, b.size_id)
          const ready = bypassPacking ? 0 : b.ready_good + (b.packed_good ?? 0)
          const storage = isDefect ? b.storage_defect : b.storage_good
          const packing = bypassPacking ? 0 : (b.packing_good ?? 0)
          const inTransit = bypassPacking ? 0 : b.in_transit
          const primaryRaw = bypassPacking ? storage : ready
          const rv = reserved[k] ?? 0
          map[k] = { free: Math.max(0, primaryRaw - rv), ready, reserved: rv, storage, packing, inTransit, isDefect }
        }
        setAvailMap(map)
      })
      .catch(() => { if (!ctrl.signal.aborted) setAvailMap(null) })
    return () => ctrl.abort()
  }, [doc.client_id, doc.cargo_type])

  const storeOptions: ComboboxOption[] = clientStores.map((s) => ({ value: s.id, label: s.name }))

  function getDraft(line: DispatchLine): LineDraft {
    return drafts[line.id] ?? draftFromLine(line)
  }

  function setDraft(lineId: string, patch: Partial<LineDraft>) {
    setDrafts((prev) => ({ ...prev, [lineId]: { ...(prev[lineId] ?? { qty: 1, pallets: null, palletsTouched: false, boxes: null, boxesTouched: false, siteUrl: '', storeId: '', storeName: null }), ...patch } }))
  }

  function setLineQty(line: DispatchLine, qty: number) {
    const d = getDraft(line)
    const nextQty = Math.max(1, qty)
    // Пока короба/палеты не правили вручную — держим рекомендацию из кратности товара.
    // Цепочка: короба из штук, палеты из коробов (палета меряется в коробах).
    const boxes = d.boxesTouched ? d.boxes : (recommendedBoxes(nextQty, line.items_per_box) ?? d.boxes)
    const pallets = d.palletsTouched ? d.pallets : (recommendedPallets(boxes, line.boxes_per_pallet) ?? d.pallets)
    setDraft(line.id, { qty: nextQty, boxes, pallets })
  }

  function setLineBoxes(line: DispatchLine, value: number | null) {
    const d = getDraft(line)
    // Палеты меряются в коробах — при ручной правке коробов освежаем рекомендацию палет.
    const pallets = d.palletsTouched ? d.pallets : (recommendedPallets(value, line.boxes_per_pallet) ?? d.pallets)
    setDraft(line.id, { boxes: value, boxesTouched: true, pallets })
  }

  function lineDirty(line: DispatchLine): boolean {
    const d = getDraft(line)
    return d.qty !== line.qty
      || (d.pallets ?? null) !== (line.pallets_qty ?? null)
      || (d.boxes ?? null) !== (line.boxes_qty ?? null)
      || d.siteUrl !== (line.site_url ?? '')
      || d.storeId !== (line.store_id ?? '')
      || d.storeName !== (line.store_name ?? null)
  }

  // Сохранить все несохранённые правки состава (короба/палеты/кол-во/ТЗ строки) без
  // ручного нажатия «дискеты»: «Передать в подготовку» коммитит их автоматически.
  async function flushDirtyLines(): Promise<boolean> {
    for (const line of doc.lines) {
      if (!lineDirty(line)) continue
      const d = getDraft(line)
      const ok = await onUpdateLine(line.id, {
        qty:         d.qty,
        pallets_qty: d.pallets,
        boxes_qty:   d.boxes,
        site_url:    d.siteUrl.trim() || null,
        store_id:    d.storeId || null,
        store_name:  d.storeId ? d.storeName : null,
      })
      if (!ok) return false
    }
    return true
  }

  async function handleInfoSave(): Promise<boolean> {
    const costNum = Number(logisticsCost)
    const costFilled = logisticsCost.trim() !== '' && Number.isFinite(costNum) && costNum >= 0
    const ok = await onUpdateDoc({
      ship_date: shipDate || null,
      comment: comment.trim() || null,
      ...(showCosts ? { logistics_cost: costFilled ? costNum : null } : {}),
    })
    if (ok) setInfoDirty(false)
    return ok
  }

  // Пробрасываем сохранение «Основной информации» наверх: «Передать в подготовку»
  // сначала закоммитит незакоммиченные правки (в т.ч. ТЗ), иначе бэк отклонит переход.
  // Стабильная обёртка над ref — регистрируем один раз, а не на каждый рендер.
  const infoFlushRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true))
  infoFlushRef.current = () => (infoDirty ? handleInfoSave() : Promise.resolve(true))
  useEffect(() => {
    if (!registerInfoFlush) return
    registerInfoFlush(() => infoFlushRef.current())
    return () => registerInfoFlush(null)
  }, [registerInfoFlush])

  // Аналогично — правки состава коммитятся при «Передать в подготовку».
  const linesFlushRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true))
  linesFlushRef.current = flushDirtyLines
  useEffect(() => {
    if (!registerLinesFlush) return
    registerLinesFlush(() => linesFlushRef.current())
    return () => registerLinesFlush(null)
  }, [registerLinesFlush])

  // Сообщаем наверх, есть ли несохранённые правки плана — кнопка «Сохранить» в шапке
  // появляется только когда действительно есть что сохранять.
  const planDirty = infoDirty || doc.lines.some((l) => lineDirty(l))
  useEffect(() => {
    onDirtyChange?.(planDirty)
    return () => onDirtyChange?.(false)
  }, [planDirty, onDirtyChange])

  async function handleAssignSku(line: DispatchLine, skuBase: string) {
    await updateProduct(line.product_id, { sku_base: skuBase })
    await onReload()
  }

  async function saveMultiplicity(line: DispatchLine, patch: { items_per_box?: number | null; boxes_per_pallet?: number | null }): Promise<boolean> {
    try {
      await updateProduct(line.product_id, patch)
      await onReload()
      toast('Кратность сохранена', 'success')
      return true
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
      return false
    }
  }

  const totalQty = doc.lines.reduce((s, l) => s + l.qty, 0)
  const totalPallets = doc.lines.reduce((s, l) => s + (getDraft(l).pallets ?? 0), 0)
  const totalBoxes = doc.lines.reduce((s, l) => s + (getDraft(l).boxes ?? 0), 0)
  // Цену подсказываем, пока единица «релевантна»: не задана (null) либо >0. Прячем только
  // когда во всех строках явный 0 — иначе подсказка пропадала при пустых полях (нет кратности).
  const needBoxPrice = doc.lines.some((l) => (getDraft(l).boxes ?? 1) > 0)
  const needPalletPrice = doc.lines.some((l) => (getDraft(l).pallets ?? 1) > 0)
  const skuCount = new Set(doc.lines.map((l) => l.product_sku)).size
  const hasPendingSku = doc.lines.some((l) => l.sku_pending)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 332px', gap: 18, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

        <PhaseBlock
          icon="file"
          title="Основная информация"
          role="manager"
          state="active"
          hint={canEdit ? 'План можно править до передачи в подготовку' : undefined}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Клиент" style={{ marginBottom: 0 }}>
              <input className="input" value={doc.client_name ?? '—'} readOnly style={{ cursor: 'default' }} />
            </Field>
            <Field label="Дата отгрузки (план)" required style={{ marginBottom: 0 }}>
              {canEdit ? (
                <DatePicker value={shipDate} onChange={(v) => { setShipDate(v); setInfoDirty(true) }} />
              ) : (
                <input className="input" value={fmtYmdAsDmy(doc.ship_date)} readOnly style={{ cursor: 'default' }} />
              )}
            </Field>
            {showCosts && (
              <Field label="Стоимость логистики для клиента, ₽" required style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                {canEdit ? (
                  <input
                    className="input"
                    type="number"
                    min={0}
                    step={0.01}
                    value={logisticsCost}
                    onChange={(e) => { setLogisticsCost(e.target.value); setInfoDirty(true) }}
                    placeholder="0.00"
                  />
                ) : (
                  <input className="input" value={doc.logistics_cost != null ? doc.logistics_cost.toLocaleString('ru-RU') : '—'} readOnly style={{ cursor: 'default' }} />
                )}
              </Field>
            )}
            <Field label="Техническое задание" required style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
              {canEdit ? (
                <AutoGrowTextarea
                  minRows={3}
                  placeholder="Опишите задачу для команды склада"
                  value={comment}
                  onChange={(e) => { setComment(e.target.value); setInfoDirty(true) }}
                  style={{ resize: 'vertical', minHeight: 76 }}
                />
              ) : (
                <div className="input" style={{ minHeight: 76, whiteSpace: 'pre-wrap', cursor: 'default' }}>{doc.comment || '—'}</div>
              )}
            </Field>
          </div>
        </PhaseBlock>

        {showCosts && canEdit && doc.client_id && (needBoxPrice || needPalletPrice) && (
          <PackPriceBanner
            clientId={doc.client_id}
            needBoxPrice={needBoxPrice}
            needPalletPrice={needPalletPrice}
          />
        )}

        <PhaseBlock
          icon="boxes"
          title="Состав отгрузки"
          role="manager"
          state="active"
          hint="Товар на остатках и в пути"
          right={canEdit ? (
            <button className="btn sm primary" onClick={() => setShowPicker(true)} disabled={acting || !doc.client_id}>
              <Icon name="plus" size={12} />Добавить товар
            </button>
          ) : undefined}
        >
          {doc.lines.length === 0 ? (
            <div style={{ padding: '32px 0' }}>
              <EmptyState title="Состав пуст" sub={canEdit ? 'Добавьте товар — остатки и товар в пути' : 'Нет позиций'} />
            </div>
          ) : (
            <table className="t">
              <thead>
                <tr>
                  <th style={{ width: 32 }} />
                  <th>Товар · вариант</th>
                  <th style={{ width: 130 }}>Магазин</th>
                  <th style={{ width: 220 }}>Ссылка и файлы</th>
                  <th style={{ textAlign: 'right', width: 130 }}>План</th>
                  <th style={{ textAlign: 'right', width: 150 }}>Упаковка</th>
                  <th style={{ width: 64 }} />
                </tr>
              </thead>
              <tbody>
                {doc.lines.map((l) => {
                  const d = getDraft(l)
                  const dirty = lineDirty(l)
                  return (
                    <tr key={l.id}>
                      <td>
                        <div style={{ width: 26, height: 26, borderRadius: 4, background: 'var(--c-bg-sunken)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Icon name="box" size={12} style={{ color: 'var(--c-text-muted)' }} />
                        </div>
                      </td>
                      <td>
                        <div style={{ fontWeight: 500, fontSize: 13 }}><ProductLink productId={l.product_id}>{l.product_name}</ProductLink></div>
                        <div className="t-sub mono">{[l.product_sku, l.color_name, l.size_name].filter(Boolean).join(' · ')}</div>
                        {l.sku_pending && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                            <span className="badge warning">Без SKU</span>
                            {canEdit && (
                              <button className="btn ghost sm" onClick={() => setSkuLine(l)}>
                                <Icon name="edit" size={12} />Указать SKU
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="store-cell-combobox">
                          <Combobox
                            value={d.storeId || null}
                            placeholder="Без магазина"
                            options={storeOptions}
                            disabled={!canEdit}
                            onChange={(v, opt) => setDraft(l.id, { storeId: String(v ?? ''), storeName: opt?.label ?? null })}
                            clearable
                          />
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <input
                            className="input"
                            placeholder="https://…"
                            value={d.siteUrl}
                            readOnly={!canEdit}
                            onChange={(e) => setDraft(l.id, { siteUrl: e.target.value })}
                            style={{ width: '100%' }}
                          />
                          <LineFilesCell
                            entries={l.files.map((f) => ({ id: f.id, filename: f.filename, mimeType: f.mime_type, href: resolvePublicUploadSrc(f.url) }))}
                            canEdit={canEdit}
                            uploading={uploadingLine === l.id}
                            accept={DISPATCH_FILE_ACCEPT}
                            glyphFor={dispatchFileGlyph}
                            onPreview={(entry) => { if (entry.href) setFilePreview({
                              filename: entry.filename,
                              mimeType: entry.mimeType,
                              url: entry.href,
                              meta: { productName: l.product_name, sku: l.product_sku, colorName: l.color_name, sizeName: l.size_name, qty: l.qty },
                            }) }}
                            onAdd={(files) => void handleUploadFiles(l.id, files)}
                            onReplace={(fileId, file) => void handleReplaceFile(l.id, fileId, file)}
                            onRemove={(fileId) => void onDeleteFile(l.id, fileId)}
                          />
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <NumberStep
                            value={d.qty}
                            disabled={!canEdit}
                            tone={dirty ? 'accent' : 'normal'}
                            onChange={(v) => setLineQty(l, v)}
                          />
                        </div>
                        <AvailabilityCell
                          avail={availMap
                            ? (availMap[variantKey(l.product_id, l.color_id, l.size_id)]
                               ?? { free: 0, ready: 0, reserved: 0, storage: 0, packing: 0, inTransit: 0, isDefect: isDefectCargo })
                            : null}
                          plannedQty={d.qty}
                          loading={availMap === null}
                        />
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 11, color: 'var(--c-text-muted)', width: 42, textAlign: 'right' }}>Короба</span>
                            <input
                              className="input sm num"
                              inputMode="numeric"
                              placeholder="0"
                              aria-label="Количество коробов"
                              readOnly={!canEdit}
                              value={d.boxes != null ? String(d.boxes) : ''}
                              onChange={(e) => {
                                const raw = e.target.value.replace(/\D/g, '')
                                setLineBoxes(l, raw === '' ? null : Math.max(0, parseInt(raw, 10)))
                              }}
                              style={{ width: 56, textAlign: 'right', borderColor: d.boxes == null ? 'var(--c-warning)' : undefined }}
                            />
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 11, color: 'var(--c-text-muted)', width: 42, textAlign: 'right' }}>Палеты</span>
                            <input
                              className="input sm num"
                              inputMode="numeric"
                              placeholder="0"
                              aria-label="Количество палет"
                              readOnly={!canEdit}
                              value={d.pallets != null ? String(d.pallets) : ''}
                              onChange={(e) => {
                                const raw = e.target.value.replace(/\D/g, '')
                                setDraft(l.id, { pallets: raw === '' ? null : Math.max(0, parseInt(raw, 10)), palletsTouched: true })
                              }}
                              style={{ width: 56, textAlign: 'right', borderColor: d.pallets == null ? 'var(--c-warning)' : undefined }}
                            />
                          </div>
                        </div>
                        <PackMultiplicity
                          productName={l.product_name}
                          itemsPerBox={l.items_per_box}
                          boxesPerPallet={l.boxes_per_pallet}
                          qty={d.qty}
                          pallets={d.pallets}
                          boxes={d.boxes}
                          palletsTouched={d.palletsTouched}
                          boxesTouched={d.boxesTouched}
                          canEdit={canEdit}
                          onSaveProduct={(patch) => saveMultiplicity(l, patch)}
                        />
                      </td>
                      <td>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
                          {canEdit && (
                            <button className="btn ghost icon sm" disabled={acting} onClick={() => void onDeleteLine(l.id)}>
                              <Icon name="trash" size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--c-bg-sunken)' }}>
                  <td colSpan={4} style={{ padding: '10px 12px', fontWeight: 500, fontSize: 12.5 }}>
                    Итого: {skuCount} SKU
                  </td>
                  <td className="num" style={{ padding: '10px 12px', fontWeight: 600, fontSize: 14 }}>{totalQty}</td>
                  <td className="num" style={{ padding: '10px 12px', fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' }}>{totalPallets} пал · {totalBoxes} кор</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
        </PhaseBlock>

        <PhaseBlock icon="truckOut" title="Рейс и отгрузка" role="manager" state="locked"
          hint="Привязка к рейсу и списание — после подготовки кладовщиком">
          <LockedGrid labels={['Рейсы', 'Отгружено']} />
        </PhaseBlock>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <RailPanel status={doc.status} ops={doc.ops} cargoType={doc.cargo_type as DispatchCargoType} />
        <Panel icon="chart" title="Итого">
          <div style={{ padding: '0 2px' }}>
            <ReadRow label="SKU" mono>{skuCount}</ReadRow>
            <ReadRow label="Кол-во" mono strong>{totalQty} шт</ReadRow>
            <ReadRow label="Коробов" mono strong>{totalBoxes}</ReadRow>
            <ReadRow label="Палет" mono strong>{totalPallets}</ReadRow>
            {showCosts && (
              <ReadRow label="Логистика" mono>{doc.logistics_cost != null ? `${doc.logistics_cost.toLocaleString('ru-RU')} ₽` : '—'}</ReadRow>
            )}
            {hasPendingSku && (
              <div style={{ marginTop: 8 }}>
                <span className="badge warning">Есть товары без SKU</span>
              </div>
            )}
          </div>
        </Panel>
      </div>

      {showPicker && (
        <BalancePicker
          clientId={doc.client_id}
          cargoType={doc.cargo_type as DispatchCargoType}
          source="dispatch"
          onAdd={(item, qty) => { void onAddLine(item, qty); setShowPicker(false) }}
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

      <FilePreviewModal
        filename={filePreview?.filename ?? null}
        mimeType={filePreview?.mimeType ?? null}
        url={filePreview?.url ?? ''}
        meta={filePreview?.meta ?? null}
        onClose={() => setFilePreview(null)}
      />
    </div>
  )
}
