import { useMemo, useState } from 'react'
import { Icon } from './Icon'
import type { ComboOption } from './Combobox'
import { useHardwareBack } from '../nav/backHandlers'

// Поиск без учёта регистра и диакритики (кириллица/латиница).
function fold(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').trim()
}

// Множественный выбор в нижнем листе: строки отмечаются галочкой, лист не закрывается
// на выбор (в отличие от Combobox) — мобильная замена десктопного MultiSelect.
export function MultiSelectField({
  value,
  options,
  placeholder,
  title,
  invalid,
  onChange,
}: {
  value: string[]
  options: ComboOption[]
  placeholder: string
  title?: string
  invalid?: boolean
  onChange: (value: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')

  const selectedSet = useMemo(() => new Set(value), [value])
  const selectedLabels = options.filter((o) => selectedSet.has(o.value)).map((o) => o.label)

  const filtered = useMemo(() => {
    const needle = fold(q)
    if (!needle) return options
    return options.filter((o) => fold(o.label).includes(needle))
  }, [options, q])

  function toggle(val: string) {
    onChange(selectedSet.has(val) ? value.filter((v) => v !== val) : [...value, val])
  }

  function close() {
    setOpen(false)
    setQ('')
  }

  useHardwareBack(close, open)

  return (
    <>
      <button
        type="button"
        className={`selectish combo${invalid ? ' invalid' : ''}`}
        onClick={() => setOpen(true)}
      >
        <span className={selectedLabels.length ? '' : 'combo-ph'}>
          {selectedLabels.length ? selectedLabels.join(', ') : placeholder}
        </span>
      </button>

      {open && (
        <div className="sheet-backdrop combo-pop" onClick={close}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grip" />
            {title && <h3>{title}</h3>}

            <div className="input search-wrap" style={{ marginBottom: 12 }}>
              <Icon name="search" size={18} />
              <input
                type="search"
                inputMode="search"
                autoCapitalize="none"
                autoCorrect="off"
                placeholder="Поиск"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>

            {filtered.length === 0 ? (
              <div className="center">
                <div>Ничего не найдено</div>
              </div>
            ) : (
              <div className="combo-list" style={{ maxHeight: '52vh', overflowY: 'auto' }}>
                {filtered.map((o) => {
                  const on = selectedSet.has(o.value)
                  return (
                    <button
                      key={o.value}
                      type="button"
                      className={`combo-opt${on ? ' on' : ''}`}
                      onClick={() => toggle(o.value)}
                    >
                      <span>{o.label}</span>
                      {on && <Icon name="check" size={17} />}
                    </button>
                  )
                })}
              </div>
            )}

            <div className="line-row" style={{ marginTop: 12 }}>
              <button className="btn" style={{ flex: 1 }} onClick={close}>
                Готово{value.length > 0 ? ` · ${value.length}` : ''}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
