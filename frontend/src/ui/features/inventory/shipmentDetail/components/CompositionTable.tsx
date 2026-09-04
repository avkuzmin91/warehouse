import type { ShipmentLine, ShipmentLineFile } from '../../../../../api/shipmentsApi'
import { resolvePublicUploadSrc } from '../../../../../api/constants'
import { Icon } from '../../../../primitives/Icon'
import { Table, Td } from '../../../../data/Table'
import { Combobox } from '../../../../data/Combobox'
import type { ComboboxOption } from '../../../../data/Combobox'
import { NumberStep } from '../../shared/NumberStep'
import { LineIdentityCell } from '../../shared/LineIdentityCell'
import { AvailabilityCell } from '../../shared/AvailabilityCell'
import type { LineAvailability } from '../../shared/AvailabilityCell'
import { LineFilesCell } from './LineFilesCell'
import type { EditableShipmentLine, LineDraft, StoreChoice, LineFilePreview } from '../shared/types'

// Подпись под файлом — распознанные коды; помечается только конфликт (чужой
// товар / другой цвето-размер), непривязанность кода не подписывается.
function fileBarcodeCaption(f: ShipmentLineFile): string | undefined {
  const details = f.barcode_details ?? []
  if (details.length === 0) {
    return (f.barcodes ?? []).length > 0 ? `ШК ${f.barcodes.join(', ')}` : undefined
  }
  return details
    .map((b) => b.status === 'confirmed' || b.status === 'unknown'
      ? `ШК ${b.code}`
      : `ШК ${b.code} — конфликт`)
    .join(' · ')
}

// Конфликтная подпись — красная: чужая этикетка в составе иначе теряется в мелком тексте.
function fileBarcodeTone(f: ShipmentLineFile): 'danger' | undefined {
  return (f.barcode_details ?? []).some((b) => b.status === 'other_variant' || b.status === 'other_product')
    ? 'danger'
    : undefined
}

export function StoreCell({
  value,
  stores,
  onChange,
  disabled,
  readonly,
  readonlyLabel,
}: {
  value: string
  stores: StoreChoice[]
  onChange: (storeId: string) => void
  disabled?: boolean
  readonly?: boolean
  readonlyLabel?: string | null
}) {
  if (readonly) return <span className="t-sub">{readonlyLabel || '—'}</span>
  return (
    <div className="store-cell-combobox">
      <Combobox
        value={value || null}
        placeholder="Без магазина"
        options={stores.map((store): ComboboxOption => ({ value: store.id, label: store.name }))}
        onChange={(v) => onChange(String(v ?? ''))}
        disabled={disabled}
        clearable
      />
    </div>
  )
}

type CompositionTableProps = {
  lines:           EditableShipmentLine[]
  // Брак-отгрузка: показываем местоположение-источник строки (брак списывается с него).
  showZone?:       boolean
  canEditPlan:     boolean
  // Магазин строки может быть редактируемым отдельно от плана (корректировка «На упаковке»).
  canEditStore?:   boolean
  canDelete:       boolean
  canAttachFiles:  boolean
  acting:          boolean
  saving:          Record<string, boolean>
  savingLine:      string | null
  uploadingLines:  Record<string, boolean>
  getDraft:        (line: ShipmentLine) => LineDraft
  getStoreOptions: (line: ShipmentLine) => StoreChoice[]
  onPreviewFile:   (preview: LineFilePreview) => void
  onQty:           (lineId: string, v: number) => void
  onStore:         (lineId: string, storeId: string, storeName: string | null) => void
  onDelete:        (lineId: string) => void
  onUploadFile:    (lineId: string, files: File[]) => void
  onReplaceFile:   (lineId: string, oldFileId: string, file: File) => void
  onDeleteFile:    (lineId: string, fileId: string) => void
  // Этикетка из карточки товара — прикрепление без повторной загрузки файла.
  onPickLabel?:    (line: ShipmentLine) => void
  // Дозаполнение SKU для товара «ожидает SKU» прямо из состава отгрузки.
  onAssignSku?:    (line: ShipmentLine) => void
  // Доступность строки под планом: «на хранении» + «в пути» (только при правке плана).
  getAvail?:       (line: ShipmentLine) => LineAvailability | null
  availLoading?:   boolean
}

/** Состав упаковки — только план: товар · магазин · план · файлы. Владелец — Менеджер. */
export function CompositionTable({
  lines, showZone = false, canEditPlan, canEditStore, canDelete, canAttachFiles,
  acting, saving, savingLine, uploadingLines, getDraft, getStoreOptions,
  onPreviewFile, onQty, onStore, onDelete, onUploadFile, onReplaceFile, onDeleteFile, onPickLabel, onAssignSku,
  getAvail, availLoading,
}: CompositionTableProps) {
  const skuCount = new Set(lines.map((l) => l.product_sku)).size
  const planTotal = lines.reduce((s, l) => s + getDraft(l).qty, 0)

  return (
    <Table>
      <thead>
        <tr>
          <th style={{ width: 32 }} />
          <th>Товар · вариант</th>
          {showZone && <th style={{ width: 170 }}>Местоположение</th>}
          <th style={{ width: 180 }}>Магазин</th>
          <th style={{ width: 160, textAlign: 'right' }}>План упаковки</th>
          <th style={{ width: 124, textAlign: 'center' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--c-text-subtle)' }}>
              <Icon name="paperclip" size={12} style={{ opacity: 0.7 }} />Файлы
            </span>
          </th>
          <th style={{ width: 44 }} />
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => {
          const draft = getDraft(line)
          const storeOptions = getStoreOptions(line)
          const isSaving = saving[line.id] ?? false
          const busy = acting || isSaving || savingLine === line.id
          const planOver = canEditPlan && draft.qty > line.available

          return (
            <tr key={line.id}>
              <Td>
                <div style={{ width: 26, height: 26, borderRadius: 4, background: 'var(--c-bg-sunken)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="box" size={12} style={{ color: 'var(--c-text-muted)' }} />
                </div>
              </Td>
              <Td>
                <LineIdentityCell name={line.product_name} sku={line.product_sku} color={line.color_name} size={line.size_name} productId={line.product_id} />
                {line.sku_pending ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <span className="badge warning">Без SKU</span>
                    {canEditPlan && onAssignSku && (
                      <button className="btn ghost sm" disabled={busy} onClick={() => onAssignSku(line)}>
                        <Icon name="edit" size={12} />Указать SKU
                      </button>
                    )}
                  </div>
                ) : canEditPlan && onAssignSku && (
                  <div style={{ marginTop: 4 }}>
                    <button className="btn ghost sm" disabled={busy} onClick={() => onAssignSku(line)}>
                      <Icon name="edit" size={12} />Изменить SKU
                    </button>
                  </div>
                )}
              </Td>
              {showZone && (
                <Td style={{ fontSize: 13 }}>
                  {line.storage_zone_name ?? <span style={{ color: 'var(--c-warning)' }}>не указано</span>}
                </Td>
              )}
              <Td>
                <StoreCell
                  value={draft.storeId}
                  stores={storeOptions}
                  onChange={(storeId) => {
                    const store = storeOptions.find((item) => item.id === storeId)
                    onStore(line.id, storeId, store?.name ?? null)
                  }}
                  disabled={busy}
                  readonly={!(canEditStore ?? canEditPlan)}
                  readonlyLabel={line.store_name}
                />
                {(line.store_barcodes ?? []).length > 0 && (
                  <div className="mono text-xs subtle" style={{ marginTop: 4 }}>
                    ШК {line.store_barcodes.join(', ')}
                  </div>
                )}
              </Td>
              <Td className="num">
                {canEditPlan ? (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                      <NumberStep value={draft.qty} onChange={(v) => onQty(line.id, v)} disabled={busy} warning={planOver} width={100} />
                    </div>
                    {getAvail && (
                      <AvailabilityCell context="pack" avail={getAvail(line)} plannedQty={draft.qty} loading={availLoading} />
                    )}
                  </>
                ) : (
                  <span className="num" style={{ fontWeight: 500 }}>{line.qty}</span>
                )}
              </Td>
              <Td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                <LineFilesCell
                  entries={(line.files ?? []).map((f) => ({
                    id: f.id,
                    filename: f.filename,
                    mimeType: f.mime_type,
                    href: resolvePublicUploadSrc(f.url),
                    caption: fileBarcodeCaption(f),
                    captionTone: fileBarcodeTone(f),
                  }))}
                  canEdit={canAttachFiles}
                  uploading={uploadingLines[line.id] ?? false}
                  onPreview={(entry) => {
                    const file = (line.files ?? []).find((f) => f.id === entry.id)
                    if (!file) return
                    onPreviewFile({
                      file,
                      productName: line.product_name,
                      sku: line.product_sku,
                      colorName: line.color_name,
                      sizeName: line.size_name,
                      qty: line.qty,
                    })
                  }}
                  onAdd={(files) => onUploadFile(line.id, files)}
                  onReplace={(fileId, file) => onReplaceFile(line.id, fileId, file)}
                  onRemove={(fileId) => onDeleteFile(line.id, fileId)}
                  onPickFromCard={onPickLabel ? () => onPickLabel(line) : undefined}
                />
              </Td>
              <Td>
                {canDelete ? (
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <button className="btn ghost icon sm" disabled={busy} onClick={() => onDelete(line.id)}>
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                ) : null}
              </Td>
            </tr>
          )
        })}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={showZone ? 7 : 6} style={{ padding: 0 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 24, padding: '10px 14px',
              background: 'var(--c-bg-sunken)', borderTop: '1px solid var(--c-border)', fontSize: 12.5,
            }}>
              <span style={{ fontWeight: 700 }}>Итого</span>
              <span style={{ color: 'var(--c-text-subtle)' }}>{skuCount} SKU</span>
              <span style={{ color: 'var(--c-text-subtle)' }}>
                План <b className="num" style={{ color: 'var(--c-text)' }}>{planTotal}</b>
              </span>
            </div>
          </td>
        </tr>
      </tfoot>
    </Table>
  )
}
