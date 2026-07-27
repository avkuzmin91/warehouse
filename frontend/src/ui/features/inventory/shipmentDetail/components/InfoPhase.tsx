import type { ShipmentDetail } from '../../../../../api/shipmentsApi'
import { PhaseBlock } from '../../../shared/process/PhaseBlock'
import { Icon } from '../../../../primitives/Icon'
import { Tooltip } from '../../../../primitives/Tooltip'
import { DatePicker } from '../../../../primitives/DatePicker'
import { AutoGrowTextarea, Field, Input } from '../../../../primitives/Input'
import { ReadOnlyField } from '../../shared/ReadOnlyField'
import { fmtDateLong } from '../../../../../utils/format'

export type InfoPhaseProps = {
  doc: ShipmentDetail
  isDraft: boolean
  isDefectCargo: boolean
  canEditInfo: boolean
  canEditTechTaskOnly: boolean
  // «На упаковке» менеджер корректирует только ТЗ и дату (план) — реквизиты read-only.
  canCorrectOnPacking?: boolean
  canEditActualShipDate: boolean
  saved: boolean
  shipDate: string
  actualShipDate: string
  comment: string
  onShipDate: (v: string) => void
  onActualShipDate: (v: string) => void
  onComment: (v: string) => void
}

export function InfoPhase({
  doc, isDraft, isDefectCargo, canEditInfo, canEditTechTaskOnly, canCorrectOnPacking,
  canEditActualShipDate, saved, shipDate, actualShipDate, comment, onShipDate, onActualShipDate, onComment,
}: InfoPhaseProps) {
  const editable = canEditInfo || canCorrectOnPacking
  return (
    <PhaseBlock
      icon="file"
      title="Основная информация"
      role="manager"
      state={isDraft ? 'active' : 'done'}
      hint={canCorrectOnPacking ? 'Корректировка: ТЗ и дату (план) можно изменить — фиксируется в журнале'
        : canEditInfo ? 'План можно править до передачи на упаковку'
        : canEditTechTaskOnly ? 'Можно поправить техническое задание перед принятием задачи'
        : undefined}
      right={(editable || canEditTechTaskOnly) && saved ? (
        <span style={{ fontSize: 12, color: 'var(--c-success)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Icon name="check" size={12} />Сохранено
        </span>
      ) : undefined}
    >
      {editable ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Клиент" style={{ marginBottom: 0 }}>
              <div style={{ position: 'relative' }}>
                <Input
                  value={doc.client_name ?? '—'}
                  readOnly
                  style={{ paddingRight: 34, cursor: 'default' }}
                />
                <div style={{
                  position: 'absolute',
                  right: 9,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--c-text-subtle)',
                  display: 'inline-flex',
                  alignItems: 'center',
                }}>
                  <Tooltip content="Клиент нельзя изменить после добавления товаров">
                    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                      <Icon name="lock" size={13} />
                    </span>
                  </Tooltip>
                </div>
              </div>
            </Field>
            <Field label="Дата упаковки (план)" required style={{ marginBottom: 0 }}>
              <DatePicker value={shipDate} onChange={onShipDate} />
            </Field>
            {canEditActualShipDate ? (
              <Field label="Дата упаковки (факт)" style={{ marginBottom: 0 }}>
                <DatePicker value={actualShipDate} onChange={onActualShipDate} />
              </Field>
            ) : (
              <Field label="Дата упаковки (факт)" style={{ marginBottom: 0 }}>
                <Input value={fmtDateLong(doc.actual_ship_date)} readOnly style={{ cursor: 'default' }} />
              </Field>
            )}
            <Field label="Техническое задание" required={!isDefectCargo} style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
              <AutoGrowTextarea
                minRows={3}
                placeholder="Опишите задачу для команды склада"
                value={comment}
                onChange={(e) => onComment(e.target.value)}
                style={{ resize: 'vertical', minHeight: 76 }}
              />
            </Field>
          </div>
        </>
      ) : canEditTechTaskOnly ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <ReadOnlyField label="Клиент" value={doc.client_name} />
            <ReadOnlyField label="Дата упаковки (план)" value={fmtDateLong(doc.ship_date)} />
            <Field label="Техническое задание" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
              <AutoGrowTextarea
                minRows={3}
                placeholder="Опишите задачу для команды склада"
                value={comment}
                onChange={(e) => onComment(e.target.value)}
                style={{ resize: 'vertical', minHeight: 76 }}
              />
            </Field>
          </div>
        </>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <ReadOnlyField label="Клиент" value={doc.client_name} />
            <ReadOnlyField label="Дата упаковки (план)" value={fmtDateLong(doc.ship_date)} />
            <ReadOnlyField label="Дата упаковки (факт)" value={fmtDateLong(doc.actual_ship_date)} />
            <div style={{ gridColumn: '1 / -1' }}>
              <ReadOnlyField label="Техническое задание" value={doc.comment} multiline />
            </div>
          </div>
        </>
      )}
    </PhaseBlock>
  )
}
