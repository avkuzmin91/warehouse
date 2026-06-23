import { useEffect, useMemo, useState } from 'react'
import { Combobox, type ComboOption } from './Combobox'
import { Icon } from './Icon'
import { scanSource } from '../scan/ScanSource'
import { getLocationByCode, type LocationMatch } from '../api/locationsApi'

// Выбор места хранения: Combobox + кнопка сканирования QR ячейки. Скан сразу
// применяет место (onChange), чтобы кладовщику не приходилось искать его руками.
// Кнопка скрыта там, где сканер недоступен (веб/превью) — остаётся ручной выбор.
export function ZoneField({
  value,
  options,
  placeholder,
  title,
  invalid,
  onChange,
  onError,
  validateScan,
  allowUnlisted = false,
}: {
  value: string
  options: ComboOption[]
  placeholder: string
  title?: string
  invalid?: boolean
  onChange: (zoneId: string) => void
  onError?: (msg: string) => void
  // Отклонить отсканированное место с сообщением (напр. совпало с источником).
  validateScan?: (loc: LocationMatch) => string | null
  // Разрешить место, которого нет в options (lookup ещё не подтянул ячейку) —
  // подмешиваем его опцией, иначе скан считается «нет среди доступных».
  allowUnlisted?: boolean
}) {
  const [scanAvailable, setScanAvailable] = useState(false)
  const [extra, setExtra] = useState<ComboOption | null>(null)

  useEffect(() => {
    let live = true
    scanSource.isAvailable().then((v) => live && setScanAvailable(v))
    return () => {
      live = false
    }
  }, [])

  const mergedOptions = useMemo(
    () => (extra && !options.some((o) => o.value === extra.value) ? [extra, ...options] : options),
    [options, extra],
  )

  async function scan() {
    try {
      const code = await scanSource.scan()
      if (!code) return
      const res = await getLocationByCode(code)
      if (!res.found || !res.location) {
        onError?.(`Место по коду «${code}» не найдено`)
        return
      }
      const loc = res.location
      const err = validateScan?.(loc)
      if (err) {
        onError?.(err)
        return
      }
      if (!options.some((o) => o.value === loc.id)) {
        if (!allowUnlisted) {
          onError?.(`Места «${loc.code}» нет среди доступных`)
          return
        }
        setExtra({ value: loc.id, label: loc.code })
      }
      onChange(loc.id)
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Сканирование не удалось')
    }
  }

  return (
    <div className="zone-field">
      <Combobox
        value={value}
        options={mergedOptions}
        placeholder={placeholder}
        title={title}
        invalid={invalid}
        onChange={(v) => {
          onChange(v)
          if (extra && v !== extra.value) setExtra(null)
        }}
      />
      {scanAvailable && (
        <button
          type="button"
          className="btn ghost zone-scan"
          aria-label="Сканировать QR места"
          title="Сканировать QR места"
          onClick={() => void scan()}
        >
          <Icon name="qr" size={18} />
        </button>
      )}
    </div>
  )
}
