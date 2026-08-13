import type { ShipmentLine } from '../../../../../api/shipmentsApi'
import { PhaseBlock } from '../../../shared/process/PhaseBlock'
import { Icon } from '../../../../primitives/Icon'
import { EmptyState } from '../../../../primitives/EmptyState'
import { CompositionTable } from './CompositionTable'
import type { LineAvailability } from '../../shared/AvailabilityCell'
import type { EditableShipmentLine, LineDraft, StoreChoice, LineFilePreview } from '../shared/types'

export type CompositionPhaseProps = {
  lines: EditableShipmentLine[]
  clientId: string | null
  state: 'active' | 'done'
  hint?: string
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
  getAvail?: (line: ShipmentLine) => LineAvailability
  availLoading: boolean
}

export function CompositionPhase({
  lines, clientId, state, hint, canEditPlan, canEditStore, canDelete, canAttachFiles,
  acting, saving, savingLine, uploadingLines, getDraft, getStoreOptions,
  onAdd, onPreviewFile, onQty, onStore, onDelete,
  onUploadFile, onReplaceFile, onDeleteFile, onPickLabel, onAssignSku, getAvail, availLoading,
}: CompositionPhaseProps) {
  return (
    <PhaseBlock
      icon="boxes"
      title="Состав упаковки"
      role="manager"
      state={state}
      hint={hint}
      right={canDelete ? (
        <button className="btn sm primary" onClick={onAdd} disabled={acting || !clientId}>
          <Icon name="plus" size={12} />Добавить товар
        </button>
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
          getAvail={getAvail}
          availLoading={availLoading}
        />
      )}
    </PhaseBlock>
  )
}
