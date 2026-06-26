import { useMemo, useState } from 'react'
import { Icon } from './Icon'

export type ComboOption = { value: string; label: string }

// Поиск без учёта регистра и диакритики (кириллица/латиница).
function fold(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').trim()
}

export function Combobox({
  value,
  options,
  placeholder,
  title,
  invalid,
  onChange,
}: {
  value: string
  options: ComboOption[]
  placeholder: string
  title?: string
  invalid?: boolean
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')

  const selected = options.find((o) => o.value === value) ?? null

  const filtered = useMemo(() => {
    const needle = fold(q)
    if (!needle) return options
    return options.filter((o) => fold(o.label).includes(needle))
  }, [options, q])

  function close() {
    setOpen(false)
    setQ('')
  }

  return (
    <>
      <button
        type="button"
        className={`selectish combo${invalid ? ' invalid' : ''}`}
        onClick={() => setOpen(true)}
      >
        <span className={selected ? '' : 'combo-ph'}>{selected ? selected.label : placeholder}</span>
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
              <div className="combo-list">
                {filtered.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className={`combo-opt${o.value === value ? ' on' : ''}`}
                    onClick={() => {
                      onChange(o.value)
                      close()
                    }}
                  >
                    <span>{o.label}</span>
                    {o.value === value && <Icon name="check" size={17} />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
