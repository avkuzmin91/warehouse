import type { DictionaryItem } from '../../../../../api/domainTypes'
import { Combobox } from '../../../../data/Combobox'
import { Icon } from '../../../../primitives/Icon'

type Props = {
  value: string
  zones: DictionaryItem[]
  onChange: (zoneId: string) => void
  /** Подсветить «карандашом» несохранённое изменение (deferred-save view). */
  dirty?: boolean
  disabled?: boolean
  /** Только чтение — показываем имя зоны текстом (done). */
  readonly?: boolean
  readonlyLabel?: string | null
}

export function ZoneCell({ value, zones, onChange, dirty, disabled, readonly, readonlyLabel }: Props) {
  if (readonly) {
    return <span className="t-sub">{readonlyLabel || '—'}</span>
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%' }}>
      <div className="storage-cell-combobox" style={{ flex: 1, minWidth: 0 }}>
        <Combobox
          value={value}
          placeholder="Выберите"
          options={zones.map((z) => ({ value: z.id, label: z.name }))}
          onChange={(v) => onChange(String(v ?? ''))}
          disabled={disabled || zones.length === 0}
          clearable
        />
      </div>
      {dirty !== undefined && (
        <span style={{ display: 'inline-flex', width: 18, flexShrink: 0, color: 'var(--c-accent)', visibility: dirty ? 'visible' : 'hidden' }}>
          <Icon name="edit" size={13} />
        </span>
      )}
    </div>
  )
}
