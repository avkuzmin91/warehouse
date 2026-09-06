import type { ShipmentLine } from '../../../../../api/shipmentsApi'
import { PhaseBlock } from '../../../shared/process/PhaseBlock'
import { Icon } from '../../../../primitives/Icon'
import { EmptyState } from '../../../../primitives/EmptyState'
import { CompositionTable } from './CompositionTable'
import { useLineBarcodeLabels, usePrintBarcodeLabels } from '../../../shared/usePrintBarcodeLabels'
import type { LineAvailability } from '../../shared/AvailabilityCell'
import type { EditableShipmentLine, LineDraft, StoreChoice, LineFilePreview } from '../shared/types'

export type CompositionPhaseProps = {
  lines: EditableShipmentLine[]
  clientId: string | null
  state: 'active' | 'done'
  hint?: string
  // Задача размещения: тот же состав, но лексика «размещения», а не «упаковки».
  putaway?: boolean
  canEditPlan: boolean
  // Корректировка «На упаковке»: магазин строки правится отдельно от плана.
  canEditStore?: boolean
  canDelete: boolean
  canAttachFiles: boolean
  acting: boolean
  saving: Record<string, boolean>
  savingLine: string | null
  uploadingLines: Record<string, boolean>
  getDraft: (line: ShipmentLine) => LineDraft
  getStoreOptions: (line: ShipmentLine) => StoreChoice[]
  onAdd: () => void
  onPreviewFile: (preview: LineFilePreview) => void
  onQty: (lineId: string, v: number) => void
  onStore: (lineId: string, storeId: string, storeName: string | null) => void
  onDelete: (lineId: string) => void
  onUploadFile: (lineId: string, files: File[]) => void
  onReplaceFile: (lineId: string, oldFileId: string, file: File) => void
  onDeleteFile: (lineId: string, fileId: string) => void
  onPickLabel?: (line: ShipmentLine) => void
  onAssignSku: (line: ShipmentLine) => void
  // Подтягивание ШК из кабинета магазина строки (менеджерское действие).
  onPullStoreBarcodes?: () => void
  getAvail?: (line: ShipmentLine) => LineAvailability
  availLoading: boolean
}

export function CompositionPhase({
  lines, clientId, state, hint, putaway, canEditPlan, canEditStore, canDelete, canAttachFiles,
  acting, saving, savingLine, uploadingLines, getDraft, getStoreOptions,
  onAdd, onPreviewFile, onQty, onStore, onDelete,
  onUploadFile, onReplaceFile, onDeleteFile, onPickLabel, onAssignSku, onPullStoreBarcodes,
  getAvail, availLoading,
}: CompositionPhaseProps) {
  // Печать всей пачки этикеток на задачу: по одной строке печатают редко, а перед
  // упаковкой нужен весь состав разом.
  const { printLabels, printing } = usePrintBarcodeLabels()
  const labelState = useLineBarcodeLabels(lines.map((l) => ({
    product_id: l.product_id, color_id: l.color_id, size_id: l.size_id,
    store_id: l.store_id, barcode: l.label_barcode,
  })))
  // Строки с кодами из разных кабинетов в пачку не идут: печатать «любой из двух»
  // нельзя, а останавливать из-за них весь тираж — дороже, чем пропустить.
  const undecided = lines.filter((l) => labelState(l).kind === 'choose')
  const printable = lines.filter((l) => labelState(l).kind === 'code' && getDraft(l).qty > 0)
  const labelsTotal = printable.reduce((s, l) => s + getDraft(l).qty, 0)

  return (
    <PhaseBlock
      icon="boxes"
      title={putaway ? 'Состав размещения' : 'Состав упаковки'}
      role="manager"
      state={state}
      hint={hint}
      right={(canDelete || onPullStoreBarcodes || lines.length > 0) ? (
        <div className="row gap-8">
          {undecided.length > 0 && onPickLabel && (
            <button
              className="btn sm"
              onClick={() => onPickLabel(undecided[0])}
              title="У этих строк несколько кодов из разных кабинетов — выберите, чем маркировать"
              style={{
                borderColor: 'var(--c-warning)', background: 'var(--c-warning-bg)',
                color: 'var(--c-warning)',
              }}
            >
              <Icon name="alert" size={12} />
              {undecided.length === 1 ? '1 строка без выбора' : `${undecided.length} строк без выбора`}
            </button>
          )}
          {lines.length > 0 && (
            <button
              className="btn sm"
              onClick={() => void printLabels(printable.map((l) => ({
                product_id: l.product_id, color_id: l.color_id, size_id: l.size_id,
                store_id: l.store_id, barcode: l.label_barcode, qty: getDraft(l).qty,
              })))}
              disabled={printing || labelsTotal <= 0}
              title="Этикетки ШК на весь состав — по плану строк"
            >
              <Icon name="print" size={12} />Печать этикеток · {labelsTotal}
            </button>
          )}
          {onPullStoreBarcodes && lines.length > 0 && (
            <button className="btn sm" onClick={onPullStoreBarcodes} disabled={acting}>
              <Icon name="barcode" size={12} />Подтянуть ШК
            </button>
          )}
          {canDelete && (
            <button className="btn sm primary" onClick={onAdd} disabled={acting || !clientId}>
              <Icon name="plus" size={12} />Добавить товар
            </button>
          )}
        </div>
      ) : undefined}
    >
      {lines.length === 0 ? (
        <div style={{ padding: '32px 0' }}>
          <EmptyState
            title="Состав пуст"
            sub={canDelete ? 'Добавьте товар — остатки и товар в пути' : 'Нет позиций'}
          />
        </div>
      ) : (
        <CompositionTable
          lines={lines}
          showZone={false}
          putaway={putaway}
          canEditPlan={canEditPlan}
          canEditStore={canEditStore}
          canDelete={canDelete}
          canAttachFiles={canAttachFiles}
          acting={acting}
          saving={saving}
          savingLine={savingLine}
          uploadingLines={uploadingLines}
          getDraft={getDraft}
          getStoreOptions={getStoreOptions}
          onPreviewFile={onPreviewFile}
          onQty={onQty}
          onStore={onStore}
          onDelete={onDelete}
          onUploadFile={onUploadFile}
          onReplaceFile={onReplaceFile}
          onDeleteFile={onDeleteFile}
          onPickLabel={onPickLabel}
          onAssignSku={onAssignSku}
          labelOf={labelState}
          getAvail={getAvail}
          availLoading={availLoading}
        />
      )}
    </PhaseBlock>
  )
}
