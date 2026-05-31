import type { DictionaryItem } from '../../../../../api/domainTypes'
import { Combobox } from '../../../../data/Combobox'

type Props = {
  value: string
  zones: DictionaryItem[]
  onChange: (zoneId: string) => void
  disabled?: boolean
  /** Только чтение — показываем имя зоны текстом (done). */
  readonly?: boolean
  readonlyLabel?: string | null
}

export function ZoneCell({ value, zones, onChange, disabled, readonly, readonlyLabel }: Props) {
  if (readonly) {
    return <span className="t-sub">{readonlyLabel || '—'}</span>
  }
  return (
    <div className="storage-cell-combobox">
      <Combobox
        value={value}
        placeholder="Выберите"
        options={zones.map((z) => ({ value: z.id, label: z.name }))}
        onChange={(v) => onChange(String(v ?? ''))}
        disabled={disabled || zones.length === 0}
        clearable
      />
    </div>
  )
}
